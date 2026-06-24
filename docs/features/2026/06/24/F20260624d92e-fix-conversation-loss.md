---
id: F20260624d92e
title: fix-conversation-loss
tags: [bugfix, core]
modules: [core]
doc_kind: spec
---

# F20260624d92e [core] 修复对话丢失：多角色广播路由 + cursor 时序 + 错误反馈

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

多角色 stage 中用户发送消息（无 @mention）时，只有最近响应过的角色或 default_role_instance 收到 call_signal，其他角色永远不被调用。加上 drainStage 中 advanceCursor 在 invokeAgent 之前执行，失败后消息被标记为已读但未处理，下次 drain 无法重试。长对话中 listByStage 默认 limit=50 导致早期上下文被静默截断。StageQueue 的 .catch 仅记日志，用户看不到失败提示。

## 目标

1. 多角色 stage 无 @mention 时广播到所有非发言者角色
2. invokeAgent 失败时 cursor 不推进，消息保持 unread 可重试
3. agent 失败时创建 system message 通知用户
4. getUnreadMessages / findLatestRespondingSpeaker 绕过 50 条截断

## 非目标

- 不涉及 SQL 层 WHERE id > cursor 优化（长期方案）
- 不涉及 StageQueue 架构变更
- 不涉及路由算法重构

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 用户在多角色 stage 发消息（无 @mention） | 消息广播到所有非发言者 role_instance | 代码审查：resolveToSpeakers 中 others.length > 1 分支 |
| B2 | 用户在多角色 stage 发消息（有 @mention） | 精确路由到被 mention 的角色 | 代码审查：resolveToSpeakers 中 mentions.length > 0 分支保持不变 |
| B3 | invokeAgent 执行失败 | cursor 不推进，消息保持 unread；创建 system message 通知用户 | 代码审查：advanceCursor 移到 invokeAgent 之后 + 失败时创建 system message |
| B4 | 长对话超过 50 条消息 | 早期上下文不被截断 | 代码审查：getUnreadMessages 传 Infinity 绕过默认 limit |

## 设计

### 变更 1: 多角色广播路由

`resolveToSpeakers` 中在 @mention 判断之后、latest speaker fallback 之前，新增判断：当 stage 有多个非发言者 role_instance 时，广播到全部。

```typescript
// 新增逻辑
const others = stage.role_instances.filter(instance => instance !== fromSpeaker);
if (others.length > 1) {
  return others.map(speaker => ({ speaker, source: "default" as const }));
}
```

### 变更 2: Cursor 时序修复

`drainStage` 中将 `advanceCursor` 从 `invokeAgent` 之前移到之后。失败时 invokeAgent 抛出异常，advanceCursor 不执行，消息保持 unread。

```typescript
// 修复前
this.deps.messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id);
await this.invokeAgent(stageId, speaker, unread);

// 修复后
await this.invokeAgent(stageId, speaker, unread);
this.deps.messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id);
```

### 变更 3: 错误反馈

drainStage 中 Promise.allSettled 后遍历 rejected 结果，为失败的 speaker 创建 system message 通知用户。

### 变更 4: listByStage 限制

`getUnreadMessages` 和 `findLatestRespondingSpeaker` 调用 `listByStage(stageId, Infinity)` 绕过默认 50 条限制。

### 设计取舍

- `Infinity` 作为 limit 参数是临时方案，SQLite 将其视为极大整数。长期应改为 SQL 层 `WHERE id > cursor` 过滤。
- 多角色广播是默认行为，Agent 间 @mention 仍保持定向路由。

## 生效路径

代码修复，通过 `src/app/issue-collaboration/collaboration.ts` 和 `src/domain/message/_internal/adapter.ts` 生效。

## 设计约束摘要

- **边界**：不引入兼容代码，直接废弃旧路由逻辑
- **语义不变量**：@mention 精确路由语义不变；单角色 stage 路由逻辑不变

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/app/issue-collaboration/collaboration.ts` | 修改 | resolveToSpeakers 多角色广播 + advanceCursor 时序 + 错误反馈 |
| `src/domain/message/_internal/adapter.ts` | 修改 | getUnreadMessages/findLatestRespondingSpeaker 传 Infinity |

## 验证

### 通用

- [x] TypeScript 编译零错误
- [x] `npm run lint` 无新增报错
- [x] `npm run build` 通过
- [ ] 多角色 stage 无 @mention 时消息广播到所有角色
- [ ] invokeAgent 失败后 cursor 不推进，下次 drain 可重试
- [ ] agent 失败时用户看到 system message 错误提示
- [ ] 长对话超过 50 条消息时早期上下文不被截断

## 关联

- **Issue**: e18d9d02-9624-4d54-93ce-30edeaf333a0（对话丢失）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 多角色广播策略 | 无 @mention 时广播到所有非发言者，语义明确 | 可能导致不必要的 agent 调用 | 广播到全部非发言者 | 多角色 stage 中用户期望所有角色参与 | 架构师-1、架构师-2 | 2026-06-24 |
| D2 | cursor 推进时机 | invokeAgent 成功后推进，失败时保持 unread 可重试 | 无 | 推迟到成功后 | 防止失败后消息永久丢失 | 架构师-1、架构师-2 | 2026-06-24 |
| D3 | listByStage 限制方案 | Infinity 临时绕过 vs SQL 层优化 | Infinity 非正式但立即可用 | 先用 Infinity，长期改 SQL | 修复优先，SQL 优化后续迭代 | 架构师-1 | 2026-06-24 |
