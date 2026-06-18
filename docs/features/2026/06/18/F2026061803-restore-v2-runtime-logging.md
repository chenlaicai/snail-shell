---
id: F2026061803
title: restore-v2-runtime-logging
from_ids: []
tags:
  - infra
  - logger
  - observability
  - bugfix
modules:
  - infra
  - issue-collaboration
  - acs-agents
doc_kind: spec
---

# F2026061803 [infra] 恢复 v2 运行时日志能力

## 背景

v2 重构后运行时日志完全丢失。`server.log` 只有 16 行启动日志，运行时关键路径（`collaboration.ts`、`snail/adapter.ts`、agent 运行时）几乎没有 `console.log` 输出。

导致两个严重问题：
1. **无法排查运行时错误**：架构师-2 报错 `[error:Unknown error]`，没有任何上下文日志
2. **错误信息丢失**：opencode 返回的真实错误（如 `APIError.data.message: 预扣费额度失败`）被丢弃，前端显示 "Unknown error"

### 根因分析

**日志丢失**：v1 有 132 处 `logger.info/warn/error/debug` 调用和完整的 Logger 模块（按日期轮转、结构化 JSON、级别控制）。v2 重构时 Logger 被丢弃，运行时代码改用 `console.log` 但几乎没写。

**错误信息丢失**：`opencode.ts` 的 `emitOpenCodeError` 只检查 `event.error.message`，但 opencode 返回的 API 错误结构是 `event.error.data.message`，导致真实错误原因被忽略。

## 目标

1. 引入成熟的日志框架，解决同步 I/O 阻塞和轮转竞态问题
2. 在关键运行时路径添加日志，覆盖完整调用链路
3. 修复 opencode 错误信息提取，展示真实错误原因
4. 统一全量迁移 console 调用到结构化 logger

## 非目标

1. 不添加动态日志级别调整 API
2. 不迁移前端代码（`src/web/`）的日志（pino 是 Node.js 库，不适用于浏览器）

## 框架选型

### 自研 vs pino vs winston

| 维度 | 自研 Logger | pino | winston |
|------|------------|------|---------|
| 性能 | 同步 I/O，阻塞事件循环 | 异步流式，零阻塞，最快 | 异步，性能中等 |
| 依赖 | 0 | 1（sonic-boom） | 12+ |
| 日志轮转 | 自己实现，有竞态风险 | pino-roll，进程安全 | winston-daily-rotate-file |
| 日志清理 | 需自己实现 | maxFiles 自动清理 | maxDays 自动清理 |
| child logger | 不支持 | 支持，自动注入上下文 | 支持 |
| Error 序列化 | 手动提取 name/message/stack | 原生完整序列化 | 支持多格式 |
| 可扩展性 | 低 | 高（transport 机制） | 高（format + transport） |

### 决策：选择 pino

理由：
1. **性能最优**：异步流式架构，零阻塞，解决自研同步 I/O 问题
2. **依赖极轻**：只有 1 个依赖（sonic-boom），比 winston 轻量
3. **轮转安全**：pino-roll 解决自研轮转的竞态条件
4. **child logger**：支持模块上下文注入，代码更简洁
5. **行业标准**：Fastify、OpenTelemetry 默认推荐

## 设计

### Logger 模块

位置：`src/infra/logger.ts`（基础设施层）

配置：`config/logging.yaml`，使用 `ConfigStore.readYaml` 加载，与 v2 配置架构一致。

```yaml
level: info          # debug | info | warn | error | silent
directory: logs
max_file_size_mb: 10
max_days: 30         # 日志保留天数，自动清理
```

能力：
- 异步流式写入（pino + sonic-boom）
- 按天轮转 + 按大小轮转（pino-roll）
- 自动清理过期日志（max_days）
- child logger 注入模块上下文
- 原生 Error 序列化

### child logger 设计

每个模块使用 `getLogger({ module: "模块名" })` 获取带上下文的 logger：

```typescript
const log = getLogger({ module: "collaboration" });
log.info({ stageId, roleInstance }, "invokeAgent start");
// 输出: {"level":30,"module":"collaboration","stageId":"xxx","roleInstance":"架构师-2","msg":"invokeAgent start"}
```

### 运行时日志覆盖

| 模块 | 日志点 | 级别 |
|------|--------|------|
| `collaboration.ts` | sendMessage 路由结果 | info |
| `collaboration.ts` | drainStage 每轮 targetSpeakers | debug |
| `collaboration.ts` | invokeAgent 入口/完成/失败 | info/error |
| `opencode.ts` | invokeFirstCall 入口 | info |
| `opencode.ts` | processOutput 失败（含 rawOutput） | error |
| `snail/adapter.ts` | invokeFirstCall/invokeResume 入口/完成 | info |
| `main.ts` | 启动摘要、HTTP 监听、shutdown | info |

### 错误信息修复

`emitOpenCodeError` 的 `extractOpenCodeErrorMessage` 增加 `event.error.data.message` 提取：

```typescript
function extractOpenCodeErrorMessage(event: OpenCodeEvent): string {
  if (typeof event.error === "string") return event.error;
  if (!event.error) return "Unknown error";
  const error = event.error;
  if (typeof error.data?.message === "string") return error.data.message;
  if (typeof error.message === "string") return error.message;
  return "Unknown error";
}
```

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/infra/logger.ts` | 重写 | 从自研切换到 pino + pino-roll |
| `config/logging.yaml.example` | 新增 | 日志配置模板（含 max_days） |
| `package.json` | 修改 | 新增 pino、pino-roll、@types/pino 依赖 |
| `src/main.ts` | 修改 | console → pino 结构化日志 |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | 添加运行时日志 + child logger |
| `src/infra/acs/_internal/agents/opencode.ts` | 修改 | 添加日志 + 修复错误提取 |
| `src/domain/snail/_internal/adapter.ts` | 修改 | 添加运行时日志 |
| `src/infra/acs/_internal/initor.ts` | 修改 | console → pino |
| `src/infra/acs/_internal/agents/claude-code.ts` | 修改 | console → pino |
| `src/infra/acs/_internal/agents/claude-code-stateful.ts` | 修改 | console → pino |
| `src/infra/acs/_internal/agents/codex.ts` | 修改 | console → pino |
| `src/infra/acs/_internal/utils/mcp-config.ts` | 修改 | console → pino |
| `src/infra/acs/_internal/utils/skill-symlinks.ts` | 修改 | console → pino |
| `src/infra/database.ts` | 修改 | console → pino |
| `src/infra/http/stage-websocket.ts` | 修改 | console → pino |
| `src/domain/knowledge/_internal/initor.ts` | 修改 | console → pino |
| `src/domain/knowledge/_internal/search-index.ts` | 修改 | console → pino |
| `src/domain/knowledge/_internal/repository.ts` | 修改 | console → pino |
| `src/domain/skill/_internal/repository.ts` | 修改 | console → pino |
| `src/domain/sop/_internal/repository.ts` | 修改 | console → pino |
| `src/domain/tenet-prompt/_internal/repository.ts` | 修改 | console → pino |
| `src/domain/feature-chain/_internal/repository.ts` | 修改 | console → pino |
| `src/domain/im/_internal/adapter.ts` | 修改 | console → pino |
| `src/domain/im/_internal/wecom-transport.ts` | 修改 | console → pino |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/engine/search.ts` | 修改 | console → pino |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/engine/detail.ts` | 修改 | console → pino |
| `src/app/issue-collaboration/stage-queue.ts` | 修改 | console → pino |

## 验证

1. `npm run lint` 通过
2. `npx tsc --noEmit` 通过
3. `npm run build` 通过
4. 实际运行：架构师-2 报错时日志显示完整错误链路和 rawOutput
5. 实际运行：前端显示真实错误原因（如"预扣费额度失败"）
6. 服务端无残留 console 调用（`src/web/` 除外）

## 使用方式

```bash
cp config/logging.yaml.example config/logging.yaml
# 按需修改 level 和 max_days
```

日志自动写入 `logs/snail-shell.log`，按天轮转，自动清理超过 max_days 的旧日志。

## 关联

- **参考**: F2026050605 — 协作投递 cutoff 与失败原因展示（历史类似问题）
- **前置**: F2026061705 — claude-code-stateful 注入 system-reminder（同批次排查）
