---
id: F20260626vexy
title: sendmessage-blocking-observability
tags: [bugfix, collaboration, web, performance, observability]
modules: [collaboration, http, web]
doc_kind: spec
---

# F20260626vexy [collaboration] 修复 sendMessage 外部 HTTP 调用阻塞 + 可观测性增强

## 背景

页面操作卡住问题已用多个 PR 优化（#425, #462, #472, #474, #477, #479），但仍可复现。用户报告：
- 点击一级页面无响应
- 进入 issue 卡住
- 新建 issue 加载 SOP 卡住
- 刷新页面进度条一直走不完

此前 #477 修复了 `sendMessage` 中 `await route()` 阻塞 HTTP 响应的问题（route → dispatch → invokeAgent 链路阻塞数分钟）。但排查发现 #477 遗漏了 `sendMessage` 中另外两个 `await` 外部 HTTP 调用。

## 排查过程

### 1. 审查 sendMessage 完整调用链

```typescript
// collaboration.ts:86-119 (修复前)
async sendMessage(stageId, text, fromSpeaker, toSpeakers) {
  const stage = this.mustGetStage(stageId);
  this.assertIssueOpen(stage.issue_id);

  // ❌ 阻塞点 1：await LiteAI HTTP 外部调用
  const targets = toSpeakers?.length > 0
    ? toSpeakers.map(...)
    : await this.resolveToSpeakers(stage, text, fromSpeaker);  // ← 外部 HTTP

  const message = this.deps.messagePort.createMessage({...});
  this.deps.messagePort.setContext(message.id, "final_text", text);

  // ❌ 阻塞点 2：await IM API 外部调用
  await this.notifyConsumers(stageId, "onMessageCompleted", ...);  // ← 外部 HTTP

  // ✅ #477 已修复：fire-and-forget
  void this.route(stageId, message).catch(...);
}
```

### 2. 识别两个阻塞点

| 阻塞点 | 外部调用 | 超时行为 | 阻塞时长 |
|--------|---------|---------|---------|
| `resolveToSpeakers` (L92) | LiteAI HTTP API（OpenAI 兼容）解析 @mentions | 3 次重试，指数退避 (1s, 2s, 4s) | 最长可达 `3 × timeoutMs + 7s` |
| `notifyConsumers` (L104) | 飞书/企微 IM API 发消息 | **无超时限制** | 可能卡住数分钟 |

### 3. 阻塞机制

```
用户发消息 → HTTP POST /api/stages/:stageId/messages
  → sendMessage()
    → await resolveToSpeakers()          ← 占住 HTTP 连接
      → LiteAI HTTP 调用（可能超时/重试）
    → await notifyConsumers()            ← 继续占住 HTTP 连接
      → IM API 调用（无超时，可能卡住）
    → void route()                       ← fire-and-forget（#477 已修复）
  → HTTP 响应终于返回
```

浏览器同域 HTTP/1.1 连接上限 6 个。多个 sendMessage 并发阻塞 → 6 连接全占满 → 所有 HTTP 请求排队 → UI 完全卡死。

### 4. 为什么刷新页面也卡住

刷新页面会发起新的 HTTP 请求，但这些请求需要等旧连接释放或超时。由于 `notifyConsumers` 调用的 IM API **没有超时限制**，旧连接可能长时间不释放，导致新请求也排队。

### 5. 为什么 curl 也卡住

curl 不受浏览器 6 连接限制，但如果服务端的 HTTP 连接被大量阻塞的 handler 占满（Node.js `http.Server` 虽然无连接数上限，但每个阻塞的 handler 都占住一个连接），curl 请求也需要等待事件循环处理。如果事件循环因大量 pending 的异步操作而响应变慢，curl 也会表现为"卡住"。

## 修复方案

### 核心修复：sendMessage 拆分为同步 handler + 异步 fire-and-forget 链路

```typescript
// 修复后
async sendMessage(stageId, text, fromSpeaker, toSpeakers) {
  const stage = this.mustGetStage(stageId);
  this.assertIssueOpen(stage.issue_id);

  // 同步操作：创建消息 + 持久化 context，立即返回
  const message = this.deps.messagePort.createMessage({
    stage_id: stageId, from_speaker: fromSpeaker, to_speakers: [], status: "completed",
  });
  this.deps.messagePort.setContext(message.id, "final_text", text);

  // 异步链路：全部 fire-and-forget
  void this.sendMessageAsync(stageId, stage, message, text, fromSpeaker, toSpeakers)
    .catch(err => log.error({...}, "sendMessage: async chain failed"));
}

private async sendMessageAsync(stageId, stage, message, text, fromSpeaker, toSpeakers) {
  // 1. 解析 targets（LiteAI HTTP）
  const targets = toSpeakers?.length > 0
    ? toSpeakers.map(...)
    : await this.resolveToSpeakers(stage, text, fromSpeaker);

  // 2. 更新消息 targets
  if (targets.length > 0) {
    this.deps.messagePort.updateMessageTargets(message.id, targets.map(t => t.speaker));
  }

  // 3. 通知消费者（IM HTTP）
  await this.notifyConsumers(stageId, "onMessageCompleted", ...);

  // 4. 路由
  await this.route(stageId, message);
}
```

**为什么安全**：前端已有乐观更新（`conversation.mutations.ts` 的 `onMutate`），用户消息立即显示。服务端消息已持久化（`createMessage` + `setContext` 是同步 DB 操作）。异步链路失败不影响用户看到自己的消息。

### 可观测性增强

| 文件 | 改动 | 目的 |
|------|------|------|
| `app.ts` | 慢请求告警：>5s 的请求 `log.warn("http.request.slow")` | 定位慢 handler |
| `main.ts` | 事件循环延迟监控：每 10s 检测，>200ms 告警 `event_loop.blocked` | 检测事件循环阻塞 |
| `stage-websocket.ts` | `send()` 加 try-catch，失败时 `log.warn` | 检测 WebSocket 断连 |
| `collaboration.ts` | `handleAgentEvent` 的 `void notifyConsumers` 加 `.catch()` | 检测流式事件推送失败 |
| `useWebSocket.ts` | EventBatcher 记录 `_lastEventAt` | 检测 stuck-streaming |
| `ChatMessage.tsx` | stuck-streaming 检测 + 警告 UI | 用户可见的卡住提示 |
| `IssueConversation.tsx` | WebSocket 状态横幅 | 断连/重连状态可见 |

### 下次卡住时的诊断方法

1. 服务端日志搜索 `http.request.slow` — 定位哪个 handler 慢，持续多久
2. 搜索 `event_loop.blocked` — 确认事件循环是否被阻塞
3. 搜索 `ws.send failed` — 确认 WebSocket 断连
4. 浏览器 Console 搜索 `[StuckDetector]` — 定位卡住的消息 ID 和事件数
5. 检查 WebSocket 状态横幅 — 确认是否断连

## 核心业务行为

| # | 场景 | 预期行为 | 变更影响 |
|---|------|----------|----------|
| B1 | 用户发消息 @agent | 消息立即显示（乐观更新），targets 异步解析 | 无感知变化 |
| B2 | LiteAI HTTP 超时 | sendMessage HTTP 仍立即返回，targets 解析在后台重试 | **核心修复**：不再阻塞 UI |
| B3 | IM API 卡住 | sendMessage HTTP 仍立即返回，IM 通知在后台执行 | **核心修复**：不再阻塞 UI |
| B4 | WebSocket 断连 | `send()` 失败被 catch 记录，不再静默吞错 | 可观测性提升 |
| B5 | 流式消息 stuck | 前端 90s 无新事件显示警告，Console 输出诊断信息 | 可观测性提升 |
| B6 | 事件循环阻塞 | 服务端日志每 10s 检测，>200ms 告警 | 可观测性提升 |

## 变更范围

| 文件 | 变更 |
|------|------|
| `src/app/issue-collaboration/collaboration.ts` | `sendMessage` 拆分：同步 handler + `sendMessageAsync` fire-and-forget；`handleAgentEvent` 加 `.catch()` |
| `src/infra/http/stage-websocket.ts` | `send()` 加 try-catch + log.warn |
| `src/infra/http/app.ts` | 慢请求告警 (>5s) |
| `src/main.ts` | 事件循环延迟监控 |
| `src/web/hooks/useWebSocket.ts` | EventBatcher 记录 `_lastEventAt` |
| `src/web/components/ChatMessage.tsx` | stuck-streaming 检测 + 警告 UI |
| `src/web/pages/IssueConversation.tsx` | WebSocket 状态横幅 |

## 与已有 PR 的关系

| PR | 修复内容 | 本次补充 |
|----|---------|---------|
| #477 | `sendMessage` 中 `route()` 改为 fire-and-forget | 补充 `resolveToSpeakers` 和 `notifyConsumers` 也移入 fire-and-forget |
| #479 | 中断/失败原因可观测性 | 补充 stuck-streaming 检测 + WebSocket 状态可见 |
| #462 | 前端事件批处理优化 | 补充 EventBatcher 的 `_lastEventAt` 追踪 |
| #472 | UI 渲染瓶颈修复 | 补充 stuck-streaming 警告 UI |
