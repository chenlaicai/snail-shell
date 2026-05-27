---
id: F2026052703
title: approval-for-non-whitelist-operations
from_ids: []
tags: [security, permission, approval, ui]
modules: [project_management]
doc_kind: spec
---

# F2026052703 [project_management] 不在黑白名单中的操作审批

## 背景

Snail Shell agent 执行 Bash 等工具操作时，当前只有 allow/deny 两种权限决策。对于不在白名单也不在黑名单中的操作，系统直接拒绝，用户无法干预。这导致 agent 因一个未知 safe 命令（如 `mkdir -p`、`npx tsc`）就卡住，需要用户手动重试或换说法。

## 目标

引入三层权限模型 allow / deny / ask：
- **allow**：白名单操作直接放行
- **deny**：黑名单操作直接拒绝，agent 收到 terminalFailure
- **ask**：不在黑白名单中的操作暂停 agent 并转为 pending_approval，前端弹出审批 UI，用户批准后 agent 自动 retry

同时将 ACS 安全配置统一为 `guard-profile.json` 单一入口。

## 非目标

- 不实现审批超时自动拒绝
- 不实现批量审批
- 不实现审批历史持久化（permissionStore 为内存级单例）

## 设计

### 三层权限模型

```
工具调用 → classifyDenials()
  ├── 匹配 denyPatterns  → 硬拒绝（terminalFailure）
  ├── 匹配 allowTools    → 放行
  └── 都不匹配           → 软拒绝 → pendingPermissionRequest → pending_approval
```

硬拒绝优先于软拒绝：`invokeRoleBatch` 在 agent 返回后先检查 `terminalFailure`，再检查 `pendingPermissionRequest`。

### pending_approval 生命周期

1. agent 调用工具 → Claude Code 触发 `permission_required` 事件
2. `classifyDenials()` 判定为软拒绝 → 设置 `streamingContext.session.pendingPermissionRequest`
3. `invokeRoleBatch()` → `finalizePendingApproval()` 将审批请求写入 `permissionStore`，消息状态设为 `pending_approval`
4. 前端实时事件 `message_status_changed` → 渲染审批按钮
5. 用户点击批准/拒绝 → `POST /api/approve-tool`
6. 批准：将工具写入 `extraAllow`（临时白名单），用原始发送方 role 重放原消息 → `drainMessageBus` 重新触发 agent
7. 拒绝：消息标记 `failed`

### 审批 retry 语义

`finalizePendingApproval` 从 batch 中找到发送给当前 agent 的触发消息，保存：
- `originalUserMessageId`：触发消息的 id
- `originalRoleName`：被审批的目标 agent
- `originalFromRole`：触发消息的发送方（Boss Role 或上游 agent）

批准时以 `originalFromRole` 作为 `sendStructuredMessage` 的 `fromRole`，保持原始路由语义。Boss→agent 场景下 `fromRole="Boss Role"` → 走 fallback 路由；agent→agent 场景下走 mention 路由。

### ACS 配置统一

`guard-profile.json` 新增 `allowTools` 字段，合并原 `agent-baseline.json` 的全部内容。`agent-baseline.json` 已删除。`guard-config.ts` 从 `guard.allowTools` 读取 allow 列表，不再独立加载 `AGENT_BASELINE`。

GuardProfile 扁平化为 `{ allow, deny }` 两个列表，匹配 agent 原生权限模型。移除 domain 抽象层（GuardDomain / GuardMode / database|filesystem|git|network）。

## 生效路径

- `src/agent/claude-code.ts`：`classifyDenials` 区分硬/软拒绝，`permission_required` 事件处理 + `takeExtraAllow`
- `src/agent/permission-store.ts`：内存级审批暂存 + `takeExtraAllow`/`setExtraAllow` 临时白名单
- `src/agent/guard-config.ts`：从 `guard.allowTools` 读取 allow，移除 `AGENT_BASELINE` 独立加载
- `src/agent/interface.ts`：`permission_required` 加入 `RealtimeConversationEvent` + `GuardProfile.allowTools`
- `src/agent/capability/spec.ts`：GuardProfile 字段
- `src/message-bus/collaboration.ts`：`finalizePendingApproval` 审批信息保存
- `src/message-bus/message-protocol.ts`：`pending_approval` 状态处理
- `src/interaction-entry/api/server.ts`：`POST /api/approve-tool` + `formatToolPermissionPattern`
- `src/shared/domain-types.ts`：`pending_approval` + `permission_blocked` 信号类型
- `config/guard-profile.json`：新增 `allowTools`，合并原 `agent-baseline.json` 全部内容
- `config/agent-baseline.json`：删除
- `src/web/*`：前端实时事件 → store → view → renderer → app 全线支持审批 UI
- `tests/agent/guard-config-test.ts`：适配 allowTools

## 改动范围

26 files changed, 957 insertions(+), 872 deletions(-)

- 后端核心：claude-code.ts / guard-config.ts / permission-store.ts / collaboration.ts / message-protocol.ts / server.ts
- 配置：guard-profile.json（新增 allowTools）/ agent-baseline.json（删除）
- 前端：app.js / message-store.js / message-view.js / message-renderer.js / message-list.js / realtime-manager.js / send-availability.js / message.css
- 测试：claude-code-test.ts / guard-config-test.ts / guard-bash-test.ts / capability-spec-test.ts
- Hooks：guard-bash.js（适配扁平 deny list）

## 验证

- [ ] 白名单操作直接放行，无审批
- [ ] 黑名单操作直接拒绝，显示错误
- [ ] 不在名单中的触发审批 UI
- [ ] 批准后 agent retry 成功（Boss→agent 路径）
- [ ] 批准后 agent retry 成功（agent→agent 路径）
- [ ] 拒绝后消息标记 failed
- [ ] tsc / lint / 测试全过

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | permissionStore 为内存级单例，进程重启后审批状态丢失 | 可接受——审批是实时操作，重启后用户重试即可 | 2026-05-27 |
| 2 | ACS 配置统一入口 | guard-profile.json 为唯一安全配置入口，删除 agent-baseline.json | 2026-05-27 |
| 3 | GuardProfile 扁平化 | 移除 domain 抽象层，allow/deny 直接对应 agent 原生权限模型 | 2026-05-27 |
| 4 | 审批 retry 路由 | 保存 originalFromRole 保持原始发送方语义，而非用目标 agent 角色重放 | 2026-05-27 |
