---
id: F20260629smrx
title: 修复 Issue Board 实时刷新：Vite proxy + WebSocket 架构缺陷
from_ids: [F20260626bxqf]
tags: [bugfix, vite, proxy, websocket, board, realtime, refactor]
modules: [web, infra]
---
# 修复 Issue Board 实时刷新：Vite proxy + WebSocket 架构缺陷

**编号**：F20260629smrx
**状态**：development
**变更类型**：bugfix + refactor
**创建**：2026-06-29

## 问题

Issue Board 实时刷新功能（F20260626bxqf）已合入 main，存在两个问题：

### 问题 1：开发模式下 Board 实时刷新失效（直接 Bug）

`src/web/vite.config.ts` 的 proxy 配置缺少 `/workspace-events` 条目：

```typescript
proxy: {
  "/api": backendHttpBaseUrl,
  "/mcp-server": backendHttpBaseUrl,
  "/issue-events": {
    target: backendHttpBaseUrl,
    ws: true,    // ← 有 WebSocket 代理
  },
  // ← /workspace-events 缺失！
},
```

**技术细节**：

1. **生产环境**：`@hono/node-server` v2.0.6 的 `setupWebSocket` 使用共享的 `waiterMap`，单个 WSS 可以处理所有路由的 WebSocket 升级。`/workspace-events` 在生产环境下可正常工作。

2. **开发环境**：Vite dev server 的 proxy 配置没有 `/workspace-events` 条目。前端 `useWorkspaceRealtime.ts` 连接 `ws://localhost:5173/workspace-events`，但 Vite 不会将其代理到后端 3000 端口，导致连接直接失败。

**结论**：问题仅在开发模式下存在，生产环境不受影响。

### 问题 2：WebSocket 架构缺陷（架构问题）

`src/main.ts` 中创建了两个独立的 `WebSocketServer`：

```typescript
const issueWebSocketBridge = createIssueWebSocketBridge(modules.collaboration.adapter);
const workspaceWebSocketBridge = createWorkspaceWebSocketBridge(modules.collaboration.adapter);
// ...
serve({ fetch: app.fetch, port, websocket: { server: issueWebSocketBridge.server } }, ...);
```

**问题**：`workspaceWebSocketBridge.server` 是**死代码**：
- 被创建（`workspace-websocket.ts` 第 21 行）
- 从未被 `serve()` 使用（`main.ts` 第 148 行只传入 `issueWebSocketBridge.server`）
- 从未处理任何请求
- 误导后续开发者以为两个 WSS 各自独立工作

**架构与实际行为不一致**：`@hono/node-server` 的 `setupWebSocket` 使用共享的 `waiterMap`，单个 WSS 处理所有路由升级。但代码创建了两个 WSS，让人以为它们各自独立工作。

## 设计目标

1. 修复开发模式下 `/workspace-events` WebSocket 代理，使 Board 实时刷新在开发环境生效
2. 消除死代码，让架构与实际行为一致
3. 两个问题在同一 PR 中解决（都源于同一特性 F20260626bxqf 的缺陷）

## 核心业务行为

- **当开发模式下客户端连接 `/workspace-events?workspace_id=xxx` 时**，Vite 应将其代理到后端 3000 端口
- **当开发模式下客户端连接 `/issue-events?issue_id=xxx` 时**，现有代理应保持不变
- **当生产环境下**，无需任何改动
- **当后续开发者查看 WebSocket 代码时**，应能清晰理解单个 WSS 处理所有路由

## 详细设计

### 方案概述

两个改动在同一 PR 中完成：

1. **Vite proxy 补齐**：在 `vite.config.ts` 添加 `/workspace-events` proxy 配置
2. **合并为统一 WebSocket bridge**：将 `createIssueWebSocketBridge` 和 `createWorkspaceWebSocketBridge` 合并为 `createUnifiedWebSocketBridge`，使用单个 WSS

### 改动 1：Vite proxy 补齐

`src/web/vite.config.ts`：

```typescript
proxy: {
  "/api": backendHttpBaseUrl,
  "/mcp-server": backendHttpBaseUrl,
  "/issue-events": {
    target: backendHttpBaseUrl,
    ws: true,
  },
  "/workspace-events": {  // ← 新增
    target: backendHttpBaseUrl,
    ws: true,
  },
},
```

### 改动 2：合并为统一 WebSocket bridge

新建 `src/infra/http/unified-websocket.ts`：

```typescript
import type { MiddlewareHandler } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { getLogger } from "@infra/logger";
import type { CollaborationInput, CollaborationConsumer, WorkspaceConsumer } from "@app/issue-collaboration/port";

const log = getLogger({ module: "websocket" });

interface UnifiedWebSocketBridge {
  server: WebSocketServer;
  route: MiddlewareHandler;
}

export function createUnifiedWebSocketBridge(collaboration: CollaborationInput): UnifiedWebSocketBridge {
  const wss = new WebSocketServer({ noServer: true });

  return {
    server: wss,
    route: upgradeWebSocket((c) => {
      const url = new URL(c.req.url);
      const isIssueRoute = url.pathname === "/issue-events";
      const isWorkspaceRoute = url.pathname === "/workspace-events";

      if (!isIssueRoute && !isWorkspaceRoute) {
        return {
          onOpen(_event, socket) {
            socket.close(1008, "Unknown WebSocket route");
          },
        };
      }

      const issueId = isIssueRoute ? url.searchParams.get("issue_id") : null;
      const workspaceId = isWorkspaceRoute ? url.searchParams.get("workspace_id") : null;

      let issueConsumer: CollaborationConsumer | null = null;
      let workspaceConsumer: WorkspaceConsumer | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (isIssueRoute && issueId && issueConsumer) {
          log.info({ issueId }, "issue-events disconnected");
          collaboration.unregisterIssueConsumer(issueId, issueConsumer);
          issueConsumer = null;
        }
        if (isWorkspaceRoute && workspaceId && workspaceConsumer) {
          log.info({ workspaceId }, "workspace-events disconnected");
          collaboration.unregisterWorkspaceConsumer(workspaceId, workspaceConsumer);
          workspaceConsumer = null;
        }
      };

      return {
        onOpen(_event, socket) {
          if (isIssueRoute) {
            if (issueConsumer) return;
            if (!issueId) {
              log.warn("rejected issue-events websocket without issue_id");
              socket.close(1008, "issue_id is required");
              return;
            }
            log.info({ issueId }, "issue-events connected");
            issueConsumer = createIssueConsumer(issueId, socket, collaboration);
            collaboration.registerIssueConsumer(issueId, issueConsumer);
          }

          if (isWorkspaceRoute) {
            if (workspaceConsumer) return;
            if (!workspaceId) {
              log.warn("rejected workspace-events websocket without workspace_id");
              socket.close(1008, "workspace_id is required");
              return;
            }
            log.info({ workspaceId }, "workspace-events connected");
            workspaceConsumer = createWorkspaceConsumer(socket);
            collaboration.registerWorkspaceConsumer(workspaceId, workspaceConsumer);
          }

          heartbeatTimer = setInterval(() => {
            try {
              socket.send(JSON.stringify({
                type: "heartbeat",
                ts: Date.now(),
                ...(isIssueRoute ? { issue_id: issueId } : {}),
              }));
            } catch {
              socket.close(1001, "heartbeat failed");
              cleanup();
            }
          }, 30_000);
        },
        onClose() {
          cleanup();
        },
      };
    }),
  };
}

// createIssueConsumer 和 createWorkspaceConsumer 实现...
// （从 stage-websocket.ts 和 workspace-websocket.ts 复用）
```

修改 `src/main.ts`：

```typescript
// 删除：
import { createIssueWebSocketBridge } from "@infra/http/stage-websocket";
import { createWorkspaceWebSocketBridge } from "@infra/http/workspace-websocket";

// 新增：
import { createUnifiedWebSocketBridge } from "@infra/http/unified-websocket";

// 删除：
const issueWebSocketBridge = createIssueWebSocketBridge(modules.collaboration.adapter);
const workspaceWebSocketBridge = createWorkspaceWebSocketBridge(modules.collaboration.adapter);
app.get("/issue-events", issueWebSocketBridge.route);
app.get("/workspace-events", workspaceWebSocketBridge.route);
serve({ fetch: app.fetch, port, websocket: { server: issueWebSocketBridge.server } }, ...);

// 新增：
const wsBridge = createUnifiedWebSocketBridge(modules.collaboration.adapter);
app.get("/issue-events", wsBridge.route);
app.get("/workspace-events", wsBridge.route);
serve({ fetch: app.fetch, port, websocket: { server: wsBridge.server } }, ...);
```

### 边界情况

| 场景 | 处理方式 |
|------|----------|
| 开发模式连接 `/workspace-events` | Vite proxy 将其代理到后端 3000 端口 |
| 开发模式连接 `/issue-events` | 现有配置不变 |
| 生产环境 | 无需改动，已有配置正常工作 |
| 后续开发者查看 WebSocket 代码 | 单个 WSS，清晰明了 |

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/web/vite.config.ts` | 修改 | 添加 `/workspace-events` proxy 配置 |
| `src/infra/http/unified-websocket.ts` | 新建 | 统一 WebSocket bridge，处理 `/issue-events` 和 `/workspace-events` |
| `src/main.ts` | 修改 | 使用统一 bridge 替换两个独立 bridge |
| `src/infra/http/stage-websocket.ts` | 标记废弃 | 保留作为参考，标记为 deprecated |
| `src/infra/http/workspace-websocket.ts` | 标记废弃 | 保留作为参考，标记为 deprecated |

## 设计取舍记录

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| 同一 PR 解决两个问题 vs 分两个 PR | 两个问题都源于同一特性缺陷，逻辑上是一体的 | PR 稍大 | 选择同一 PR，逻辑清晰 |
| 合并为统一 bridge vs 保留两个独立 WSS | 消除死代码，架构与实际行为一致 | 需要新建文件、修改 main.ts | 选择合并，消除架构缺陷 |
| 新建 unified-websocket.ts vs 修改现有文件 | 清晰分离，易于回滚 | 增加文件数量 | 选择新建，职责清晰 |

## 验证计划

1. 启动开发模式（`npm run dev`）
2. 打开 Issue Board 页面，检查浏览器 DevTools Network 面板：
   - `/workspace-events` 连接应显示 101 Switching Protocols
   - 应收到 heartbeat 消息
3. 触发 issue 状态变化（如 sendMessage），检查 Board 页面是否实时更新
4. 打开 Issue Conversation 页面，检查 `/issue-events` 连接是否正常
5. 同时打开两个页面，检查两个 WebSocket 连接是否独立工作
6. 检查 `unified-websocket.ts` 中的路由区分逻辑是否正确

## 检视意见记录

### 第一轮：架构师-1 初始分析（错误）

- **根因**：`serve()` 只传入一个 WSS，导致 `/workspace-events` 静默失败
- **方案**：合并为统一 bridge

### 第二轮：架构师-2 对抗性检视（纠正）

- **发现**：根因分析错误，`@hono/node-server` 的 `setupWebSocket` 使用共享 `waiterMap`，单个 WSS 可处理所有路由
- **纠正**：真正 Bug 是 Vite proxy 缺失 `/workspace-events`
- **方案**：仅修改 `vite.config.ts`

### 第三轮：架构师-2 进一步检视（补充）

- **发现**：方案过度简化，忽略了架构缺陷
- **补充**：`workspaceWebSocketBridge.server` 是死代码，合并 bridge 不是"不必要的重构"，是让架构与实际行为一致
- **最终方案**：同时修复 Vite proxy 和合并 WSS
