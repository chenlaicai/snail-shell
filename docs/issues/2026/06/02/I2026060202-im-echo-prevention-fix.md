---
id: I2026060202
title: im-echo-prevention-fix
from_ids: [I2026052905]
tags: [bug, im, echo-prevention, timing]
modules: [lobby-aware-channel, gateway]
doc_kind: spec
---

# I2026060202 [IM] 修复 IM 消息回显问题——recentForwardedMessages 追踪时序

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

用户在 IM 群内发送消息后，出现两个异常现象：

1. **IM 大厅也看到了自己的消息**：用户在房间内发 "hi"，IM 群里出现了 "hi" 的回显
2. **消息格式异常**：出现了 `Boss Role: hi` 这样的格式，实际应为纯文本

### 代码分析与根因确认

**消息处理流程**（`lobby-aware-channel.ts` 第 137-172 行）：

```
1. router.processInbound()           → 内部调用 gateway.sendMessage()
   └─ gateway.sendMessage()          → 同步 emitAgentEvent → 出站 handler 立即触发
      └─ handleOutbound()            → 检查 recentForwardedMessages → 空! → 消息推送到 IM ✓
2. trackForwardedMessages(messageIds) → 追踪 messageIds，但已经晚了
```

**根因**：`gateway.sendMessage` 内部的 `sendStructuredMessageWithCollaboration` 会**同步** emit `message_event_appended` 事件（`collaboration.ts:133`），而 `LobbyAwareChannel` 的出站 subscription handler 也是同步执行。

因此，在 `handleInConversation` 返回 messageIds **之前**，出站事件已经触发，此时 `recentForwardedMessages` 还是空的，echo prevention 失效。

### 影响范围

- Bug 1：用户在 IM 群发消息 → 消息被当作"来自其他入口的 Boss 消息" → 推送到 IM 群 → 用户看到自己的消息回显
- Bug 2：出站 handler 的 `renderOutboundMessage` 把 `roleName: "Boss Role"` 和 `text: "hi"` 渲染成 `Boss Role: hi` 推送到 IM 群

## 目标

1. 修复 echo prevention 时序问题，确保用户在 IM 群发送的消息不会回显到 IM 群
2. 保持其他入口（如 Web UI）的消息推送行为不变

## 非目标

- 不改变消息渲染逻辑（`renderOutboundMessage`）
- 不重构 `gateway.sendMessage` 的事件 emit 机制
- 不处理其他可能的 echo prevention 场景（仅修复当前确认的时序问题）

## 设计

### 修复方案：增加 pending 标记

在 `LobbyAwareChannel` 中增加 `pendingForwardChatId` 字段：

**流程变更**：
```
1. 设置 pendingForwardChatId = sourceChatId
2. router.processInbound()
   └─ gateway.sendMessage()          → 同步 emitAgentEvent
      └─ handleOutbound()            → 检查 recentForwardedMessages → 空
                                      → 检查 pendingForwardChatId → 匹配! → 跳过推送
3. trackForwardedMessages(messageIds) → 追踪 messageIds
4. 清除 pendingForwardChatId
```

**关键代码变更**（`lobby-aware-channel.ts`）：

```typescript
// 新增字段
private pendingForwardChatId: string | null = null;

// processAllowedInbound 方法中
async processAllowedInbound(message: InboundMessage): Promise<void> {
  const { sourceChatId, text, messageIds } = await this.handleInConversation(message);

  // 设置 pending 标记
  this.pendingForwardChatId = sourceChatId;

  try {
    await this.router.processInbound({
      source: message.source,
      sourceChatId,
      text,
      metadata: message.metadata,
    });
  } finally {
    // 清除 pending 标记
    this.pendingForwardChatId = null;
  }

  this.trackForwardedMessages(messageIds);
}

// handleOutbound 方法中
private handleOutbound(event: MessageEvent): void {
  const { sourceChatId, messageIds } = this.extractEventInfo(event);

  // 优先检查 pending 标记
  if (this.pendingForwardChatId === sourceChatId) {
    return;
  }

  // 原有的 echo prevention 检查
  if (this.isEchoPrevention(sourceChatId, messageIds)) {
    return;
  }

  // ... 推送到 IM
}
```

### 设计取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| 修复位置 | LobbyAwareChannel 层 | 不修改 gateway 层，降低影响范围 |
| pending 标记 vs 修改 emit 时序 | pending 标记 | 修改 emit 时序可能影响其他 subscriber，风险更高 |
| try-finally 清除 | 必须 | 防止异常时 pending 标记残留 |
| 是否需要同步锁 | 不需要 | Node.js 单线程，同步代码块内不会被中断 |

## 生效路径

- 代码：`src/interaction-entry/im-channel/lobby-aware-channel.ts` — 增加 `pendingForwardChatId` 字段和检查逻辑

<!-- [design-time] 章节结束 -->

## 改动范围

- `src/interaction-entry/im-channel/lobby-aware-channel.ts` — 新增 `pendingForwardChatId` 字段，修改 `processAllowedInbound` 和 `handleOutbound` 方法

## 验证

- [ ] 用户在 IM 群发送 "hi"，IM 群不出现回显
- [ ] 用户在 IM 群发送 "hi"，Web UI 正常显示消息
- [ ] 用户在 Web UI 发送消息，IM 群正常推送
- [ ] 异常场景（如 router.processInbound 抛出异常）不会导致 pending 标记残留

## 关联

- **前置**: I2026052905（im-lobby）— echo prevention 机制在此 Issue 中设计，本次修复其时序 bug
- **相关**: gateway.sendMessage 事件 emit 时序

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 根因是同步 emit 导致的时序问题 | `gateway.sendMessage` 内部同步 emit 事件，`trackForwardedMessages` 调用晚于出站事件触发 | 2026-06-02 |
| 2 | pending 标记方案的线程安全性 | Node.js 单线程模型，同步代码块内不会被中断，无需额外同步机制 | 2026-06-02 |
| 3 | 是否需要修改 gateway 层 | 不需要，LobbyAwareChannel 层修复更安全，影响范围更小 | 2026-06-02 |
