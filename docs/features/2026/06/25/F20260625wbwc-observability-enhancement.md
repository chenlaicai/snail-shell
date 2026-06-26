---
id: F20260625wbwc
title: observability-enhancement
from_ids: []
tags: [logging, observability, debugging]
modules: [infra, domain, app]
doc_kind: spec
---

# F20260625wbwc [infra] 可观测能力增强

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 Snail Shell 日志系统存在严重缺陷，导致关键业务事件无法追溯、故障无法被发现：

1. **关键业务事件无日志**：Issue/Stage 的创建、关闭、推进等生命周期事件完全没有日志记录。当出现问题时（如 issue 被异常关闭），无法通过日志重建"发生了什么"。

2. **错误静默吞没**：至少 6 处 catch 块要么完全静默（`.catch(() => undefined)`），要么缺少足够的上下文信息。故障发生时不会被发现，直到用户报告异常。

3. **无 HTTP 请求日志**：主 Hono app 没有请求日志中间件，无法追踪 API 调用链路。

4. **Agent 适配器日志不一致**：四个 Agent 实现中，只有 OpenCodeAgent 有完整的调用日志，其余三个仅在解析错误时记录 warn。

5. **日志断档**：2026-06-24 21:40 ~ 2026-06-25 08:00 之间无任何日志，恰好覆盖了 issue 被异常关闭的时间窗口，导致无法排查根因。根因是 pino-roll 日志轮转时创建了空文件（`snail-shell.2026-06-25.1.log` 为 0 字节），可能是服务在轮转后重启或轮转时机与服务状态不一致。

**真实案例**：Issue `9ef842de-0a6b-4085-b75f-2275b9cfd97e` 的 `closed_at` 被异常设置为与 `created_at` 相同（创建即关闭），但 `stage.left_at` 为 NULL（不符合正常 closeIssue 流程）。由于日志断档且关键操作无日志，无法确定是谁/什么操作导致了这一异常状态。

## 目标

提升系统可观测能力，确保关键业务事件可追溯、错误可被发现、请求可追踪。

### P1 — 关键业务事件日志 + HTTP 请求日志 + 错误处理规范化

**交付物**：
- Issue/Stage 生命周期事件完整日志覆盖
- 主 Hono app 请求日志中间件
- 所有静默吞没的 catch 块添加日志
- HTTP 路由层业务异常日志

**验证方式**：
- 创建/关闭 issue 时日志中有对应记录
- 每个 HTTP 请求在日志中有开始/完成记录
- 所有 `.catch(() => undefined)` 改为记录 warn 日志
- HTTP 4xx/5xx 响应在日志中有记录

### P2 — Agent 适配器日志统一

**交付物**：
- 所有 Agent 适配器统一日志格式

**验证方式**：
- 所有 Agent 调用在日志中有开始/完成/失败记录
- 日志格式与 OpenCodeAgent 一致

## 非目标

1. **不引入分布式追踪系统**（如 OpenTelemetry）：当前是单体应用，pino 日志已足够，分布式追踪是过度设计。
2. **不添加数据库查询日志**：SQLite 操作通常很快，添加查询日志会增加噪音且收益低。
3. **不添加 WebSocket 消息级日志**：消息级别日志量太大，仅在调试时按需开启。
4. **不修改日志级别配置**：保持 info 级别不变，不引入 debug/trace 级别。
5. **不包含日志监控、告警和 dashboard**：当前目标是"添加日志"，"如何使用日志"是后续 feature。
6. **不引入 request_id**：当前是单体应用，通过时间戳和上下文字段已足够关联日志。后续根据实际需要再决定是否引入完整的请求关联机制。

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户创建 issue 时 | 日志中应包含 issueId、title、sopKey、workspacePath，事件名为 `issue.created` | |
| B2 | 当用户关闭 issue 时 | 日志中应包含 issueId、closedAt、关联的 activeStageId，事件名为 `issue.closed` | |
| B3 | 当 stage 被创建时 | 日志中应包含 stageId、key、issueId、roleInstances，事件名为 `stage.created` | |
| B4 | 当 stage 被推进时 | 日志中应包含 fromStageId、toStageId、targetKey，事件名为 `stage.advanced` | |
| B5 | 当 stage-queue 处理失败时 | 日志中应包含 stageId、error，级别为 warn，事件名为 `stage.queue.error` | |
| B6 | 当 HTTP 请求返回 4xx/5xx 时 | 日志中应包含 method、path、status、error，事件名为 `http.request.error` | |
| B7 | 当 Agent 调用开始时 | 日志中应包含 agentType、snailKey、messageId，事件名为 `agent.invocation.started` | |
| B8 | 当 Agent 调用完成时 | 日志中应包含 agentType、snailKey、messageId、duration，事件名为 `agent.invocation.completed` | |

## 设计

### P1 详设

#### 1. 关键业务事件日志

**原则**：在领域适配器层添加日志，记录业务语义事件。

**日志格式规范**：
- 使用结构化日志（pino 的 JSON 格式）
- 第一个参数为上下文对象，第二个参数为事件名
- 事件名使用 `{domain}.{action}` 格式（如 `issue.created`、`stage.advanced`），HTTP 和 Agent 事件使用 `{domain}.{entity}.{action}` 格式（如 `http.request.started`、`agent.invocation.started`）
- 上下文字段标准化：`{ issueId?, stageId?, messageId? }`
- 性能说明：pino 是最快的 Node.js 日志库（基准测试：~50,000 ops/sec），对性能影响可忽略

**实施范围**：

| 文件 | 方法 | 事件名 | 上下文字段 |
|------|------|--------|-----------|
| `src/domain/issue/_internal/adapter.ts` | `createIssue()` | `issue.created` | issueId, title, sopKey, workspacePath |
| `src/domain/issue/_internal/adapter.ts` | `closeIssue()` | `issue.closed` | issueId, closedAt, activeStageId |
| `src/domain/issue/_internal/adapter.ts` | `updateContext()` | `issue.context.updated` | issueId, updatedKeys |
| `src/domain/issue/_internal/adapter.ts` | `createStage()` | `stage.created` | stageId, key, issueId, roleInstances |
| `src/domain/issue/_internal/adapter.ts` | `advanceStage()` | `stage.advanced` | fromStageId, toStageId, targetKey |
| `src/domain/issue/_internal/adapter.ts` | `switchSnail()` | `stage.snail.switch` | stageId, roleInstance, newSnailId |

**日志级别**：全部使用 `info` 级别。这些是正常的业务事件，不是错误或警告。

#### 2. HTTP 请求日志

**原则**：在主 Hono app 添加请求日志中间件，记录每个请求的开始和完成。

**实施方式**：使用 Hono 的 `middleware` API，在请求开始时记录 method/path，请求完成时记录 status/duration。

**日志格式**：
```typescript
// 请求开始
log.info({ method, path }, "http.request.started");

// 请求完成
log.info({ method, path, status, duration }, "http.request.completed");

// 请求异常
log.error({ method, path, status, err }, "http.request.error");
```

**注意事项**：
- 不记录健康检查路径（如 `/health`）
- duration 使用毫秒为单位
- 不记录请求体/响应体（避免日志过大）

#### 3. 错误处理规范化

**原则**：所有 catch 块必须记录日志或显式声明忽略原因。

**实施范围**：

| 文件 | 行号 | 当前行为 | 修改后行为 |
|------|------|----------|-----------|
| `src/app/issue-collaboration/stage-queue.ts` | 11 | `.catch(() => undefined)` | `.catch((err) => { log.warn({ err, stageId }, "stage.queue.error"); return undefined; })` |
| `src/infra/mcp-server/handler.ts` | 51 | catch 块返回 JSON-RPC 错误但不记录日志 | 添加 `log.warn({ err, method }, "mcp.handler.error")` |
| `src/infra/http/routes/issue.route.ts` | 137-138 | `sendMessage` 的 `Issue is closed` 异常不记录日志 | 添加 `log.warn({ issueId, error: error.message }, "issue.send.blocked")` |
| `src/infra/acs/_internal/utils/managed-process.ts` | - | 进程停止各阶段无日志 | 添加 SIGINT/SIGTERM/SIGKILL 各阶段日志 |
| `src/domain/im/_internal/adapter.ts` | 118 | `.catch((err) => log.error({ err }))` 缺少上下文 | 补充 messageId、stageId 等上下文 |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/browser.ts` | - | 多处 `.catch(() => false)` | 添加 `log.warn({ err }, "browser.operation.failed")` |

**日志级别规范**：
- 可恢复的预期异常（如 `Issue is closed`）：`warn`
- 不可恢复的系统错误：`error`
- 静默吞没的 catch：`warn`（表示"我们选择忽略这个错误，但记录下来"）

### P2 详设

#### 1. Agent 适配器日志统一

**原则**：所有 Agent 实现使用统一的日志模式，与现有 OpenCodeAgent 对齐。

**实施范围**：

| 文件 | 需要添加的日志 |
|------|---------------|
| `src/infra/acs/_internal/agents/claude-code.ts` | 调用开始、调用完成、调用失败 |
| `src/infra/acs/_internal/agents/claude-code-stateful.ts` | 调用开始、调用完成、调用失败 |
| `src/infra/acs/_internal/agents/codex.ts` | 调用开始、调用完成、调用失败 |

**日志格式**（与 OpenCodeAgent 对齐）：
```typescript
// 调用开始
log.info({ agentType, snailKey, messageId }, "agent.invocation.started");

// 调用完成
log.info({ agentType, snailKey, messageId, duration }, "agent.invocation.completed");

// 调用失败
log.error({ agentType, snailKey, messageId, err }, "agent.invocation.failed");
```

## 生效路径

本 feature 的规则通过以下长期入口生效：

1. **代码**：领域适配器层的日志代码是长期存在的，后续开发者在添加新功能时应遵循相同的日志模式。
2. **日志格式规范**：事件名使用 `{domain}.{entity}.{action}` 格式，上下文字段使用 camelCase，这是 pino 社区的最佳实践。
3. **日志文件健康检查**：服务启动时验证日志文件是否可写，如果失败则降级到 stdout 并记录 warn 日志，防止日志断档。

## 设计约束摘要

- **边界**：日志添加在领域适配器层，不侵入 repository 层或 HTTP 路由层的业务逻辑
- **关键决策**：
  - 使用 `info` 级别记录业务事件（不是 `debug`），因为这些事件对运维有长期价值
  - 不添加数据库查询日志，因为 SQLite 操作通常很快且日志量会很大
  - 不引入分布式追踪，因为当前是单体应用
  - HTTP 请求日志提升到 P1，因为它是调试 API 调用链路的基础
  - 不引入 `requestId`，通过时间戳和上下文字段关联日志
- **非目标约束**：不添加 WebSocket 消息级日志、不修改日志级别配置、不包含日志监控/告警/dashboard
- **语义不变量**：所有 catch 块必须记录日志或显式声明忽略原因

<!-- [design-time] 章节结束 -->

## 改动范围

**P1 改动**：
- `src/domain/issue/_internal/adapter.ts` - 添加 Issue/Stage 生命周期日志
- `src/infra/http/hono-app.ts` 或主 app 创建处 - 添加请求日志中间件
- `src/app/issue-collaboration/stage-queue.ts` - 修复静默吞没
- `src/infra/mcp-server/handler.ts` - 添加错误日志
- `src/infra/http/routes/issue.route.ts` - 添加业务异常日志
- `src/infra/acs/_internal/utils/managed-process.ts` - 添加进程生命周期日志
- `src/domain/im/_internal/adapter.ts` - 补充错误上下文
- `src/domain/snail-mcp-server/_internal/servers/rednote-research/browser.ts` - 修复静默吞没

**P2 改动**：
- `src/infra/acs/_internal/agents/claude-code.ts` - 添加调用日志
- `src/infra/acs/_internal/agents/claude-code-stateful.ts` - 添加调用日志
- `src/infra/acs/_internal/agents/codex.ts` - 添加调用日志

## 验证

### P1

- [ ] 创建 issue 后，日志中有 `issue.created` 事件
- [ ] 关闭 issue 后，日志中有 `issue.closed` 事件
- [ ] stage 推进后，日志中有 `stage.advanced` 事件
- [ ] 每个 HTTP 请求在日志中有开始/完成记录
- [ ] HTTP 4xx/5xx 响应在日志中有记录
- [ ] 所有 `.catch(() => undefined)` 已修复为记录 warn 日志

### P2

- [ ] 所有 Agent 调用在日志中有开始/完成/失败记录
- [ ] 日志格式与 OpenCodeAgent 一致

### 通用

- [ ] 日志文件中无静默吞没的 catch 块（通过 `grep -r "catch.*undefined" src/` 验证）
- [ ] 日志文件中无缺少上下文的 error 日志（通过人工审查验证）

## 关联

无前置或相关 feature。

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 业务事件日志级别 | 使用 info 级别，因为这些事件对运维有长期价值，且生产环境通常只输出 info 及以上级别 | 使用 debug 级别，避免日志量过大 | 使用 info 级别 | 生产环境默认 info 级别，如果业务事件用 debug 则生产环境看不到 | 架构师-1 | 2026-06-25 |
| D2 | 是否添加数据库查询日志 | 添加查询日志可以诊断性能问题 | SQLite 操作通常很快，日志量会很大且噪音多 | 不添加 | 当前无性能问题，收益不明确，后续有需要时再添加 | 架构师-1 | 2026-06-25 |
| D3 | 是否引入分布式追踪 | 可以完整追踪请求链路 | 当前是单体应用，引入 OpenTelemetry 是过度设计 | 不引入 | 单体应用通过时间戳和上下文字段已足够关联日志 | 架构师-1 | 2026-06-25 |
| D4 | HTTP 请求日志的实现方式 | 使用 Hono 内置 middleware | 使用 pino-http 中间件 | 使用 Hono middleware | 更轻量，不引入额外依赖，且可以精确控制日志格式 | 架构师-1 | 2026-06-25 |
| D5 | HTTP 请求日志优先级 | HTTP 请求日志是调试 API 调用链路的基础，应放在 P1 | 可以先添加业务事件日志，HTTP 请求日志放 P2 | 提升到 P1 | 没有请求日志，很难追踪"哪个请求触发了哪个业务事件" | 架构师-1, 架构师-2 | 2026-06-25 |
| D6 | request_id 处理方式 | 在 P1 中引入 request_id，实现完整请求关联 | 不引入，通过时间戳和上下文字段关联日志 | 不引入 | 当前是单体应用，通过时间戳和上下文字段已足够关联日志，后续根据实际需要再决定 | 架构师-1, 架构师-2 | 2026-06-25 |
| D7 | 日志健康检查失败时的处理方式 | 拒绝启动，确保日志完整性 | 降级到 stdout，服务可用性优先 | 降级到 stdout | 日志问题不应影响服务可用性，降级到 stdout 仍然可见（通过 docker logs 或终端） | 架构师-1, 架构师-2 | 2026-06-25 |
| D8 | 事件命名规范 | 统一为 {domain}.{entity}.{action} 格式 | 统一为 {domain}.{action} 格式，HTTP 和 Agent 事件保留 entity | 统一为 {domain}.{action} 格式 | issue.created 和 stage.created 是最自然的表达，强行添加 entity 会导致冗余 | 架构师-1, 架构师-2 | 2026-06-25 |
