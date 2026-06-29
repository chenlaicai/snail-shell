---
id: F20260629smrx
title: send-message-route-stale-object
tags: [bugfix, collaboration]
modules: [collaboration]
doc_kind: spec
---

# F20260629smrx [collaboration] 修复 sendMessage 用户消息路由失效 + dispatch 失败重试风暴

## 背景

用户在 Snail Shell 中发送消息后，agent 完全不响应。数据库确认消息创建成功、target 解析正确（`sendMessage.targets` 日志正常），但 `invokeAgent` 从未被触发。read_cursor 停留在旧消息位置，agent 从未读取用户的新消息。

## 排查过程

### 1. 排除 dispatch 循环问题

最初怀疑是 dispatch 循环的错误处理缺陷导致 30 次重试风暴。检查 `dispatch()` 的 catch 块：

```typescript
try {
  await this.invokeAgent(stageId, speaker, unread);
  this.deps.messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id);
} catch (error) {
  log.error({ stageId, speaker, err: error }, "dispatch: agent invocation failed");
  // cursor 不推进 → 同一组消息被反复重试 30 次
}
```

确实存在问题：失败时 cursor 不推进，导致同一组消息被重试 `maxCollaborationRounds`（30）次。但这不是本次"agent 不干活"的根因——日志中没有 dispatch 失败记录。

### 2. 排除 busy guard 问题

怀疑 dispatch 状态卡在 `invoking`。但 `dispatchStates` 是内存 Map，服务重启后清空。新进程（pid 12046）不可能有旧的 dispatch 状态。

### 3. 定位根因：`route()` 收到的 message 对象 to_speakers 为空

对比新旧进程日志发现关键差异：

**旧进程（pid 86211）**：
```
sendMessage → targets:[架构师-1(default)] → invokeAgent start ✓
```

**新进程（pid 12046）**：
```
sendMessage.targets → targets:[架构师-2(reply)] → (无后续日志) ✗
```

target 解析正确，但 `route()` → `dispatch()` → `invokeAgent()` 链条从未执行。

追踪 `sendMessageAsync` 代码发现：

```typescript
// line 94: 创建 message，to_speakers = []
const message = this.deps.messagePort.createMessage({ ..., to_speakers: [], ... });

// line 105: 更新 DB 中的 to_speakers（只写数据库，不更新内存对象）
this.deps.messagePort.updateMessageTargets(message.id, targets.map(t => t.speaker));

// line 111: 传入原始 message 对象，to_speakers 仍然是 []
await this.route(stageId, message);
```

`updateMessageTargets` 只更新数据库，不更新传入的 `message` 对象。`route()` 检查 `message.to_speakers` 时看到空数组，直接 return：

```typescript
private async route(stageId: string, message: Message): Promise<void> {
  const targets = message.to_speakers;
  if (targets.length === 0) return;  // ← 永远走到这里
  // ...
}
```

### 4. 为什么之前没发现

此 bug 由事件驱动路由重构（F20260625swf8）引入。重构前使用 `call_signal + drainStage` 机制，不依赖 `message.to_speakers` 来 dispatch。重构后 `route()` 依赖了这个字段，但 `sendMessageAsync` 没有同步更新内存对象。

对比 `invokeAgent`（agent 回复路径）的正确做法：

```typescript
this.deps.messagePort.updateMessageTargets(agentMessage.id, targets);
const completedMessage = this.helpers.mustGetMessage(agentMessage.id);  // ← 从 DB 重新读取
await this.route(stageId, completedMessage);  // ← to_speakers 正确
```

### 5. 日志验证

数据库审计确认问题模式：

| Stage | 最新消息 ID | 架构师-1 cursor | 架构师-2 cursor | 状态 |
|-------|------------|-----------------|-----------------|------|
| f3795b85 | 1232 | 1223 | 1222 | agent 从未读取 1229-1232 |
| df7f47bf | 1233 | 1216 | - | agent 从未读取 1233 |

## 修复方案

### 变更 1（根因修复）：sendMessageAsync 从 DB 重新读取 message

`updateMessageTargets` 之后，从 DB 重新读取 message 对象，确保 `to_speakers` 字段是最新的。与 `invokeAgent` 中的做法一致。

### 变更 2（防御性修复）：dispatch 失败时退出循环

当 `invokeAgent` 抛异常时，不推进 cursor（保留 unread 消息），但立即退出循环，避免在同一组失败消息上烧尽 `maxCollaborationRounds`（30 次）。

### 核心业务行为

| # | 场景 | 预期行为 | 变更影响 |
|---|------|----------|----------|
| B1 | 用户发消息给 agent | agent 被触发并响应 | **根因修复** |
| B2 | 用户 @mention 指定 agent | 指定 agent 被触发 | **根因修复** |
| B3 | Agent 调用失败 | 失败 1 次后退出循环，不重试 30 次 | **防御性修复** |
| B4 | Agent 调用失败后用户再发消息 | 新消息触发 dispatch，旧 unread 消息被重试 1 次 | 无变化（cursor 保留） |
| B5 | Agent 互相 @mention | 正常工作（invokeAgent 路径已有 mustGetMessage） | 无变化 |

### 变更范围

| 文件 | 变更 |
|------|------|
| `src/app/issue-collaboration/collaboration.ts` | `sendMessageAsync`: `updateMessageTargets` 后从 DB 重新读取 message；`dispatch`: 失败时退出循环 |
