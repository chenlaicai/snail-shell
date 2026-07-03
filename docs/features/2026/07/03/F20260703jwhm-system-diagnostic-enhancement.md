---
id: F20260703jwhm
title: system-diagnostic-enhancement
from_ids: []
tags: [infra, reliability, event-loop, mcp, diagnostic]
modules: [infra]
doc_kind: spec
change_type: feature
---

# F20260703jwhm [infra] 系统诊断能力增强：事件循环阻塞源捕获、MCP 端点诊断

## 背景

2026-07-02 日志排查发现系统存在异常：

1. **事件循环阻塞**：Node.js 事件循环被反复阻塞，最长 24.4 分钟（18:01），导致所有 HTTP 请求、WebSocket 消息、Agent 协调冻结。当前 `startEventLoopMonitor()` 仅记录延迟数值，无法定位阻塞源。
2. **MCP 404**：`snail-issue`、`rednote-research`、`snail-knowledge` 三个 MCP 端点返回 404，无诊断日志。

2026-07-03 日志再次确认问题：事件循环阻塞 7 次，最长 18.8 分钟（1,127,906ms）。

### 历史修复溯源

系统卡住问题此前已修复多次，但都是针对症状而非根因：

| 时间 | Feature | 问题 | 修复 | 是否触及根因 |
|------|---------|------|------|-------------|
| 2026-05-28 | F2026052805 | uncaughtException 空错误对象导致对话卡住 | 添加 stdout.on("error") 处理器 | ❌ 症状修复 |
| 2026-06-25 | F20260625bc8d | 5 个并发 agent 时前端卡死 | WebSocket 事件批处理 + React.memo + 虚拟化 | ❌ 症状修复（前端） |
| 2026-06-26 | F20260626k7xm | sendMessage 的 route() 阻塞 HTTP 响应 | route() 改为 fire-and-forget | ❌ 症状修复 |
| 2026-06-26 | F20260626vexy | sendMessage 的 resolveToSpeakers/notifyConsumers 阻塞 | 整个 sendMessage 异步化 + 事件循环监控 | ❌ 症状修复 + 诊断 |
| 2026-07-02 | 本次 | 24.4 分钟事件循环阻塞 + 7 个 stuck invocations | **根因修复**（4 个 Feature） | ✅ 根因修复 |

**修复模式**：发现一个阻塞点 → 修复那个阻塞点 → 问题暂时消失 → 新的阻塞点出现

**关键洞察**：之前的修复解决了用户感知到的症状（UI 卡死、HTTP 阻塞），但没有触及产生阻塞的架构层（同步 I/O）。问题会反复出现，只要 I/O 层是同步的，任何文件系统压力都可能导致事件循环阻塞。

### 根因分析（交叉审视后补充）

经架构师交叉审视，确认事件循环阻塞的根因是 **I/O 层全面使用同步 API**：

| 层级 | 文件 | 问题 |
|------|------|------|
| 数据库 | `infra/database.ts` | `better-sqlite3` 全同步，每次 `.run()`/`.get()`/`.all()` 阻塞事件循环 |
| 文件 I/O | `infra/file-loader.ts` | 所有方法用 `readFileSync`/`writeFileSync`/`readdirSync`/`rmSync` |
| 启动初始化 | `main.ts:initModules()` | 6 个模块构造函数同步读取数百个文件 |
| Agent 配置 | `acs/utils/mcp-config.ts` | 每次 Agent 调用前 5-15 个同步文件操作 |

**本 Feature 不修复根因**，仅提供诊断能力。根因修复见：
- `F20260702hzqx`（I/O 层异步化）
- `F20260702gynt`（Agent 调用生命周期加固）
- `F20260702gmpv`（输入边界校验）

## 目标

- 事件循环阻塞时自动捕获阻塞源的调用栈，便于定位根因
- MCP 端点 404 时记录配置状态，便于排查

## 非目标

- 不修复事件循环阻塞的根因（I/O 层异步化见独立 Feature）
- 不修复 Agent 调用生命周期问题（见独立 Feature）
- 不修复 AutoAdvance 空指针问题（见独立 Feature）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | When 事件循环阻塞超过 5 秒 | 自动捕获当前调用栈并记录到日志（`event_loop.blocked_at`），包含阻塞时长和完整堆栈 | 单元测试 |
| B2 | When MCP 端点返回 404（包括未匹配路径） | 记录 `mcp.endpoint.not_found` 日志，包含端点路径、请求方法和已注册的端点列表 | 手动测试 |

## 设计

### 1. 事件循环阻塞源捕获

当前 `startEventLoopMonitor()` 使用 `setInterval` 检测延迟，但无法知道阻塞发生在哪段代码。引入 `blocked-at` 库（或等效实现），在检测到阻塞时自动捕获调用栈。

**方案**：使用 `blocked-at` 库，它通过 monkey-patch `setTimeout`/`setInterval` 等异步 API，在回调延迟执行时自动记录调用栈。

```typescript
import blocked from 'blocked-at';

// 在 main.ts 的 startEventLoopMonitor 中替换现有实现
function startEventLoopMonitor(): void {
  const cleanup = blocked((time, stack) => {
    if (time > 5000) { // 超过 5 秒才记录
      log.warn({ delayMs: time, stack }, 'event_loop.blocked_at');
    }
  }, { threshold: 200 }); // 200ms 阈值，与现有逻辑一致

  // 进程退出时清理
  process.on('exit', () => cleanup());
}
```

**关键约束**：
- `blocked-at` 使用 `async_hooks`，有约 5-10% 性能开销
- **默认启用**，通过环境变量 `BLOCKED_AT_ENABLED=false` 显式关闭（生产环境问题排查是主要场景）
- 调用栈可能较长，日志中截断到前 20 帧

**替代方案**：手动在每个异步操作前后打点（侵入性太强，不可行）

### 2. MCP 端点诊断日志

当 MCP 端点返回 404 时，记录已注册的端点列表，便于排查配置问题。

**方案**：在 MCP handler 中添加两个层面的诊断日志：

**2a. 精确路由 404**：在 `GET /:serverName` 和 `POST /:serverName` 路由中，找不到 server 时记录日志。

**2b. 全局 404 handler**：添加 Hono 的 `.notFound()` 处理器，捕获所有未匹配路径：

```typescript
app.notFound((c) => {
  log.warn({
    path: c.req.path,
    method: c.req.method,
    registeredEndpoints: Object.keys(routes)
  }, 'mcp.endpoint.not_found');
  return c.text('Not Found', 404);
});
```

**关键约束**：
- 仅在 404 时记录，不影响正常请求性能
- 记录已注册端点列表、请求路径和方法，便于对比配置

## 决策记录

| 决策 | 选择 | 正面理由 | 反面理由/风险 |
|------|------|----------|---------------|
| 事件循环监控方案 | `blocked-at` 库 | 成熟方案，自动捕获调用栈，无需侵入业务代码 | 有 5-10% 性能开销；可通过 `BLOCKED_AT_ENABLED=false` 关闭 |
| `blocked-at` 启用策略 | 默认启用 | 生产环境问题排查是主要场景，重启才能开启不现实 | 性能敏感场景需显式关闭 |
| Feature 定位 | 诊断工具，非根因修复 | 诊断能力立即可用，为后续根因修复提供数据 | 不解决事件循环阻塞根因，仅提供可见性 |

## 生效路径

- `src/main.ts` — 替换 `startEventLoopMonitor` 实现，引入 `blocked-at`
- `src/infra/mcp-server/handler.ts` — 添加精确路由 404 诊断日志和全局 `.notFound()` 处理器

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/main.ts` | 修改 | 替换事件循环监控实现，引入 `blocked-at` |
| `src/infra/mcp-server/handler.ts` | 修改 | 添加精确路由 404 诊断日志和全局 `.notFound()` 处理器 |
| `src/types/blocked-at.d.ts` | 新增 | `blocked-at` TypeScript 类型声明 |
| `package.json` | 修改 | 添加 `blocked-at` 依赖 |

## 不兼容更新

无。所有变更均为向后兼容的诊断增强。

## 验证

- [x] TypeScript 编译通过
- [x] 现有测试全部通过（211/211）
- [ ] 启动服务（`blocked-at` 默认启用），人为阻塞事件循环（如 `sleep(10)`），验证日志输出 `event_loop.blocked_at` 且包含调用栈
- [ ] 访问未注册的 MCP 端点（如 `/mcp-server/foo/bar`），验证日志输出 `mcp.endpoint.not_found` 且包含已注册端点列表
- [ ] 设置 `BLOCKED_AT_ENABLED=false` 启动服务，验证 `blocked-at` 未启用且服务正常运行

## 关联 Feature

| Feature | 定位 | 解决的根因 |
|---------|------|-----------|
| F20260703jwhm（本文档） | 诊断工具 | 提供事件循环阻塞源捕获和 MCP 端点诊断能力 |
| F20260702hzqx | 根因修复 | I/O 层异步化，消除事件循环阻塞根源 |
| F20260702gynt | 根因修复 | Agent 调用生命周期加固，消除 stuck invocations |
| F20260702gmpv | 根因修复 | 输入边界 Zod 校验，消除 AutoAdvance 空指针 |
