# F2026050806 Runtime 用量流式展示过滤

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

上下文用量语义按“当前已占用上下文窗口的 token 数”处理：若 runtime 返回 `total_tokens`，优先用 `total_tokens` 计算 `context_usage_ratio` 和消息头分子；若缺失 `total_tokens`，再退回 `input_tokens + output_tokens`，最后退回 `input_tokens`。原因是部分 runtime 的 `input_tokens` 只表示本轮请求输入，不一定等同于当前上下文窗口总占用；在存在 `total_tokens` 时使用它更符合“上下文用量”的展示含义。

## 生效路径

1. `src/agent/runtime-usage.ts` 统一计算 `context_usage_ratio` 的上下文 token 分子。
2. `src/web/message-view.js` 继续从完整事件流提取 header 用量，但从可展示流式过程中过滤 `runtime_usage` signal。
3. `tests/agent/opencode-parser-test.ts` 或相关 runtime usage 测试覆盖 `total_tokens` 优先语义。
4. `tests/web/message-view-test.ts` 覆盖 header 保留而流式过程过滤的 UI 模型。

## 改动范围

预计修改：

1. `src/agent/runtime-usage.ts`
2. `src/web/message-view.js`
3. `tests/agent/opencode-parser-test.ts`
4. `tests/web/message-view-test.ts`
5. `docs/features/20260508/F2026050806-runtime-usage-stream-filter.md`

## 验证

1. 已运行 `npx tsx tests/agent/opencode-parser-test.ts`，通过，覆盖 OpenCode `total_tokens` 优先计算上下文用量百分比，同时保留 `input_tokens` 原始字段。
2. 已运行 `npx tsx tests/web/message-view-test.ts`，通过，覆盖消息头继续展示 runtime 用量，但流式过程列表不再重复展示 `runtime_usage` signal。
3. 首次运行 `npm run check` 失败于新 worktree 未安装依赖导致 `tsx: command not found`；已在 worktree 内执行 `npm install` 补齐依赖。
4. 已重新运行 `npm run check`，通过；构建、lint 和 33 个编译后测试文件全部通过。

## 风险与决策记录

决策记录：本轮不把 `runtime_usage` 从后端事件流中移除，只在前端“流式过程”展示层过滤。这样既满足减少流式 UI 噪音的需求，也保留数据库诊断、消息头聚合和零输出失败判断依赖的 signal 事件。

## 范围变更记录

暂无。
