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

1. 恢复 Logger 模块，适配 v2 架构（yaml 配置、DDD 分层）
2. 在关键运行时路径添加日志，覆盖完整调用链路
3. 修复 opencode 错误信息提取，展示真实错误原因
4. 替换 `main.ts` 的 `console.log` 为结构化 logger

## 非目标

1. 不迁移 v1 所有 132 处日志（只覆盖 v2 关键路径）
2. 不改变日志输出格式（保持 JSON 结构化）
3. 不添加动态日志级别调整 API

## 设计

### Logger 模块

位置：`src/infra/logger.ts`（基础设施层）

配置：`config/logging.yaml`，使用 `ConfigStore.readYaml` 加载，与 v2 配置架构一致。

```yaml
level: info          # debug | info | warn | error
directory: logs
max_file_size_mb: 10
```

能力：
- 日志级别过滤（debug/info/warn/error）
- 按日期 + 大小轮转（`snail-shell-YYYY-MM-DD.N.log`）
- 结构化 JSON meta（自动提取 Error.stack）
- 单例 `getLogger()` 供全局使用

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
| `src/infra/logger.ts` | 新增 | Logger 模块 |
| `config/logging.yaml.example` | 新增 | 日志配置模板 |
| `src/main.ts` | 修改 | console → logger |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | 添加运行时日志 |
| `src/infra/acs/_internal/agents/opencode.ts` | 修改 | 添加日志 + 修复错误提取 |
| `src/domain/snail/_internal/adapter.ts` | 修改 | 添加运行时日志 |

## 验证

1. `npm run lint` 通过
2. `npx tsc --noEmit` 通过
3. `npm run build` 通过
4. 实际运行：架构师-2 报错时日志显示完整错误链路和 rawOutput
5. 实际运行：前端显示真实错误原因（如"预扣费额度失败"）

## 使用方式

```bash
cp config/logging.yaml.example config/logging.yaml
# 按需修改 level
```

日志自动写入 `logs/snail-shell-YYYY-MM-DD.N.log`。

## 关联

- **参考**: F2026050605 — 协作投递 cutoff 与失败原因展示（历史类似问题）
- **前置**: F2026061705 — claude-code-stateful 注入 system-reminder（同批次排查）
