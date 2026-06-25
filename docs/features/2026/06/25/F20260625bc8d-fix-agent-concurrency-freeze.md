---
id: F20260625bc8d
title: fix-agent-concurrency-freeze
from_ids: []
tags: [collaboration, web, performance, websocket, concurrency, bugfix]
modules: [core, web, infra]
doc_kind: spec
change_type: bugfix
---

# F20260625bc8d [core][web] 修复多 Agent 并发时系统卡死

## 背景

当多个 agent 同时运行时，任何操作（新建 issue、加载 SOP 等）都会卡住。用户反馈 5 个并发 agent 即可触发，但业务需求远不止 5 并发。

## 排查过程

### 第一轮：后端资源排查（排除）

| 指标 | 实测值 | 结论 |
|------|--------|------|
| CPU 占用 | 正常 | 排除 |
| 内存占用 | 24GB/32GB，agent 进程仅占 ~1.6GB | 排除 |
| 文件描述符 | 81/256 | 排除 |
| Node.js 线程数 | 14（正常） | 排除 |

### 第二轮：后端同步阻塞排查（排除）

测量 `better-sqlite3` 实际操作耗时：

| 操作 | 耗时 |
|------|------|
| `appendEvent`（INSERT + SELECT） | ~110μs |
| `mustGetStage`（SELECT by id） | ~3.6μs |

5 个 agent × 5 事件/秒 × 2 次 DB 操作/事件 = **50 次/秒 × 110μs = 5.5ms/秒**。后端 sync DB 操作仅占用 0.55% 的事件循环时间，**不是瓶颈**。

### 第三轮：前端渲染链路排查（命中）

根因在前端 WebSocket 事件处理链路：

```
5 个 agent → 50 个 WebSocket 事件/秒
  → 50 次 queryClient.setQueryData（无批处理）
    → 50 次 React 重渲染周期
      → 所有 ChatMessage 重渲染（无 React.memo）
        → 每个重新执行 marked.parse + sanitizeHtml（CPU 密集）
          → 浏览器主线程被占满
            → 用户点击/HTTP 回调/UI 更新全部排队
```

### 前端瓶颈定位

| 文件 | 问题 |
|------|------|
| `src/web/hooks/useWebSocket.ts` | 每个 WebSocket 事件直接调用 `setQueryData`，无批处理/节流 |
| `src/web/pages/IssueConversation.tsx` | 无虚拟化，每次消息变化全量重渲染所有 ChatMessage |
| `src/web/components/ChatMessage.tsx` | 无 `React.memo`，子组件 useMemo 链容易失效 |
| `src/web/components/RichTextRenderer.tsx` | 同步 `marked.parse` + `sanitizeHtml`，CPU 密集 |

## 修复方案

### 修复 1：后端 — Semaphore 限制全局 Agent 并发数

**目的**：防止系统资源耗尽（兜底保护）。

- 复用已有 `Semaphore` 类（`src/infra/semaphore.ts`）
- 在 `SnailAdapter.invokeFirstCall` / `invokeResume` 入口处 acquire，finally 中 release
- 默认最大并发 3，通过 `server.yaml` 的 `max_concurrent_agents` 可配置

### 修复 2：后端 — SQLite busy_timeout

**目的**：防止并发写入时 SQLITE_BUSY 阻塞主线程。

- `database.ts` 添加 `pragma busy_timeout = 5000`

### 修复 3：前端 — WebSocket 事件批处理

**目的**：将 50 次/秒的 `setQueryData` 合并为批量更新，减少 React 重渲染次数。

- 在 `useWebSocket.ts` 中用 `setTimeout(0)` 收集 16ms 窗口内的事件
- 一次性调用 `setQueryData` 更新所有变更
- 预期效果：50 次/秒 → ~60 次/秒（每帧一次），但每次更新批量处理多个事件

### 修复 4：前端 — React.memo 包装 ChatMessage

**目的**：防止未变化的消息被重渲染。

- `ChatMessage` 组件用 `React.memo` 包装
- 配合稳定的消息 ID 作为 key，确保只有数据变化的消息才重渲染

### 修复 5：前端 — 消息列表虚拟化

**目的**：只渲染可见消息，避免长列表全量 DOM 操作。

- 使用 `@tanstack/react-virtual` 实现虚拟滚动
- 只渲染视口内的消息 + 上下缓冲区

## 核心业务行为

| 编号 | 场景 | 预期行为 |
|------|------|----------|
| B1 | 5+ 个 agent 同时运行 | 新建 issue、加载 SOP 等操作正常响应，不卡顿 |
| B2 | agent 产出大量事件 | WebSocket 事件批量更新，浏览器不出现掉帧 |
| B3 | 消息列表超过 100 条 | 虚拟滚动只渲染可见区域，滚动流畅 |
| B4 | `server.yaml` 配置 `max_concurrent_agents: 10` | 系统支持 10 个并发 agent |

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/infra/database.ts` | 添加 `busy_timeout = 5000` pragma |
| `config/server.yaml.example` | 添加 `max_concurrent_agents` 配置项 |
| `src/infra/server-config.ts` | 读取配置，默认值 3 |
| `src/domain/snail/_internal/adapter.ts` | 引入 Semaphore，invokeFirstCall/invokeResume 包装 acquire/release |
| `src/domain/snail/_internal/initor.ts` | 适配新构造函数签名 |
| `src/main.ts` | 传入 maxConcurrentAgents |
| `src/web/hooks/useWebSocket.ts` | WebSocket 事件批处理 |
| `src/web/components/ChatMessage.tsx` | React.memo 包装 |
| `src/web/pages/IssueConversation.tsx` | 消息列表虚拟化 |

## 验证

- [x] TypeScript 编译 + lint 通过（CI build 通过）
- [x] `npm run build` 全量构建通过（含前端 vite build）
- [ ] 5 个 agent 并发运行时，新建 issue、加载 SOP 正常响应（待集成测试）
- [ ] agent 持续产出事件时，浏览器 DevTools Performance 面板无长帧（>16ms）（待集成测试）
- [ ] 消息列表超过 100 条时，滚动流畅（待集成测试）
- [ ] `server.yaml` 配置 `max_concurrent_agents: 10` 后系统正常运行（待集成测试）
