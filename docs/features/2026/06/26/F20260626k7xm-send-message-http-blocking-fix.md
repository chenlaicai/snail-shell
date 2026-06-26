---
id: F20260626k7xm
title: send-message-http-blocking-fix
tags: [bugfix, collaboration, web, performance]
modules: [collaboration, http]
doc_kind: spec
---

# F20260626k7xm [collaboration] 修复 sendMessage HTTP 阻塞导致 UI 卡死

## 背景

当 5 个 issue 同时有 agent 运行时，Snail Shell UI 完全卡住：页面无法加载、API 请求无响应、用户操作无反馈。此前 #462 修复了前端事件批处理 + 后端并发限制，但 UI 卡死问题在 5 并发 issue 时仍可复现。

## 排查过程

### 1. 排除后端健康问题

- `GET /health` 正常响应 (1.5ms)
- API 响应正常 (53ms / 17 issues)
- 无 stuck agent：所有 agent invocation 已正常完成
- 今日日志无 error/warn 级别记录
- 数据库 WAL 正常，无锁
- 内存正常 (174MB RSS, 0.5%)

### 2. 排除 WebSocket 连接层问题

WebSocket 连接本身工作正常：
- 后端 WebSocket server 使用 `@hono/node-server` 的 `upgradeWebSocket`，每个连接独立闭包
- `ws` 库的 `send()` 不会同步抛异常，内部有缓冲
- `EventBatcher` 的 `requestAnimationFrame` + `setTimeout(50ms)` 兜底机制合理
- 前端 `useIssueRealtime` 的 cleanup 逻辑正确：`mounted` guard 防止 stale 回调

但发现 **Vite WebSocket 代理有 4 个 CLOSED 僵尸连接**（`lsof -i :3000 | grep CLOSED`），这是线索而非根因。

### 3. 定位根因：sendMessage 的 HTTP 响应被 agent 调用链 await 阻塞

追踪完整调用链发现关键问题：

```
用户发消息 → HTTP POST /api/stages/:stageId/messages
  → sendMessage() [issue.route.ts:138]
    → await collaboration.sendMessage() [collaboration.ts:84]
      → 创建消息 + notifyConsumers (快，WebSocket 推送正常)
      → await this.route(stageId, message) [collaboration.ts:105]  ← 阻塞开始
        → await Promise.all(targets.map(speaker => this.dispatch()))
          → dispatch() while 循环 [collaboration.ts:214]
            → await this.invokeAgent() [collaboration.ts:228]
              → snail adapter: acquire semaphore → agent 运行(1~5分钟) → release
              → await this.route(stageId, completedMessage) [collaboration.ts:293]
                → @mention 其他 agent → 新 dispatch → 又一轮 invokeAgent...
          → 循环直到无 unread 消息或 maxRounds=30
  → HTTP 响应终于返回 ← 整个 agent 链完成后才返回（数分钟）
```

### 4. 连接池耗尽机制

浏览器对同一 host (localhost) 的 HTTP/1.1 连接上限是 **6 个**（Chrome/Firefox 默认）。

| 连接 | 用途 | 状态 |
|------|------|------|
| #1 | POST /stages/A/messages (issue 1 agent) | 阻塞 1~5 分钟 |
| #2 | POST /stages/B/messages (issue 2 agent) | 阻塞 1~5 分钟 |
| #3 | POST /stages/C/messages (issue 3 agent) | 阻塞 1~5 分钟 |
| #4 | POST /stages/D/messages (issue 4 agent) | 阻塞 1~5 分钟 |
| #5 | POST /stages/E/messages (issue 5 agent) | 阻塞 1~5 分钟 |
| #6 | GET /workspaces/:id/issues (IssueBoard loader) | 排队等连接 → 永远等不到 |

WebSocket 连接独立于 HTTP 连接池，所以 WS 事件仍能推送（用户可能看到 agent 输出），但所有 HTTP API（加载 IssueBoard、获取 issue 详情、获取消息列表）全部被阻塞，UI 表现为"卡死"。

### 5. 为什么恰好是 5 个 issue 卡住

- 5 个 pending POST 恰好占满 6 个连接中的 5 个
- 第 6 个连接勉强能处理 1 个 API 调用，但如果该调用也触发其他请求（如 loader 的 Promise.all 多个 ensureQueryData），就会卡住
- 4 个 issue 时有 2 个空闲连接，UI 勉强能用
- 6 个 issue 时 0 个空闲连接，UI 完全无响应

## 修复方案

将 `sendMessage` 拆分为两步：
1. **同步阶段**：创建消息 + 通知 WebSocket → 立即返回 HTTP 响应
2. **异步阶段**：route/dispatch 在后台执行，不阻塞 HTTP 响应

### 核心业务行为

| # | 场景 | 预期行为 | 变更影响 |
|---|------|----------|----------|
| B1 | 用户发消息 @agent | 消息立即显示在 UI，agent 在后台运行并实时推送事件 | 用户体验改善：发消息后立即看到消息 |
| B2 | 5 个 issue 同时有 agent 运行 | HTTP 连接不被占用，其他 API 正常响应 | **核心修复** |
| B3 | Agent 失败 | route 错误在后台 try-catch 中处理，不影响用户消息 | 无变化 |
| B4 | 用户快速连续发消息 | 每条消息立即返回，route 并发执行 | 无变化（dispatch 的 pending 机制保证正确性） |

### 变更范围

| 文件 | 变更 |
|------|------|
| `src/app/issue-collaboration/collaboration.ts` | `sendMessage` 中 `route()` 改为 fire-and-forget (`void this.route(...)`) |
| `src/infra/http/routes/issue.route.ts` | 无需变更（collaboration.sendMessage 本身不再阻塞） |

`route()` 内部已有独立 try-catch（collaboration.ts:292-296），fire-and-forget 不会丢失错误。
