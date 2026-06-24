---
id: F20260624d92e
title: fix-conversation-loss
tags: [bugfix, core]
modules: [core]
doc_kind: spec
---

# F20260624d92e [core] 修复对话丢失：cursor 时序 + SQL 层优化 + 路由恢复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

drainStage 中 advanceCursor 在 invokeAgent 之前执行，失败后消息被标记为已读但未处理，下次 drain 无法重试，导致对话永久丢失。getUnreadMessages 和 findLatestRespondingSpeaker 全量加载消息再内存过滤，长对话中 listByStage 默认 limit=50 导致早期上下文被静默截断。resolveToSpeakers 中多余的广播分支改变了既有路由语义。

## 目标

1. invokeAgent 失败时 cursor 不推进，消息保持 unread 可重试
2. SQL 层直接查询替代全量加载 + 内存过滤
3. 恢复纯 3 层路由：mention → last speaker → primary role

## 非目标

- 不涉及 StageQueue 架构变更
- 不涉及路由算法重构

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | invokeAgent 执行失败 | cursor 不推进，消息保持 unread，call signal 保留可重试 | 代码审查：advanceCursor + deleteCallSignal 移到 invokeAgent 成功之后 |
| B2 | 用户发消息有 @mention | 精确路由到被 mention 的角色 | 代码审查：resolveToSpeakers mentions.length > 0 分支不变 |
| B3 | 用户发消息无 @mention | 路由到 last speaker 或 primary role（纯 3 层路由） | 代码审查：resolveToSpeakers 恢复为 mention → last speaker → default |
| B4 | 长对话超过 50 条消息 | 早期上下文不被截断 | 代码审查：getUnreadMessages 改用 listByStageAfterId SQL 查询 |

## 设计

### 变更 1: Cursor 时序修复

`drainStage` 中将 `advanceCursor` 和 `deleteCallSignal` 移到 `invokeAgent` 成功之后。失败时两者均不执行：消息保持 unread，call signal 保留，下次 drain 可重新调度。

### 变更 2: SQL 层优化

新增 3 个专用 SQL 方法替代全量加载：

- `listByStageAfterId(stageId, afterId)`：`WHERE id > ? ORDER BY id ASC`，getUnreadMessages 改用此方法
- `findLatestRespondingSpeaker(stageId)`：SQL 直接查询 `ORDER BY id DESC LIMIT 1`，adapter 改为委托 repository
- `findLatestMessage(stageId)`：`ORDER BY id DESC LIMIT 1`，drainStage 用户分支改用此方法

### 变更 3: 移除广播逻辑

删除 `resolveToSpeakers` 中 `if (others.length > 1)` 广播分支，恢复纯 3 层路由：mention → last speaker → primary role。

## 生效路径

代码修复，通过 `src/app/issue-collaboration/collaboration.ts`、`src/domain/message/_internal/adapter.ts`、`src/domain/message/_internal/repository.ts`、`src/domain/message/port.ts` 生效。

## 设计约束摘要

- **边界**：不引入兼容代码，直接废弃旧路由逻辑
- **语义不变量**：@mention 精确路由语义不变；单角色 stage 路由逻辑不变

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/domain/message/_internal/repository.ts` | 修改 | 新增 listByStageAfterId / findLatestRespondingSpeaker / findLatestMessage 3 个 SQL 方法 |
| `src/domain/message/_internal/adapter.ts` | 修改 | getUnreadMessages 改用 listByStageAfterId；findLatestRespondingSpeaker 委托 repository；新增 findLatestMessage |
| `src/domain/message/port.ts` | 修改 | 新增 findLatestMessage 接口方法 |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | drainStage 用户分支改用 findLatestMessage；resolveToSpeakers 删除广播分支 |

## 验证

### 通用

- [x] TypeScript 编译零错误
- [x] `npm run lint` 无新增报错
- [x] `npm run build` 通过
- [ ] invokeAgent 失败后 cursor 不推进、call signal 保留，下次 drain 可重试
- [ ] 有 @mention 时精确路由
- [ ] 无 @mention 时路由到 last speaker 或 primary role
- [ ] 长对话超过 50 条消息时早期上下文不被截断

## 关联

- **Issue**: e18d9d02-9624-4d54-93ce-30edeaf333a0（对话丢失）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | cursor 推进时机 | invokeAgent 成功后推进，失败时保持 unread 可重试 | 无 | 推迟到成功后 | 防止失败后消息永久丢失 | 架构师-1、架构师-2 | 2026-06-24 |
| D2 | SQL 层优化 | 专用 SQL 方法替代全量加载 + 内存过滤 | 新增方法增加接口复杂度 | 新增 3 个 SQL 方法 | 消除 O(N) 内存操作，listByStage 保持不变 | 架构师-1、架构师-2 | 2026-06-24 |
| D3 | 广播逻辑 | 多角色广播语义明确 | 改变既有路由语义，无 @mention 时应保持原有行为 | 删除广播分支 | 恢复纯 3 层路由，用户需切换目标应使用 @mention | 架构师-1、架构师-2、用户 | 2026-06-24 |
