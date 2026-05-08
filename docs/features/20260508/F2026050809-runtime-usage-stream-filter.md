# F2026050809 Runtime 用量流式展示过滤

## 背景

`F2026050804 Runtime 上下文用量监控` 已将底层 runtime 返回的 token 用量标准化为 `runtime_usage` signal，并在消息头展示最新上下文用量。实际使用中，`runtime_usage` 事件数量会随流式过程大量累积；由于消息头已经展示最新用量，继续在“流式过程”事件列表中展示这些 signal 会造成重复信息和噪音。

用户还观察到某个 Feature 的上下文使用量曾从约 50% 突然降到 0.5%，需要核对当前百分比计算是否错误地使用了 `input_tokens`，以及底层返回字段中 `total_tokens` 是否才表示当前用量。

## 目标

1. 消息头继续展示最新 runtime 用量。
2. “流式过程”事件列表不再展示 `runtime_usage` signal。
3. 核对并修正上下文用量百分比计算字段，确保 UI 展示语义与底层 token 字段一致。
4. 保留 `runtime_usage` 事件入库和诊断能力，不改变零输出失败边界。

## 非目标

1. 不删除或停止记录 `runtime_usage` message event。
2. 不调整底层 runtime CLI 协议和 token 原始字段。
3. 不新增上下文告警、自动压缩或 session 重建策略。
4. 不修改已合入 feature 文档的历史结论。

## 设计

前端消息视图仍从完整事件流中提取最新 `runtime_usage` 作为消息头用量来源，但在构建可展开的事件块时过滤该 signal，避免同一用量既出现在消息头，又重复出现在流式过程列表。

上下文用量语义按“当前已占用上下文窗口的 token 数”处理：若 runtime 返回 `total_tokens`，使用 `total_tokens` 计算 `context_usage_ratio` 和消息头分子；若缺失 `total_tokens`，只有在同时能得到 `input_tokens` 与 `output_tokens` 并可合成为总量时，才使用 `input_tokens + output_tokens`。单独 `input_tokens` 不代表当前上下文窗口总占用，不能作为上下文用量百分比的兜底分子；如果 runtime 只返回 `input_tokens`，则保留明细诊断数据，但不展示上下文用量百分比。

## 生效路径

1. `src/agent/runtime-usage.ts` 统一计算 `context_usage_ratio` 的上下文 token 分子。
2. `src/web/message-view.js` 继续从完整事件流提取 header 用量，但从可展示流式过程中过滤 `runtime_usage` signal。
3. `tests/agent/opencode-parser-test.ts`、`tests/agent/codex-parser-test.ts`、`tests/agent/claude-code-test.ts` 覆盖 `total_tokens` 优先语义与 input-only 边界。
4. `tests/web/message-view-test.ts` 覆盖 header 保留而流式过程过滤的 UI 模型。

## 改动范围

预计修改：

1. `src/agent/runtime-usage.ts`
2. `src/web/message-view.js`
3. `tests/agent/opencode-parser-test.ts`
4. `tests/agent/codex-parser-test.ts`
5. `tests/agent/claude-code-test.ts`
6. `tests/web/message-view-test.ts`
7. `docs/features/20260508/F2026050809-runtime-usage-stream-filter.md`

## 验证

1. 已运行 `npx tsx tests/agent/opencode-parser-test.ts`，通过，覆盖 OpenCode `total_tokens` 优先计算上下文用量百分比，同时保留 `input_tokens` 原始字段。
2. 已运行 `npx tsx tests/web/message-view-test.ts`，通过，覆盖消息头继续展示 runtime 用量，但流式过程列表不再重复展示 `runtime_usage` signal。
3. 首次运行 `npm run check` 失败于新 worktree 未安装依赖导致 `tsx: command not found`；已在 worktree 内执行 `npm install` 补齐依赖。
4. 已重新运行 `npm run check`，通过；构建、lint 和 33 个编译后测试文件全部通过。
5. 用户指出单独 `input_tokens` 兜底会混淆 `context_usage_ratio` 语义后，已移除该兜底，并重新运行 `npx tsx tests/agent/opencode-parser-test.ts`、`npx tsx tests/web/message-view-test.ts` 和 `npm run check`。
6. 检视指出 Codex/Claude 路径仍可能用单侧 token 合成 `total_tokens`，已统一收紧为 runtime `total_tokens` 优先、缺失时仅在 ratio 层使用 input/output 成对合成，并补充 Codex/Claude input-only 测试。

## 风险与决策记录

决策记录：本轮不把 `runtime_usage` 从后端事件流中移除，只在前端“流式过程”展示层过滤。这样既满足减少流式 UI 噪音的需求，也保留数据库诊断、消息头聚合和零输出失败判断依赖的 signal 事件。

决策记录：`context_usage_ratio` 不采用“哪个字段有值就用哪个”的兜底模型。上下文用量只允许使用 `total_tokens`，或在缺失 `total_tokens` 时使用可解释的 `input_tokens + output_tokens` 合成总量；单独 `input_tokens` 只作为原始明细保存，不参与上下文百分比展示。

## 范围变更记录

1. 用户指出“最后退回 `input_tokens`”会让 ratio 语义退化为字段兜底，而不是上下文总占用；范围收紧为移除单独 `input_tokens` 兜底，并同步更新代码注释、feature 文档和验证。
2. 检视指出 Codex/Claude 仍在 runtime 解析层用单侧 token 合成 `total_tokens`；范围扩展为统一三类 runtime 的派生总量边界，并补充对应测试。
