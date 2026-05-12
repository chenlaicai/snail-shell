# F2026051203 默认回复上一发言 Snail

## 背景

项目管理 conversation 中，用户发言在没有显式 mention 或问题卡片回答目标时，原逻辑直接投递给 `conversation.default_snail`。多 Snail 协作后，用户的自然追问通常指向刚刚回复的 Snail，继续使用 default Snail 会让对话偏离末尾语境。

知识治理 conversation 复用同一协作发送入口，但当前 main 已通过 `owner_type = knowledge_governance` 和 `knowledge_governance_*` 专用表隔离了消息模型，因此本 feature 需要让知识治理 conversation 共享同一“上一发言 Snail”路由语义，同时不引入旧式负数 id 兼容补丁。

## 目标

- 用户消息无显式 mention 时，优先投递给发言前最近一条可自动响应的 Snail 发言者。
- 没有可用上一发言 Snail 时，继续回退 `conversation.default_snail`。
- 保持显式 mention、`askerSnail`/问题卡片回答目标优先于上一发言 Snail。
- 保持 agent 发言无显式 mention 时不自动回退 default Snail。
- 查询上一发言 Snail 必须基于 conversation 末尾状态，不受 `getMessages()` 默认 100 条限制影响。
- 知识治理 conversation 若仍共用发送入口，应覆盖同一语义。

## 非目标

- 不调整 message-bus 轮次预算、强制收口、Boss Snail mention 通知等协作调度逻辑。
- 不改变显式 mention 的解析和去重规则。
- 不改变问题卡片/引用回答的 `askerSnail` 语义。
- 不引入旧式负数 message id 兼容逻辑。
- 不扩大 `getMessages()` 默认窗口来规避分页问题。

## 设计

- 在项目消息 read-model 中新增 `getLatestMessage` 与 `getLatestRespondingSnail`，表达“conversation 末尾消息”和“最近可响应 Snail”两个明确语义。
- 在知识治理 read-model 中提供同名能力，继续使用 `knowledge_governance_message` 本地正数 id 和专用表。
- `ConversationStore` 作为 facade 根据 conversation owner 自动选择项目消息表或知识治理消息表。
- `sendStructuredMessage` 用 `getLatestMessage` 计算 `contextCutoffAt`，避免通过 `getMessages()` 默认分页读取末尾消息。
- 用户消息路由顺序为显式 mention、`askerSnail`、最近可自动响应 Snail、`default_snail`。
- 最近可自动响应 Snail 候选来自当前 conversation 的 `participating_snails`，并通过 snail registry 排除 Boss Snail、human/null/system、缺少 runtime 的非 agent Snail。
- agent 回复后的路由继续只依赖显式 mention；无显式 mention 时不回退 default Snail，也不使用上一发言 Snail。

## 生效路径

- `src/project/collaboration.ts`：协作发送入口计算用户消息路由和 agent 回复后路由。
- `src/persistence/message-read-model.ts`：项目 conversation 的末尾消息和最近响应 Snail 读取能力。
- `src/persistence/knowledge-governance-conversation-model.ts`：知识治理 conversation 的同语义读取能力。
- `src/persistence/store.ts`：按 owner 类型分发 read-model 能力。
- `tests/project/collaboration-test.ts`：覆盖新路由顺序、分页边界、知识治理入口和既有 agent 无默认回退约束。

## 改动范围

- 修改 `src/project/collaboration.ts` 的用户消息路由优先级与 context cutoff 读取方式。
- 修改 `src/persistence/message-read-model.ts`，新增项目消息末尾读取能力。
- 修改 `src/persistence/knowledge-governance-conversation-model.ts`，新增知识治理消息末尾读取能力。
- 修改 `src/persistence/store.ts`，暴露 shared facade 能力。
- 修改 `tests/project/collaboration-test.ts`，新增和调整协作路由测试。
- 新增本 feature 文档。

## 验证

- 已运行 `npm run test -- tests/project/collaboration-test.ts`，通过。该命令当前构建后执行全部 34 个 compiled test files，全部通过。
- 已运行 `npm run check`，通过。完整检查执行 lint、TypeScript 构建和全部 34 个 compiled test files，全部通过。

## 风险与决策记录

- 已确认当前 main 的 knowledge governance conversation 使用 `owner_type = knowledge_governance` 和 `knowledge_governance_*` 专用表，与项目管理 conversation 消息表隔离清楚；本 feature 纳入知识治理同语义覆盖，不引入负数 id 兼容补丁。
- 显式 mention 和 `askerSnail` 保持更高优先级，避免用户明确目标被上一发言 Snail 覆盖。
- 对既有 cutoff 测试中需要固定 Owner Snail 参与的场景，测试改为显式 mention Owner，保留原测试要验证的 dispatch cutoff 语义，避免新默认路由改变测试前提。

## 范围变更记录

- 初始实现时发现 `contextCutoffAt` 也使用了 `getMessages().at(-1)`，同样受默认分页影响；本 feature 将其一并改为 `getLatestMessage`，属于“末尾状态不能受默认分页影响”的同一问题边界。
