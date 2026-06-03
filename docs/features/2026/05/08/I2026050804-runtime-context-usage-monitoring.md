---
id: I2026050804
title: Runtime 上下文用量监控
from_ids: []
tags: [diagnostics, integration]
modules: [project_management]
---
# I2026050804 Runtime 上下文用量监控

## 背景

“ui 重设计”Feature 中，OpenCode stateful session 在 `继续完成pr` 后连续返回 `step_start` 与 `step_finish(reason=stop)`，但没有任何正文、工具调用、工具结果或错误事件，Snail Shell 因此报出 `OpenCode returned no output events`。

命令行复测同一 session 时，OpenCode 对极短提示也只返回 signal，并在 `step_finish.part.tokens` 中显示 `input=224106`、`output=0`。全新 session 对同一提示正常返回正文，说明问题不是消息投递丢失，也不能简单描述为 session 文件损坏，而是 stateful runtime 累积上下文已经进入不可继续的零输出状态。

当前 Snail Shell 的 message event 已有统一入库流程，但旧解析层只把 OpenCode `step_finish` 作为生命周期 signal 处理，没有把其中携带的 token 字段提取成独立、标准化的 Snail Shell message event。因此原始 CLI 事件虽然短暂经过解析流程，用量信息并不会以可查询、可展示的结构化事件留在数据库中，系统最终只能展示“无输出事件”，无法直接追溯上下文膨胀与零输出之间的关系。

## 目标

1. 记录底层 runtime 已返回的上下文或 token 用量信息，作为 message event 的可追溯诊断数据。
2. 覆盖 OpenCode `step_finish.part.tokens`、Codex `turn.completed.usage` 和 Claude Code `result.usage/modelUsage`。
3. 保证 usage 监控事件不改变消息成功边界；只有 usage signal 的空输出流仍应失败。
4. 为后续 UI 告警、session 重建或上下文压缩策略提供统一数据入口。

## 非目标

1. 本次不自动清理或重建 runtime session。
2. 本次不新增 UI 告警样式或自动处理动作。
3. 本次不改变 OpenCode、Codex、Claude 的 CLI 调用协议。
4. 本次不人为推断 runtime 没有返回的上下文窗口阈值。

## 设计

新增统一的 `runtime_usage` signal 事件，用 `payload.detail` 存放标准化用量字段：`input_tokens`、`output_tokens`、`total_tokens`、`cached_input_tokens`、`cache_write_tokens`、`reasoning_tokens`、`context_window`、`context_window_source`、`context_usage_ratio`、`output_token_ratio` 与 `raw`。它和 `step_start`、`step_finish` 一样进入同一条 assistant message 的 `message_event` 流，只是事件分类为 signal，不额外建立独立存储模型。

前端消息列表从最新 `runtime_usage` signal 汇总一条轻量用量徽标，展示在消息头时间左侧。徽标只展示当前上下文用量与已用百分比，不展开 token 明细；完整诊断数据仍保留在 message event 过程记录中。

不同 runtime 的信息完整度不同：

1. OpenCode 已确认在 `step_finish.part.tokens` 返回 `input`、`output`、`total`、`reasoning` 和 cache 读写数；当前未返回模型上下文窗口阈值时，按内置常见模型阈值表补齐。
2. Codex 已确认在 `turn.completed.usage` 返回 `input_tokens`、`cached_input_tokens` 和 `output_tokens`，当前未确认会返回上下文窗口阈值。
3. Claude Code 已确认在 terminal `result.usage` 与 `result.modelUsage` 返回 token 用量，并可通过 `modelUsage.*.contextWindow` 拿到上下文窗口阈值。

`runtime_usage` 必须保持为 message event 中的 signal 事件，不能计入 output event。原因是本次事故恰恰需要保留“runtime 有诊断数据但没有任何实质输出”的失败边界；如果 usage signal 被视为输出，会把零输出异常误判为成功。

## 生效路径

1. `src/agent/runtime-usage.ts` 提供 runtime usage 标准化与 `runtime_usage` signal 构造。
2. `src/agent/stateful-cli-agent.ts` 从 OpenCode/Gemini 兼容的 `step_finish` tokens 中提取 usage；已确认 OpenCode 使用该路径。
3. `src/agent/codex.ts` 从 `turn.completed.usage` 提取 usage。
4. `src/agent/claude-code.ts` 从 terminal `result` 提取 usage 与 context window。
5. `config/model-context-windows.json` 提供常见模型的内置上下文窗口，runtime 自身返回阈值时优先使用 runtime 值，否则使用该配置表。
6. `src/agent/model-context-windows.ts` 读取并解析 `config/model-context-windows.json`，支持按完整 `provider/model` 或去 provider 后的模型名匹配。
7. `src/persistence/types.ts` 将 `runtime_usage` 纳入 `MessageSignalType`。
8. `src/web/message-view.js` 与 `src/web/message-renderer.js` 将最新 runtime usage 汇总为消息头用量展示。
9. `tests/agent/*` 覆盖 usage 事件落库和“不满足输出边界”的不变量。
10. `tests/web/message-view-test.ts` 覆盖消息头用量展示模型。

## 改动范围

1. 新增 `src/agent/runtime-usage.ts`。
2. 新增 `src/agent/model-context-windows.ts`。
3. 新增 `config/model-context-windows.json`。
4. 更新 `src/agent/stateful-cli-agent.ts`、`src/agent/opencode.ts`、`src/agent/codex.ts`、`src/agent/claude-code.ts`。
5. 更新 `src/persistence/types.ts`。
6. 更新 `src/web/message-view.js`、`src/web/message-renderer.js`、`src/web/styles.css`。
7. 更新 `tests/agent/opencode-parser-test.ts`、`tests/agent/gemini-parser-test.ts`、`tests/agent/codex-parser-test.ts`、`tests/agent/claude-code-test.ts`、`tests/web/message-view-test.ts`。
8. 新增本 feature 文档。

## 验证

1. 已运行 `npx tsx tests/agent/opencode-parser-test.ts`，通过。
2. 已运行 `npx tsx tests/agent/gemini-parser-test.ts`，通过。
3. 已运行 `npx tsx tests/agent/codex-parser-test.ts`，通过。
4. 已运行 `npx tsx tests/agent/claude-code-test.ts`，通过。
5. 已运行 `npm run lint`，通过。
6. 已运行 `npm run build`，通过。
7. 已运行 `npm run test`，33 个 compiled test files 全部通过。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本次只做监控，不做自动 session 清理。因为用户当前问题是确认“系统是否拿得到上下文长度与阈值”，自动恢复策略需要进一步定义阈值、用户可见告警和重建时机，不应混入监控落库的第一步。

决策记录：阈值字段优先记录 runtime 明确返回的数据；若 runtime 未返回，则使用系统内置常见模型阈值表补齐。`context_window_source` 用于区分 `runtime`、`builtin` 和 `unknown`，避免后续排障时混淆阈值来源。

## 范围变更记录

1. 用户确认采用简单内置阈值表，不引入 OpenCode models 查询或联网模型元数据解析；范围增加 `model-context-windows` 与 fallback 来源标记。
2. 用户要求默认阈值不要写死在代码中，改为提交 `config/model-context-windows.json`，代码只负责读取该配置。
3. 基于最新 `main` 更新后，同日已有 `I2026050801`、`I2026050802`、`I2026050803` 文档，本 feature 文档按 `docs/README.md` 编号规则调整为 `I2026050804`。
4. 用户补充期望前端可见用量信息；范围增加消息头轻量展示，只展示当前用量和已使用百分比，不引入告警或自动处理策略。
