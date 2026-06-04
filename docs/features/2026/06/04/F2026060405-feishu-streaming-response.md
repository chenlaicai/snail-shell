---
id: F2026060405
title: 飞书流式响应
from_ids: [F2026050607]
tags: [feishu, streaming, integration]
modules: [interaction_entry]
---
# F2026060405 飞书流式响应

## 背景

Snail Shell 飞书接入（F2026050607）已实现基本的文本对话链路：用户在飞书群发消息 → Snail Shell 处理 → 回复推送到飞书。但当前出站路径是逐条消息发送的——`LobbyAwareChannel.handleOutbound()` 每收到一个 `message_event_appended` 事件就调用一次 `FeishuSdkTransport.sendText()`（即 `im.v1.message.create`），导致：

1. Agent 产生多个文本事件时，飞书收到多条独立消息，形成刷屏。
2. 用户必须等待 Agent 完整回复后才能看到有意义的内容，延迟可达数分钟。
3. 与 Web UI 的实时流式体验形成巨大落差（Web 端通过 WebSocket 逐 token 推送）。

飞书开放平台提供了消息更新 API（`PATCH /im/v1/messages/{message_id}`）和 CardKit 流式更新 API，可以实现类似"打字机效果"的流式响应。

## 目标

1. 飞书端收到 Agent 回复时，先发送一条占位消息（"思考中..."），随后通过消息更新 API 逐步追加文本内容，实现流式输出效果。
2. 复用现有 `ConversationGateway` 的事件订阅机制（`message_started`、`message_event_appended`、`message_status_changed`），不引入新的事件通道。
3. 流式更新带频率控制（debounce），避免触发飞书 API 限流（~5 QPS/消息）。
4. Agent 回复完成后，飞书消息最终内容与 Web UI 一致。
5. 保持与现有非流式出站路径的兼容——如果流式更新失败，降级为最终一次性发送。

## 非目标

1. 不实现飞书卡片按钮、交互回调或阶段操作入口。
2. 不实现飞书侧"正在输入"指示器（飞书 Bot API 不支持）。
3. 不改变 Agent 内部的流式事件产生机制（已有完整实现）。
4. 不改变 Web UI 的流式推送路径（WebSocket 已独立实现）。
5. 不引入飞书 CardKit 复杂卡片模板——本次使用纯文本消息更新，保持简单。

## 设计

### 外部能力事实

1. 飞书支持 `PATCH /open-apis/im/v1/messages/{message_id}` 更新已发送消息的内容，支持 `text`、`interactive`（卡片）等消息类型。
2. 更新频率限制约 5 QPS/消息，建议 200-500ms 间隔。
3. 飞书 Bot 没有"正在输入"状态 API。
4. `@larksuiteoapi/node-sdk` 的 `Client` 支持 `im.v1.message.patch()` 方法。
5. 文本消息更新时，整个内容会被替换（非追加），需要客户端维护完整文本缓冲。

### 架构变更概述

当前出站路径：

```
Gateway event → LobbyAwareChannel.handleOutbound() → transport.sendText() [每次 create]
```

变更为：

```
Gateway event → LobbyAwareChannel.handleOutbound()
  → message_started: 发送占位消息，记录 message_id
  → message_event_appended: 追加到 buffer，debounce 后 PATCH 更新
  → message_status_changed: 最终 PATCH + 清理流式状态
```

### FeishuTransport 接口扩展

`src/interaction-entry/feishu/types.ts` 变更：

- `sendText` 返回类型从 `Promise<void>` 改为 `Promise<string>`，返回飞书 message_id。现有调用者不关心返回值，不受影响。
- 新增 `patchText` 方法。

```typescript
export interface FeishuTransport {
  start(input: { onMessage: (message: FeishuInboundMessage) => void | Promise<void> }): void | Promise<void>;
  stop?(): void;
  /** 发送文本消息，返回飞书 message_id（用于后续流式更新或日志追踪） */
  sendText(input: { chatId: string; text: string; uuid?: string }): Promise<string>;

  /** 更新已发送消息的内容 */
  patchText(input: { messageId: string; text: string }): Promise<void>;
}
```

不新增 `sendTextAndGetId`——`sendText` 统一承担两个职责，接口更简洁。

### FeishuSdkTransport 实现

`src/interaction-entry/feishu/sdk-transport.ts` 变更：

```typescript
async sendText(input: { chatId: string; text: string; uuid?: string }): Promise<string> {
  if (!this.client) throw new Error("Feishu transport has not started");
  const resp = await this.client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: input.chatId,
      msg_type: "text",
      content: JSON.stringify({ text: input.text }),
      ...(input.uuid ? { uuid: input.uuid } : {}),
    },
  });
  const messageId = (resp as any).data?.message_id;
  if (typeof messageId !== "string" || !messageId) {
    throw new Error("Feishu sendText response missing message_id");
  }
  return messageId;
}

async patchText(input: { messageId: string; text: string }): Promise<void> {
  if (!this.client) throw new Error("Feishu transport has not started");
  await this.client.im.v1.message.patch({
    path: { message_id: input.messageId },
    data: {
      msg_type: "text",
      content: JSON.stringify({ text: input.text }),
    },
  });
}
```

### 流式会话管理器

新增 `src/interaction-entry/feishu/streaming-session.ts`，管理单条消息的流式生命周期。依赖 `logger`（从 `../../logger` 导入）用于降级失败日志。

**竞态处理**：`onStart()` 是 async（调飞书 API 拿 message_id），`onEnd()` 可能在 `onStart()` 完成前到达（极短回复场景）。通过 `pendingEnd` 标记处理：如果 `onEnd` 先到，记录 finalText；`onStart` 完成后检查该标记，立即做最终 PATCH。

**多 chat 订阅**：`LobbyAwareChannel` 支持同一 conversation 被多个飞书群订阅，`handleOutbound` 对每个 `chatId` 独立调用，因此每个 chat 创建独立的 streaming session，互不干扰。

```typescript
interface StreamingSessionConfig {
  /** debounce 间隔（ms），默认 300 */
  flushIntervalMs: number;
  /** 最大文本长度 */
  maxLength: number;
}

class FeishuStreamingSession {
  private buffer = "";
  private feishuMessageId: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private finalized = false;
  /** onEnd 在 onStart 完成前到达时，暂存 finalText */
  private pendingEndText: string | null = null;

  constructor(
    private readonly chatId: string,
    private readonly roleName: string,
    private readonly transport: FeishuTransport,
    private readonly config: StreamingSessionConfig,
  ) {}

  /** 收到 message_started 事件：发送占位消息 */
  async onStart(): Promise<void> {
    const text = `[${this.roleName}] 思考中...`;
    this.feishuMessageId = await this.transport.sendText({
      chatId: this.chatId,
      text,
    });
    // 竞态保护：onEnd 在 onStart 完成前已到达，立即执行最终 PATCH
    if (this.pendingEndText !== null) {
      const finalText = this.pendingEndText;
      this.pendingEndText = null;
      await this.doFinalPatch(finalText);
    }
  }

  /** 收到 message_event_appended 事件：追加到 buffer，触发 debounce flush */
  onTextDelta(delta: string): void {
    this.buffer += delta;
    this.scheduleFlush();
  }

  /** 收到 message_status_changed 事件：最终 flush + 标记完成 */
  async onEnd(finalText?: string): Promise<void> {
    this.clearTimer();
    if (this.finalized) return;
    this.finalized = true;

    // onStart 尚未完成：暂存 finalText，等 onStart 完成后处理
    if (!this.feishuMessageId) {
      this.pendingEndText = finalText ?? this.buffer;
      return;
    }

    await this.doFinalPatch(finalText ?? this.buffer);
  }

  /** 清理资源，用于 LobbyAwareChannel.stop() 时取消 pending timer */
  dispose(): void {
    this.clearTimer();
  }

  private async doFinalPatch(text: string): Promise<void> {
    if (!this.feishuMessageId) return;
    const rendered = this.render(text);
    try {
      await this.transport.patchText({ messageId: this.feishuMessageId, text: rendered });
    } catch (patchError) {
      // 降级：如果 PATCH 失败，尝试重新发送
      try {
        await this.transport.sendText({ chatId: this.chatId, text: rendered });
      } catch (fallbackError) {
        logger.warn("Feishu streaming fallback sendText also failed", {
          chatId: this.chatId, messageId: this.feishuMessageId,
          patchError: patchError instanceof Error ? patchError.message : String(patchError),
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }
  }

  private scheduleFlush(): void {
    if (this.finalized || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  private async flush(): Promise<void> {
    if (!this.feishuMessageId || !this.buffer) return;
    const rendered = this.render(this.buffer);
    try {
      await this.transport.patchText({ messageId: this.feishuMessageId, text: rendered });
    } catch {
      // flush 失败不中断，等 onEnd 重试
    }
  }

  private render(text: string): string {
    const prefix = `[${this.roleName}] `;
    const maxBody = this.config.maxLength - prefix.length;
    const body = text.length > maxBody ? text.slice(0, maxBody) + "…" : text;
    return prefix + body;
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
```

### LobbyAwareChannel 出站路径改造

`src/interaction-entry/im-channel/lobby-aware-channel.ts` 的 `handleOutbound` 方法改造。

**echo prevention**：提到 switch 之前，作为所有事件类型的公共前置检查。虽然当前 `message_started` 只由 assistant role 触发（human role 不会产生），但不应依赖这个隐式假设。

**stop() 清理**：遍历所有 streaming sessions 调用 `dispose()` 取消 pending timer，防止 timer 泄漏。

**cleanupSessionSubscriptions 清理**：Web UI 重置 session 时调用，需同步清理该 chatId 关联的 streaming sessions，防止孤儿 session 的 timer 继续触发 PATCH。

```typescript
/** conversationId:messageId → 流式会话 */
private readonly streamingSessions = new Map<string, FeishuStreamingSession>();

// stop() 中新增清理
async stop(): Promise<void> {
  for (const { unsubscribe } of this.conversationSubscriptions.values()) unsubscribe();
  this.conversationSubscriptions.clear();
  this.sessionToConversation.clear();
  this.chatIdToConversations.clear();
  this.processedInbound.clear();
  this.pendingInbound.clear();
  this.recentForwardedMessages.clear();
  // 清理流式会话的 pending timer
  for (const session of this.streamingSessions.values()) session.dispose();
  this.streamingSessions.clear();
  await this.deps.transport.stop?.();
}

private async handleOutbound(chatId: string, event: ConversationOutboundEvent): Promise<void> {
  // echo prevention：所有事件类型统一前置检查
  if (event.role_name === HUMAN_ROLE_NAME) {
    const sourceChatId = this.recentForwardedMessages.get(event.message_id);
    if (sourceChatId === chatId) {
      this.recentForwardedMessages.delete(event.message_id);
      return;
    }
    if (this.pendingForwardChatId === chatId) return;
  }

  // 流式未启用：走原路径（每个 message_event_appended 独立 sendText）
  if (!this.config.streamingEnabled) {
    if (event.type !== "message_event_appended") return;
    if (event.event.kind !== "text" && event.event.kind !== "content_block") return;
    const rawText = extractEventText(event);
    if (!rawText) return;
    const text = this.deps.responseRenderer.renderOutboundMessage({
      roleName: event.role_name, text: rawText, maxLength: this.config.maxTextLength,
    });
    await this.deps.transport.sendText({ chatId, text });
    return;
  }

  const sessionKey = `${event.conversation_id}:${event.message_id}`;

  switch (event.type) {
    case "message_started": {
      const flushIntervalMs = Math.max(this.config.streamingFlushIntervalMs ?? 300, 100);
      const session = new FeishuStreamingSession(chatId, event.role_name, this.deps.transport, {
        flushIntervalMs,
        maxLength: this.config.maxTextLength,
      });
      this.streamingSessions.set(sessionKey, session);
      try {
        await session.onStart();
      } catch (error) {
        // onStart 失败（网络、权限、限流）：移除 session，后续事件走降级路径
        this.streamingSessions.delete(sessionKey);
        logger.warn("Feishu streaming onStart failed, falling back to non-streaming", {
          chatId, messageId: event.message_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }

    case "message_event_appended": {
      if (event.event.kind !== "text" && event.event.kind !== "content_block") return;
      const rawText = extractEventText(event);
      if (!rawText) return;

      const session = this.streamingSessions.get(sessionKey);
      if (session) {
        session.onTextDelta(rawText);
      } else {
        // 降级：无流式会话时走原路径
        const text = this.deps.responseRenderer.renderOutboundMessage({
          roleName: event.role_name, text: rawText, maxLength: this.config.maxTextLength,
        });
        await this.deps.transport.sendText({ chatId, text });
      }
      break;
    }

    case "message_status_changed": {
      const session = this.streamingSessions.get(sessionKey);
      if (session) {
        const finalText = extractFinalText(event);
        await session.onEnd(finalText);
        this.streamingSessions.delete(sessionKey);
      }
      break;
    }
  }
}
```

### extractFinalText 函数

从 `message_status_changed` 事件的 `context` 中提取最终文本。fallback 优先级：`mcp_final_body > auto-extracted context > null`（null 时 session 内部 fallback 到 buffer）。

```typescript
function extractFinalText(event: ConversationOutboundEvent): string | null {
  if (event.type !== "message_status_changed") return null;
  const raw = event.context;
  if (typeof raw !== "object" || raw === null) return null;
  const context = raw as Record<string, unknown>;
  // MCP 显式提交的最终正文优先
  if (context.kind === "mcp_final_body" && typeof context.context === "string") {
    return context.context;
  }
  // auto-extracted context fallback
  if (typeof context.context === "string") {
    return context.context;
  }
  return null;
}
```

### 频率控制策略

- **debounce interval**: 300ms。Agent 通常以 50-200ms 间隔产生文本事件，300ms 可以合并 2-6 个事件为一次 PATCH 调用。
- **单消息 QPS**: 1000/300 ≈ 3.3 QPS，低于飞书限制（~5 QPS）。
- **失败容忍**: flush 失败不中断流式，等待 onEnd 做最终 PATCH；onEnd PATCH 失败则降级为 sendText 重新发送。
- **超长文本**: 超过 `max_text_length` 的内容在 flush 时截断，与现有行为一致。
- **并发安全**: buffer 是 append-only 的（`onTextDelta` 只追加不修改），`render()` 是确定性函数，PATCH 是全量替换。即使 flush 因网络慢与下次 onTextDelta 并发，也不会出现内容回退——后续 PATCH 一定是前一次的超集。

### 配置扩展

`LobbyAwareChannelConfig` 新增可选字段：
- `streamingEnabled?: boolean` — 从 `feishu.json` 的 `message_push.streaming.enabled` 读取。未配置时默认 `false`（向后兼容，现有用户升级后行为不变）。
- `streamingFlushIntervalMs?: number` — 从 `message_push.streaming.flush_interval_ms` 读取。未配置时默认 300，读取时 clamp 到最小 100（`Math.max(value, 100)`），防止过小值触发飞书限流风暴。

**默认值说明**：`streaming.enabled` 在 `feishu.json.example` 中默认为 `true`（引导新用户启用），但代码中未配置时默认 `false`（向后兼容）。这是有意为之——新安装用户从 example 复制配置即可获得流式体验，已有用户升级不会改变行为。

`config/feishu.json.example` 新增流式配置：

```json
{
  "message_push": {
    "max_text_length": 4000,
    "_streaming_help": "飞书流式响应配置。启用后 Agent 回复会通过消息更新 API 逐步推送到飞书。",
    "streaming": {
      "_enabled_help": "是否启用流式响应。false 时走原路径（逐条消息发送）。",
      "enabled": true,
      "_flush_interval_ms_help": "流式更新的 debounce 间隔（毫秒）。太小会触发限流，太大会感觉卡顿。默认 300，最小 100。",
      "flush_interval_ms": 300
    }
  }
}
```

### 降级策略

1. **PATCH API 不可用**（权限未开通、SDK 版本不支持）：onEnd 中 PATCH 失败时，降级为 sendText 发送最终文本。
2. **流式配置关闭**（`streaming.enabled: false`）：走原路径，每个 `message_event_appended` 独立 sendText。
3. **流式配置缺失**（现有 `config/feishu.json` 无 `streaming` 字段）：配置读取时 `streaming?.enabled ?? false`，默认关闭走原路径，向后兼容。
4. **message_started 未捕获**（事件丢失）：`message_event_appended` 时无 session，降级为 sendText。
5. **消息过长**：flush 时截断到 `max_text_length`，最终 PATCH 也截断。
6. **onStart/onEnd 竞态**：onEnd 先到时暂存 finalText，onStart 完成后立即做最终 PATCH，不会出现占位消息永久残留。
7. **服务重启**：`streamingSessions` 是进程内状态，重启后丢失。飞书端的"思考中..."占位消息不会被 PATCH，但 Agent 后续事件通过 `rehydrateSubscriptions` 恢复的订阅走降级路径（sendText）。用户看到"思考中..." + 若干独立消息并存。已知限制，后续可通过 startup recovery 扩展解决。

## 生效路径

1. `src/interaction-entry/feishu/types.ts` — `FeishuTransport` 接口 `sendText` 返回类型改为 `Promise<string>`，新增 `patchText`。
2. `src/interaction-entry/feishu/sdk-transport.ts` — 实现新接口方法。
3. `src/interaction-entry/feishu/streaming-session.ts` — 新增流式会话管理器。
4. `src/interaction-entry/im-channel/lobby-aware-channel.ts` — `handleOutbound` 改造为事件类型分发；`cleanupSessionSubscriptions` 补充 streaming session 清理。
5. `src/interaction-entry/feishu/config.ts` — 读取 streaming 配置，`flush_interval_ms` clamp 到最小 100。
6. `src/interaction-entry/im-channel/interface.ts` — `LobbyAwareChannelConfig` 新增 `streamingEnabled` 和 `streamingFlushIntervalMs` 可选字段。
7. `config/feishu.json.example` — 新增 streaming 配置项。
8. 测试覆盖流式会话生命周期、debounce、降级和配置边界。

## 改动范围

1. 扩展 `FeishuTransport` 接口（`sendText` 返回 message_id，新增 `patchText`）。
2. `FeishuSdkTransport` 实现 PATCH API 调用。
3. 新增 `streaming-session.ts`（~80 行）。
4. 改造 `LobbyAwareChannel.handleOutbound`（~40 行变更）；`cleanupSessionSubscriptions` 补充 streaming session 清理。
5. `LobbyAwareChannelConfig` 新增 `streamingEnabled`、`streamingFlushIntervalMs`，配置读取 clamp 到最小 100ms。
6. 配置文件和配置读取更新。
7. 新增/更新测试。

## 验证

1. `npm run build` 通过。
2. `npm run check` 通过。
3. 流式会话单元测试：onStart → onTextDelta × N → onEnd 生命周期。
4. debounce 测试：连续 onTextDelta 在 flushIntervalMs 内只触发一次 PATCH。
5. 竞态测试：onEnd 在 onStart 完成前到达 → onStart 完成后立即执行最终 PATCH，占位消息不残留。
6. onStart 失败测试：sendText 抛异常 → session 从 map 移除 → 后续 message_event_appended 走降级 sendText 路径。
7. 降级测试：PATCH 失败时 onEnd 降级为 sendText；sendText 也失败时 logger.warn 输出两条错误信息。
8. echo prevention 测试：message_started/message_status_changed 事件也受 echo prevention 约束。
9. 配置测试：`streaming.enabled: false` 时走原路径；`streaming` 字段缺失时默认关闭；`flush_interval_ms` 小于 100 时 clamp 到 100。
10. dispose 测试：stop() 后 pending timer 不触发。
11. sendText 响应测试：飞书返回缺少 message_id 时抛明确错误，不返回 undefined。
12. 集成测试：模拟 Agent 流式事件 → 验证飞书 API 调用序列。

## 风险与决策记录

**决策记录：使用文本消息 PATCH 而非 CardKit 流式 API。** 原因：CardKit 需要额外权限申请和卡片模板管理，改动范围大；文本 PATCH 够用且与现有 sendText 一致。后续如需富文本渲染可升级为 CardKit。

**决策记录：debounce 300ms 而非逐 token 更新。** 原因：飞书 PATCH API 限流 ~5 QPS/消息，逐 token 会触发 429。300ms 是延迟和限流的平衡点。

**决策记录：message_started 触发占位消息而非等到第一次文本事件。** 原因：用户发消息后立即看到"思考中..."提供即时反馈，避免"无响应"的焦虑感。

**风险：飞书 PATCH API 权限。** 飞书应用需要开通 `im:message` 权限范围中的"更新消息"能力。如果权限不足，PATCH 会返回 403，此时走降级路径。需在部署文档中说明权限要求。

**风险：SDK PATCH 方法签名。** `@larksuiteoapi/node-sdk@^1.62.1` 的 `FeishuSdkModule` 接口当前只声明了 `im.v1.message.create`，未声明 `patch`。实现前需验证 SDK 是否导出了 `im.v1.message.patch` 及其参数结构。如果 SDK 类型不完整但运行时支持，需要补充类型声明；如果 SDK 不支持 patch，需要退化为直接 HTTP 调用（SDK 的 `Client` 通常支持自定义请求）。
