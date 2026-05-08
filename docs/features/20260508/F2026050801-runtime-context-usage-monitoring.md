# F2026050801 Runtime 上下文用量监控

## 背景

“ui 重设计”Feature 中，OpenCode stateful session 在 `继续完成pr` 后连续返回 `step_start` 与 `step_finish(reason=stop)`，但没有任何正文、工具调用、工具结果或错误事件，Snail Shell 因此报出 `OpenCode returned no output events`。

命令行复测同一 session 时，OpenCode 对极短提示也只返回 signal，并在 `step_finish.part.tokens` 中显示 `input=224106`、`output=0`。全新 session 对同一提示正常返回正文，说明问题不是消息投递丢失，也不能简单描述为 session 文件损坏，而是 stateful runtime 累积上下文已经进入不可继续的零输出状态。

当前 Snail Shell 能从底层 CLI 事件拿到部分用量信息，但解析层没有把这些信息标准化落库，导致系统只能展示“无输出事件”，无法直接追溯上下文膨胀与零输出之间的关系。

## 目标

1. 记录底层 runtime 已返回的上下文或 token 用量信息，作为 message event 的可追溯诊断数据。
2. 覆盖 OpenCode `step_finish.part.tokens`、Codex `turn.completed.usage` 和 Claude Code `result.usage/modelUsage`。
3. 保证 usage 监控事件不改变消息成功边界；只有 usage signal 的空输出流仍应失败。
4. 为后续 UI 告警、session 重建或上下文压缩策略提供统一数据入口。

## 非目标

1. 本次不自动清理或重建 runtime session。
2. 本次不新增 UI 展示或告警样式。
3. 本次不改变 OpenCode、Codex、Claude 的 CLI 调用协议。
4. 本次不人为推断 runtime 没有返回的上下文窗口阈值。

## 设计

新增统一的 `runtime_usage` signal 事件，用 `payload.detail` 存放标准化用量字段：`input_tokens`、`output_tokens`、`total_tokens`、`cached_input_tokens`、`cache_write_tokens`、`reasoning_tokens`、`context_window`、`context_usage_ratio`、`output_token_ratio` 与 `raw`。它和 `step_start`、`step_finish` 一样进入同一条 assistant message 的 `message_event` 流，只是事件分类为 signal，不额外建立独立存储模型。

不同 runtime 的信息完整度不同：

1. OpenCode 已确认在 `step_finish.part.tokens` 返回 `input`、`output`、`total`、`reasoning` 和 cache 读写数，但当前未返回模型上下文窗口阈值。
2. Codex 已确认在 `turn.completed.usage` 返回 `input_tokens`、`cached_input_tokens` 和 `output_tokens`，当前未确认会返回上下文窗口阈值。
3. Claude Code 已确认在 terminal `result.usage` 与 `result.modelUsage` 返回 token 用量，并可通过 `modelUsage.*.contextWindow` 拿到上下文窗口阈值。

`runtime_usage` 必须保持为 message event 中的 signal 事件，不能计入 output event。原因是本次事故恰恰需要保留“runtime 有诊断数据但没有任何实质输出”的失败边界；如果 usage signal 被视为输出，会把零输出异常误判为成功。

## 生效路径

1. `src/agent/runtime-usage.ts` 提供 runtime usage 标准化与 `runtime_usage` signal 构造。
2. `src/agent/stateful-cli-agent.ts` 从 OpenCode/Gemini 兼容的 `step_finish` tokens 中提取 usage；已确认 OpenCode 使用该路径。
3. `src/agent/codex.ts` 从 `turn.completed.usage` 提取 usage。
4. `src/agent/claude-code.ts` 从 terminal `result` 提取 usage 与 context window。
5. `src/persistence/types.ts` 将 `runtime_usage` 纳入 `MessageSignalType`。
6. `tests/agent/*` 覆盖 usage 事件落库和“不满足输出边界”的不变量。

## 改动范围

1. 新增 `src/agent/runtime-usage.ts`。
2. 更新 `src/agent/stateful-cli-agent.ts`、`src/agent/codex.ts`、`src/agent/claude-code.ts`。
3. 更新 `src/persistence/types.ts`。
4. 更新 `tests/agent/opencode-parser-test.ts`、`tests/agent/gemini-parser-test.ts`、`tests/agent/codex-parser-test.ts`、`tests/agent/claude-code-test.ts`。
5. 新增本 feature 文档。

## 验证

1. 已运行 `npx tsx tests/agent/opencode-parser-test.ts`，通过。
2. 已运行 `npx tsx tests/agent/gemini-parser-test.ts`，通过。
3. 已运行 `npx tsx tests/agent/codex-parser-test.ts`，通过。
4. 已运行 `npx tsx tests/agent/claude-code-test.ts`，通过。
5. 已运行 `npm run lint`，通过。
6. 已运行 `npm run build`，通过。
7. 已运行 `npm run test`，32 个 compiled test files 全部通过。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本次只做监控，不做自动 session 清理。因为用户当前问题是确认“系统是否拿得到上下文长度与阈值”，自动恢复策略需要进一步定义阈值、用户可见告警和重建时机，不应混入监控落库的第一步。

决策记录：阈值字段只记录 runtime 明确返回的数据。OpenCode 与 Codex 当前样例没有上下文窗口阈值，因此 `context_window` 和 `context_usage_ratio` 可以为 `null`；Claude Code 返回时再记录。

## 范围变更记录

暂无范围变更。
