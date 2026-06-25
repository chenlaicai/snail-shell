---
id: F20260625swf8
title: event-driven-router
tags: [refactor, collaboration, web]
modules: [collaboration, web]
doc_kind: spec
---

# F20260625swf8 [collaboration] 事件驱动路由重构 + Issue 三态分组

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

collaboration 层使用 drain 循环 + call_signal 表驱动 agent 调度，存在三个设计问题：

1. **call_signal 与 message.to_speakers 冗余**：两者承载"谁该发言"的相同信息。sendMessage 和 routeAgentReplies 两处创建 call_signal，语义不一致。
2. **drain 循环职责不纯**：大 while 循环把消息创建、路由、agent 调用、用户通知揉在一起，模块边界模糊。
3. **UI 缺少运行状态区分**：Issue 只按 closed_at 分为 active/closed，无法区分"AI 正在跑"和"等人操作"。

## 目标

1. 以 message.to_speakers 为路由事实，删除 call_signal 表
2. 事件驱动架构：消息完成 → Router 解析 to_speakers → 触发下一个 speaker
3. Issue 三态分组：ai_running / needs_human / completed
4. WebSocket 实时推送 activity_status

## 非目标

- 不改变 snail 调用协议
- 不改变 stage 转换机制
- 不改变消息存储模型（message 表结构不变）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 用户发消息 @一个 agent | agent 执行 → 回复 → Router 解析 to_speakers → 触发下一步 | 代码审查：sendMessage → route → dispatch → invokeAgent 链路 |
| B2 | 用户发消息 @两个 agent | 两个 agent 并行执行（Promise.all），各自完成后独立触发 Router | 代码审查：route() 内 Promise.all(targets.map(dispatch)) |
| B3 | Agent A @Agent B，Agent B @user | A 完成 → route 触发 B → B 完成 → route 触发 user 通知 | 代码审查：递归 route 链，dispatch 内 user 分支 |
| B4 | Agent 被中断 | to_speakers 为空 → stage 静默 → needs_human | 代码审查：invokeAgent catch 不调用 routeAgentReplies |
| B5 | Agent 执行失败 | cursor 不推进，消息不丢失，下次可重试 | 代码审查：advanceCursor 在 invokeAgent 成功后执行 |
| B6 | 两个并行 agent 都 @同一目标 | 目标只 invoke 一次（去重） | 代码审查：dispatch 内 pending 标记机制 |
| B7 | Stage 已流转但 agent 仍在运行 | dispatch 入口检查 stage.left_at，停止调度 | 代码审查：dispatch 开头 if (!stage \|\| stage.left_at) return |
| B8 | 服务器重启 | startupRecovery 从最新消息 to_speakers 恢复路由 | 代码审查：startupRecovery 扫描 open stages 最新消息 |
| B9 | Board/List 查看 Issue | 三态分组：AI Running / Needs You / Completed | 代码审查：groupByActivityStatus + activityStatusColumns |
| B10 | WebSocket 实时更新 | 每个事件附带 activity_status，前端即时更新缓存 | 代码审查：computeActivityStatus + updateIssueActivityStatus |

## 设计

### 变更 1: 删除 call_signal

删除 call_signal 表及相关代码：model 接口、port 方法、adapter 实现、repository 类。消息的 to_speakers 成为路由的唯一数据源。

### 变更 2: 事件驱动 Router

新增 Router 状态机，替代 drain 循环：

```
Router 状态: Map<`${stageId}:${speaker}`, { status: "idle" | "invoking", pending: boolean }>

route(stageId, message):
  targets = message.to_speakers
  if (stage.left_at) cleanupDispatchStates(); return  // 守卫：stage 已流转
  Promise.all(targets.map(speaker => dispatch(stageId, speaker)))

dispatch(stageId, speaker):
  if (speaker === "user") notifyUser(); return
  if (status === "invoking") pending = true; return  // 去重
  status = "invoking"
  while (pending):
    state = get(key); if (!state) return       // stage 已流转被并发清理
    pending = false
    unread = getUnreadMessages()
    invokeAgent(unread)                        // agent 执行
    advanceCursor()                            // 成功后才推进
    state = get(key); if (!state) return       // 同上
    if (!pending) status = "idle"; return
```

事件链：sendMessage → route → dispatch → invokeAgent → completeMessage → route → dispatch → ...

### 变更 3: ActivityStatus 三态

判断优先级：
- closed_at 有值 → completed
- Router.isInvoking(stageId) → ai_running
- 最新消息 status=streaming → ai_running（兜底）
- 其他 → needs_human

后端 computeActivityStatus 在 toIssueDetail 中调用，附加到 IssueDetailDto。

### 变更 4: WebSocket 实时推送

createIssueWebSocketBridge 接收 messagePort，每个事件附带 computeActivityStatus 结果。前端 handleRealtimeMessage 收到事件后更新 issue detail 缓存和 issues list 缓存。

### 变更 5: 前端三态分组

Board 从 2 列改为 3 列：AI Running（蓝色）、Needs You（琥珀色）、Completed（灰色）。StatusBadge 支持新状态。IssueCard/IssueRow 展示 activity_status。

## 生效路径

代码重构，通过以下文件生效：
- `src/app/issue-collaboration/collaboration.ts`：Router 状态机替代 drain 循环
- `src/app/issue-collaboration/startup-recovery.ts`：基于最新消息 to_speakers 恢复
- `src/domain/message/`：删除 call_signal 相关代码
- `src/infra/http/routes/issue.route.ts`：computeActivityStatus
- `src/infra/http/stage-websocket.ts`：activity_status 推送
- `src/web/`：三态分组 + StatusBadge

## 设计约束摘要

- **边界**：不引入兼容代码，直接废弃 call_signal 和 drain 循环
- **语义不变量**：cursor 是 agent 认知边界的核心，to_speakers 是路由事实
- **并发模型**：Router 内 async/await 自然序列化，同 stage 无需额外队列
- **Issue 隔离**：per-speaker 状态以 (stage_id, speaker) 为 key，不同 issue 的同名 agent 完全独立

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/domain/message/model.ts` | 修改 | 删除 CallSignal 接口 |
| `src/domain/message/port.ts` | 修改 | 删除 call_signal 相关 4 个方法 |
| `src/domain/message/_internal/repository.ts` | 修改 | 删除 call_signal 表 DDL + SQLiteCallSignalRepository |
| `src/domain/message/_internal/adapter.ts` | 修改 | 删除 callSignalRepo 依赖和 4 个方法实现 |
| `src/domain/message/_internal/initor.ts` | 修改 | 删除 callSignalRepo 创建和传入 |
| `src/domain/issue/port.ts` | 修改 | 新增 listAllOpenStageIds |
| `src/domain/issue/_internal/repository.ts` | 修改 | 新增 listAllOpenStageIds SQL |
| `src/domain/issue/_internal/adapter.ts` | 修改 | 新增 listAllOpenStageIds 委托 |
| `src/app/issue-collaboration/collaboration.ts` | 重写 | Router 状态机替代 drain 循环 + StageQueue |
| `src/app/issue-collaboration/stage-queue.ts` | 删除 | StageQueue 不再需要 |
| `src/app/issue-collaboration/startup-recovery.ts` | 重写 | 基于最新消息 to_speakers 恢复 |
| `src/app/issue-collaboration/port.ts` | 修改 | 新增 isInvoking + resumeRoute |
| `src/api-contracts/dto.ts` | 修改 | 新增 ActivityStatus，IssueDetailDto 加字段，WebSocket 事件加 activity_status |
| `src/infra/http/routes/issue.route.ts` | 修改 | computeActivityStatus + toIssueDetail 附加字段 |
| `src/infra/http/stage-websocket.ts` | 修改 | 每个事件附带 activity_status |
| `src/main.ts` | 修改 | createIssueWebSocketBridge 传入 messagePort |
| `src/web/lib/issue-utils.ts` | 修改 | 新增 groupByActivityStatus + activityStatusColumns |
| `src/web/components/StatusBadge.tsx` | 修改 | 新增 ai_running/needs_human 配置 |
| `src/web/components/IssueCard.tsx` | 修改 | 展示 activity_status |
| `src/web/components/IssueRow.tsx` | 修改 | 展示 activity_status，isDone 改用 activity_status |
| `src/web/pages/IssueBoard.tsx` | 修改 | 三态 Board 分组 |
| `src/web/pages/IssueList.tsx` | 修改 | 三态 List 分组 |
| `src/web/hooks/useWebSocket.ts` | 修改 | 收到事件时更新 activity_status 缓存 |
| `src/api-contracts/dto.ts` | 修改 | 删除 32 个未使用 DTO 类型，内部类型去掉 export |
| `src/web/lib/issue-utils.ts` | 修改 | 删除 IssueStatus / getIssueStatus / groupByStatus / statusColumns 死代码 |
| `src/web/queries/lobby.queries.ts` | 删除 | 空文件 |
| `src/web/queries/index.ts` | 删除 | 未使用的 barrel export |
| `src/web/mutations/index.ts` | 删除 | 未使用的 barrel export |
| `src/infra/semaphore.ts` | 删除 | 未使用的 Semaphore 类 |
| `src/infra/acs/_internal/utils/stateless-runtime-adapter.ts` | 删除 | 未使用的 renderStatelessTranscript |
| `src/infra/server-config.ts` | 修改 | DEFAULT_SERVER_PORT / resolveServerSettings 去掉 export |
| `src/infra/acs/_internal/utils/skill-symlinks.ts` | 修改 | 删除未使用的 cleanupSkillSymlinks |
| `src/infra/acs/_internal/utils/managed-process.ts` | 修改 | 内部类型去掉 export |
| `src/infra/acs/_internal/utils/runtime-usage.ts` | 修改 | RuntimeUsageDetail 去掉 export |
| `src/infra/acs/_internal/utils/stateful-prompt-format.ts` | 修改 | RenderStatefulPromptOptions 去掉 export |
| `src/infra/acs/model.ts` | 修改 | PromptSpec 去掉 export |
| `src/domain/issue/model.ts` | 修改 | RoleInstancePreview 去掉 export |

## 验证

### 通用

- [x] TypeScript 编译零错误
- [x] `npm run lint` 无新增报错
- [x] `npm run build` 通过

### 功能

- [ ] 创建 issue → "Needs You"
- [ ] 用户发消息给 agent → "AI Running"（实时切换）
- [ ] AI 回复完成 → "Needs You"（实时切换）
- [ ] AI @user → "Needs You"
- [ ] AI @另一个 agent → "AI Running"（事件链继续）
- [ ] 两个 agent 互相对话 → 始终 "AI Running"
- [ ] 关闭 issue → "Completed"
- [ ] 服务器重启 → startupRecovery 正确恢复
- [ ] 两个不同 issue 的同名 agent 互不干扰

### 检视修复

- [x] cursor 在 invokeAgent 成功后才推进（High: 失败时消息不丢失）
- [x] dispatch 入口检查 stage.left_at（Medium: 不在已流转 stage 上 invoke）
- [x] route() 独立 try-catch（Medium: 下游路由失败不标记当前 agent 为失败）
- [x] resumeRoute async + 内部错误处理（Low: 无 unhandled rejection）
- [x] 清理全部死代码（dead files、unused exports、unused DTO types）
- [x] stage.left_at 守卫移到 route() 入口，user 分支也受保护（中：已流转 stage 不触发 user 通知）
- [x] dispatchStates 在 advanceStage 和 route 中 stage 已流转时清理（低：防止内存泄漏）
- [x] computeActivityStatus 合并到 collaboration.getActivityStatus()，消除 route/websocket 重复（低：单一事实来源）
- [x] websocket bridge 不再依赖 messagePort（低：减少耦合）
- [x] dispatch while 循环 await 后增加 dispatchStates null check（中：并发 advanceStage 可能清理条目导致 TypeError）
- [x] 特性文档伪代码同步更新：stage 守卫在 route() 而非 dispatch()（低：文档与代码一致性）

## 关联

- **PR**: https://github.com/chenlaicai/snail-shell/pull/461
- **前置**: F20260624d92e（cursor 时序修复，本次在此基础上重构架构）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 删除 call_signal 表 | to_speakers 已承载路由事实，call_signal 是冗余副本 | 需要改动 7 个源文件 | 删除 | 消除冗余数据源，简化信息模型 | 架构师-1、用户 | 2026-06-25 |
| D2 | 事件驱动 vs drain 循环 | 模块边界清晰：消息创建/路由/agent 调用分离 | 递归 route 可能增加调试复杂度 | 事件驱动 | 职责单一，消除大 while 循环 | 架构师-1、用户 | 2026-06-25 |
| D3 | 去掉 StageQueue | async/await 自然序列化，不需要额外队列 | 跨 route 调用的重复 invoke 需要接受 | 去掉 | Router 内 per-speaker 去重已足够 | 架构师-1、用户 | 2026-06-25 |
| D4 | Cursor 驱动而非消息标记 | cursor 天然隔离 (stage_id, speaker)，不需要 processed 标记 | 需要新增 listAllOpenStageIds 查询 | Cursor 驱动 | 复用已有 ReadCursor 机制 | 架构师-1、用户 | 2026-06-25 |
| D5 | activity_status 计算位置 | 后端 computeActivityStatus 保证一致性 | 每次请求多查一次消息 | 后端计算 | 单一事实来源，WebSocket 也用同一逻辑 | 架构师-1 | 2026-06-25 |
| D6 | IssueStatus 与 ActivityStatus | ActivityStatus 完全覆盖 IssueStatus 语义，后者是冗余子集 | 可能有未发现的使用点 | 删除 IssueStatus | grep 确认无外部引用 | 架构师-1 | 2026-06-25 |

## 踩坑记录

### P1: 安装的 hook 与源文件不一致

**现象**：特性编号 `F202606252kux`（第 9 位是数字 `2`）通过了 commit-msg hook 校验，但源文件 `.githooks/commit-msg` 的正则要求第 9 位必须是字母 `[a-kmnp-z]`。

**原因**：安装到 `.git/hooks/commit-msg` 的 hook 被手动修改过，正则从 `\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}` 放宽为 `\d{8}[2-9a-kmnp-z]{4}`。`npm run prepare`（`git config core.hooksPath .githooks`）指向源文件，但 worktree 环境下 hooks path 指向主仓库的 `.git/hooks/`，而该文件是旧版本。

**教训**：
- `git config core.hooksPath` 在 worktree 中指向主仓库的 `.git/hooks/`，不是 `.githooks/`。需要确认 hooks path 指向正确的位置。
- 修改 hook 后应同步到 `.githooks/` 源文件并验证两者一致。
- 生成特性编号后应立即用源文件的正则验证，不要依赖 hook 通过作为唯一校验。

### P2: rebase 后文件名未更新

**现象**：rebase 将 commit message 中的 `F202606252kux` 替换为 `F20260625swf8`，但特性文档文件名仍为 `F202606252kux-event-driven-router.md`。PR 在 GitHub 上显示旧文件名。

**原因**：`git rebase --exec` 只修改 commit message 内容，不会自动修改文件内容或文件名。rebase 后我在工作区做了 `mv` + `sed`，但没有立即 commit，rename 留在 staging area 未被推送。

**教训**：
- rebase 改 ID 后，必须检查所有包含旧 ID 的文件（文件名、frontmatter、正文引用），一次性提交。
- 不能假设 rebase 会自动处理文件名变更。
- 推送前用 `git diff origin/main --name-status` 验证最终文件状态。
