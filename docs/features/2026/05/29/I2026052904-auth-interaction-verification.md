---
id: I2026052904
title: auth-interaction-verification
from_ids: [I2026052704, I2026052604]
tags: [security, permission, approval, ui, verification]
modules: [project_management]
doc_kind: spec
---

# I2026052904 [project_management] 授权交互验证与修复

## 背景

I2026052704 实现了三层权限模型（allow/deny/ask）和审批 UI，代码已合入。但有一个关键问题从未被验证：**stateful agent（claude-code-stateful-cli）下的审批 UI 是否真正工作**。

上一个"授权交互"特性（feature 009f144a）的根因是 `claude-code-stateful.ts` 缺少 `classifyDenials` / `permission_required` 逻辑——stateful agent 把所有 `permission_denials` 当作错误处理，不区分硬/软拒绝，导致审批 UI 永远不会触发。

此外，上一个特性中 AI 犯了多个错误：
- 没有先做根因分析就动手改代码
- 误解目标为"放通权限"而非"验证审批 UI 正常工作"
- 在主目录改代码（违反研发手册）
- 前端空白页没排查清楚

本特性的目标是：**在 worktree 中完成端到端验证，确认审批 UI 在 stateful agent 下正常工作，修复发现的问题，并补齐测试覆盖。**

## 目标

1. 验证 stateful agent 下 `permission_required` 事件能正确触发
2. 验证前端审批 UI 能正确渲染 approve/deny 按钮
3. 验证批准后 agent retry 能成功执行
4. 验证拒绝后消息标记 failed
5. 补齐缺失的测试用例
6. 修复验证过程中发现的任何问题

## 非目标

- 不实现审批超时自动拒绝
- 不实现批量审批
- 不实现审批历史持久化
- 不修改 GuardProfile 或 PermissionCapability 模型
- 不修改 ACS spec

## 设计

### 问题分析

`claude-code-stateful.ts` 的 `handleResultMessage` 原实现：

```typescript
// 原实现：所有 permission_denials 当作错误
const permissionDenialError = this.formatPermissionDenials(msg.permission_denials);
if (permissionDenialError) {
  this.emitEvent(onEvent, { type: "message_failure", error: permissionDenialError });
}
```

对比 `claude-code.ts`（stateless）的正确实现，缺少：
1. `classifyDenials` — 区分硬拒绝（匹配 deny）和软拒绝（不在 allow/deny 中）
2. `buildPermissionRequest` — 从 denial 构造 `ToolPermissionRequest`
3. `permission_required` 事件发射 — 软拒绝时通知前端
4. `permission_blocked` signal — 记录到消息事件流
5. `emittedToolCalls` 跟踪 — denial 分类时还原完整命令文本
6. `currentGuardProfile` 保存 — 供 classifyDenials 使用
7. `extraAllow` 消费 — retry 场景注入临时白名单

### 修复方案

将 stateless agent 的完整权限处理逻辑移植到 stateful agent。两个 agent 的权限处理逻辑结构相同，区别仅在于架构（stateless vs stateful）。

## 改动范围

- `src/agent/claude-code-stateful.ts`：添加 classifyDenials / buildPermissionRequest / formatDenialMessage / isCommandInDenyPatterns，重写 handleResultMessage 权限处理
- `tests/agent/claude-code-stateful-test.ts`：新增 testHardPermissionDenialsBecomeFailureEvents / testSoftPermissionDenialsBecomePermissionRequired
- `eslint.config.mjs`：将 claude-code-stateful.ts 加入与 claude-code.ts 相同的 lint 豁免规则

## 验证

- [x] stateful agent 硬拒绝产生 message_failure（testHardPermissionDenialsBecomeFailureEvents）
- [x] stateful agent 软拒绝产生 permission_required + permission_blocked signal，不产生 message_failure（testSoftPermissionDenialsBecomePermissionRequired）
- [x] stateful + stateless 混合 denial 场景：hard denial 优先，不 emit permission_required（testMixedDenialsHardTakesPriority × 2）
- [x] tsc 编译通过
- [x] eslint 通过
- [x] 全部 43 个测试文件通过
- [ ] 前端渲染审批卡片（需人工在浏览器验证）— **不在本 PR 范围**：denylist-only 策略下，安全命令被 Claude Code 自身启发式放行，不产生 `permission_denials`，无法在自动化测试中触发前端审批卡片。需在后续 Codex app-server 实时审批集成中验证
- [ ] 批准后 agent retry 成功（需人工验证）— **不在本 PR 范围**：同上，依赖 `permission_required` 事件触发，需端到端环境
- [ ] 拒绝后消息标记 failed（需人工验证）— **不在本 PR 范围**：同上，需端到端环境

## 范围变更记录

### 2026-05-29：Claude Code 实现层采用 denylist-only 策略

**变更原因：** 验证发现 `echo abc` 等安全命令在 `--permission-mode default` 下被 Claude Code 自身启发式放行，不产生 `permission_denials`，导致 `classifyDenials` 无法执行。根本原因是 Claude Code 协议不支持"非白名单即拒绝"的模式。

**变更内容：**
1. `translateToClaudeSettings()` 改为只传递 deny 列表，allow 列表留空
2. Claude Code agent 层只保证"黑名单拦截"，不保证"非白名单审批"
3. guard-bash.js PreToolUse hook 作为第二层防线（Bash 命令语义分析）
4. extraAllow 机制保留（retry 场景：用户审批后注入 allow 列表）

**设计决策：** ACS 安全策略（黑白名单+审批）设计不变，但底层 agent 实现层按各自能力适配。Claude Code 采用 denylist-only，Codex/OpenCode 待后续实现。

**端到端验证范围收缩：** 原目标 2/3/4（前端审批卡片渲染、批准后 retry、拒绝后标记 failed）在 denylist-only 策略下无法自动化验证——安全命令被 Claude Code 自身启发式放行，不产生 `permission_denials`，前端审批卡片不会出现。这 3 项验证需在后续 Codex app-server 实时审批集成中完成。本 PR 验证范围收缩为：(1) classifyDenials 硬/软拒绝逻辑正确性（单元测试覆盖），(2) denylist-only 策略正确性（guard-config 测试覆盖），(3) 编译和全量测试通过。

---

## Agent 底层能力调研（2026-05-29）

### 调研背景

ACS 设计要求"非白名单操作必须审批"，但底层 agent（Claude Code/OpenCode/Codex）的协议支持程度不同。本次调研逐个验证了各 agent 的实际能力。

### 核心发现：三个 agent 都不支持实时权限交互

所有 agent 都是"跑完汇报"模式，没有"暂停→上报→等待审批→继续执行"的能力。

| Agent | 调用方式 | 权限机制 | 实时交互？ |
|---|---|---|---|
| Claude Code | `-p --input-format stream-json` | `settings.local.json` allow/deny + hook | ❌ 只有事后 `permission_denials` |
| OpenCode | `run --format json` | 无 allow/deny，无 hook | ❌ 非交互模式直接跳过 |
| Codex | `exec` / `--sandbox` | OS 级 sandbox | ❌ 只有粗粒度隔离 |

### Claude Code 深度分析

**协议限制：**
- `-p` 非交互模式下，stdin 只接收一次 `{ type: "user" }` 消息
- stdout 只输出 `{ type: "assistant" }` 和 `{ type: "result" }` 消息类型
- 没有 `permission_prompt` 或 `permission_request` 消息类型
- `permission_denials` 只在 `result` 消息中批量汇报（事后汇总）

**`--permission-mode default` 行为：**
- 命中 allow → 放行
- 命中 deny → 拒绝，写入 `permission_denials`
- 都不命中 → Claude Code 自身启发式判断（安全命令自动放行，不产生 `permission_denials`）

**可用的安全机制：**
1. `--disallowedTools` CLI 参数（原生黑名单）
2. `.claude/settings.local.json` `permissions.deny` 数组
3. PreToolUse hook（guard-bash.js，Bash 命令语义分析）
4. SDK 库调用 `@anthropic-ai/claude-code`（`query()` 函数，支持 `permissionMode`）

**结论：** Claude Code 是唯一在子进程模式下原生支持命令级黑名单的 agent。采用 denylist-only 策略。

### OpenCode 深度分析

**能力：**
- 无 allow/deny 列表支持
- 无 PreToolUse hook
- 无 OS sandbox
- 无 per-project 配置入口（全局配置 `~/.config/opencode/opencode.jsonc`）
- 安全机制：移除 `--dangerously-skip-permissions` 恢复默认权限模式

**其他调用方式：**
- ACP Server（`opencode acp`）：Agent Client Protocol，HTTP/WebSocket，结构化消息传递
- Headless Server（`opencode serve`）：HTTP 远程服务
- MCP Server（`opencode mcp`）：MCP 协议

**结论：** OpenCode 无命令级拦截能力。ACP 协议可能支持更丰富的交互，待后续调研。

### Codex 深度分析

**能力：**
- `--sandbox read-only|workspace-write|danger-full-access`：OS 级 sandbox（macOS Seatbelt / Linux Landlock+seccomp）
- `--ask-for-approval untrusted`：受信命令白名单模式（**仅交互模式可用**，`codex exec` 不支持）
- `codex exec` 固定 `approval: never`，无法覆盖
- 无命令级 deny 列表，无 PreToolUse hook

**其他调用方式：**
- **app-server**（`codex app-server`，WebSocket）：**已验证支持实时审批协议**
  - `item/commandExecution/requestApproval` — 命令执行审批
  - `item/fileChange/requestApproval` — 文件变更审批
  - `item/permissions/requestApproval` — 权限审批
  - 审批响应：`accept` / `acceptForSession` / `acceptWithExecpolicyAmendment` / `decline` / `cancel`
- exec-server（WebSocket，实验性）
- MCP Server（`codex mcp-server`）

**结论：** `codex exec` 子进程无黑名单。但 `codex app-server` 的 WebSocket 协议支持完整实时审批，是后续实现"非白名单审批"的最佳候选。

### 各 Agent 黑名单支持总结

| Agent | 子进程黑名单 | 机制 | 后续方向 |
|---|---|---|---|
| Claude Code | ✅ | `--disallowedTools` + `settings.local.json` deny + hook | 已实现 denylist-only |
| OpenCode | ❌ | 无 | ACP 协议待调研 |
| Codex | ❌ | 只有 sandbox 模式 | app-server WebSocket 已验证支持实时审批 |

### 分层实现策略

**ACS 层（Snail Shell 侧）：** 保持完整的黑白名单+审批机制设计不变。`GuardProfile { allow, deny }` + `classifyDenials` 三层模型在 Snail Shell 侧是完整的。

**Agent 适配层：** 按各 agent 实际能力逐个实现：
1. Claude Code：denylist-only（本次实现）
2. Codex：后续通过 app-server WebSocket 实现实时审批
3. OpenCode：后续通过 ACP 协议或等待 OpenCode 支持 per-project 配置
