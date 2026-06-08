---
id: F2026052902
title: runtime-stability-fixes
from_ids: []
tags: []
modules: [runtime, logger, message-bus, agent]
doc_kind: spec
---

# F2026052902 [runtime] 运行稳定性修复：日志序列化、流式事件竞态、关闭时子进程残留

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

生产环境中频繁出现三个运行时稳定性问题：

1. **日志 Error 对象序列化丢失信息**：`JSON.stringify(new Error())` 产出 `{}`，导致 `uncaughtException` 和 `unhandledRejection` 的实际错误信息完全丢失，无法排查问题。
2. **流式消息终态后仍追加事件**：agent 子进程在消息已被标记为终态（interrupted/completed）后继续发送流式事件，`handleStreamingEvent` 无守卫导致向已终态消息追加事件引发异常。
3. **服务关闭时 agent 子进程残留**：服务收到 SIGINT/SIGTERM 后仅关闭 HTTP server，未中断仍在运行的 agent 子进程，导致后台残留 CLI 进程。

## 目标

修复上述三个稳定性问题，提升运行时健壮性和可排查性。

## 非目标

- 不改变 agent 子进程的启动和调度逻辑
- 不改变消息生命周期状态机的正式状态转换
- 不永久关闭对话摘要生成（临时措施，待 agent 端摘要能力稳定后恢复）

## 设计

### 修复 1：Logger Error 序列化

**问题**：`JSON.stringify(new Error())` 输出 `{}`，因为 Error 的 `name`、`message`、`stack` 不是可枚举属性。

**方案**：在 Logger 中新增自定义 JSON replacer，检测 `Error` 实例并提取 `name/message/stack`。同时增加 try-catch 兜底，防止序列化本身抛异常导致日志写入失败。

**影响范围**：`src/logger/index.ts` — `write` 方法。

### 修复 2：unhandledRejection 序列化

**问题**：`unhandledRejection` 的 `reason` 可能是任意类型（null、string、object、Error），直接传入 logger 时可能丢失信息或产生无意义日志。

**方案**：新增 `serializeReason` 函数，按类型分别处理：Error 实例包裹为 `{ error }`，null 转为 `"null"`，object 保持原样，其他类型转为 String。

**影响范围**：`src/main.ts` — `registerProcessDiagnostics` 函数。

### 修复 3：流式事件竞态守卫

**问题**：`handleStreamingEvent` 不检查 `context.session.messageEnded`，当消息已终态但 agent 子进程仍在发送事件时，会尝试向已终态消息追加内容。

**方案**：在 `handleStreamingEvent` 入口增加 `if (context.session.messageEnded) return;` 守卫，静默丢弃终态后到达的事件。这是安全的，因为终态意味着消息内容已完整，后续事件无意义。

**影响范围**：`src/message-bus/message-protocol.ts` — `handleStreamingEvent` 函数。

### 修复 4：关闭时子进程清理

**问题**：`registerShutdownHandlers` 中 `shutdown` 函数仅关闭 HTTP server，未中断活跃的 agent 子进程。且 WebSocket `sendMessageAsync` 启动 agent 后立即返回，如果 shutdown 在 agent 运行期间发生，`process.exit(0)` 可能在子进程 SIGINT→SIGTERM→SIGKILL 完成前执行，导致孤儿进程。

**方案**：分三层解决：

#### 4a. 中断与清理基础设施

- `MessageInterruptRegistry` 新增 `interruptAll()` 方法，遍历所有活跃的 AbortController 并 abort
- `ProjectManager` 新增 `interruptAllRunningMessages()` 公开方法，委托给 `interruptAll()`

#### 4b. deferred stopPromise 模式

`waitForAllStopped()` 只等待**已注册**的 stopPromise。WebSocket `sendMessageAsync` 启动 agent 后立即返回，如果 stopPromise 在 `invokeRuntimeMessage` 返回后才注册，shutdown 时等待集合为空。

解决方案：**deferred 模式** — agent 启动前创建 Promise 并注册到 registry，finally 块中 resolve：

```typescript
// agent 启动前：创建 deferred Promise 并立即注册
let resolveAgentDone!: () => void;
const agentDonePromise = new Promise<void>((resolve) => { resolveAgentDone = resolve; });
deps.registerStopPromise(conversationId, messageId, agentDonePromise);

try {
  // agent 运行期间，shutdown waitForAllStopped 能等到这个 Promise
  await invokeRuntimeMessage(...);
} finally {
  // agent 完成后 resolve → waitForAllStopped 解除等待
  resolveAgentDone();
  deps.finishInterruptMessage(conversationId, messageId);
}
```

**时序保证**：`registerStopPromise` 在 `invokeRuntimeMessage` 之前 → shutdown 等待集合从 agent 运行开始就包含此任务；`finally` 块中 resolve → agent 无论正常结束、中断、失败都会 resolve。

#### 4c. shutdown 顺序与 send guard

shutdown 倒序死锁：REST `send_message` 等待 agent 完成 → HTTP 连接不关闭 → `server.close` 回调不触发 → interrupt 不执行 → agent 不退出 → 死锁。

解决方案：
1. `ProjectManager` 新增 `shuttingDown` 标志和 `markShuttingDown()` 方法
2. `sendStructuredMessage` 入口检查 `shuttingDown`，拒绝新请求
3. shutdown 顺序：`markShuttingDown()`（设标志 + interrupt）→ `waitForAllAgentProcessesStopped()` → `server.close()` → `process.exit(0)`

**影响范围**：
- `src/message-bus/message-interrupt.ts` — 新增 `interruptAll()`、`registerStopPromise()`、`waitForAllStopped()`
- `src/message-bus/collaboration.ts` — deferred 模式在 `invokeRoleBatch` 中实现
- `src/message-bus/message-protocol.ts` — `invokeRuntimeMessage` 移除 `waitForStop` 返回值
- `src/project-workflow/manager.ts` — `shuttingDown` 标志、`markShuttingDown()`、`sendStructuredMessage` guard、deps wiring
- `src/main.ts` — shutdown 顺序：`markShuttingDown` → wait → `server.close` → exit

### 临时措施：关闭对话摘要生成

**原因**：当前摘要生成依赖 agent 端状态记录，在摘要能力稳定前可能导致异常。

**方案**：将 `summaryGenerator` 传 null，禁用摘要生成。已有 fallback 机制（截断上下文），不影响基本功能。

**影响范围**：
- `src/project-workflow/manager.ts` — 构造函数和 `refreshConversationSummary` 方法

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/logger/index.ts` | 新增 `serializeMeta` 方法，Error 对象自定义序列化 |
| `src/main.ts` | 新增 `serializeReason` 函数；shutdown 顺序：`markShuttingDown` → wait → `server.close` → exit |
| `src/message-bus/message-interrupt.ts` | 新增 `interruptAll()`、`registerStopPromise()`、`waitForAllStopped()`；`stopPromises` 改为 `Map<string, Promise<void>>` |
| `src/message-bus/message-protocol.ts` | `handleStreamingEvent` 增加 `messageEnded` 守卫；`invokeRuntimeMessage` 移除 `waitForStop` 返回值 |
| `src/message-bus/collaboration.ts` | deferred 模式：agent 启动前注册 stopPromise，finally 中 resolve；`handleInvocationError` 提取 |
| `src/project-workflow/manager.ts` | `shuttingDown` 标志 + `markShuttingDown()` + send guard；`registerStopPromise` deps wiring；临时禁用摘要生成 |
| `tests/project/collaboration-test.ts` | 测试 deps 适配 `registerStopPromise` |
| `tests/project/message-interrupt-test.ts` | 新增 `registerStopPromise` / `waitForAllStopped` 测试 |

## 验证

- [x] `npm run lint`
- [x] `npx tsc --noEmit`（TypeScript 类型检查）
- [x] `npm run test`（42 个测试文件全部 pass）
- [ ] 手动验证：触发 uncaughtException 确认日志中包含 Error name/message/stack
- [ ] 手动验证：在有 interrupted message 的 conversation 中确认后续流式事件被静默丢弃
- [ ] 手动验证：Ctrl+C 后确认无残留 agent CLI 进程

## 关联

- **相关**: F2026052804（finalizeMessageLifecycle 幂等保护 — 同属运行时稳定性改进）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 摘要生成关闭后超长消息上下文使用截断而非 LLM 摘要 | 已有 fallback 机制，可接受；待 agent 端摘要能力稳定后恢复 | 2026-05-29 |
| 2 | 流式事件终态后静默丢弃 vs 抛异常 | 选择静默丢弃：终态消息内容已完整，后续事件无意义，抛异常会导致不必要的错误传播 | 2026-05-29 |
