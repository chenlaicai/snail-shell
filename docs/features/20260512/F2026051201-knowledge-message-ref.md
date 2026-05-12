# F2026051201 清理知识治理消息 ID 边界

## 背景

知识治理 conversation 与项目管理 conversation 是并行的两条业务线。当前实现中，知识治理消息、事件和 dispatch 物理写入 `knowledge_governance_*` 专用表，但为了复用 `ConversationStore`、`ProjectManager.sendMessage`、`sendStructuredMessage`、`message-bus`、history 和 realtime 等共享基础设施，对外把治理表内自增 ID 编码为负数 namespace。

负数 external ID 把消息归属边界编码进裸 `number`，使 ID 大小不再表达单条 conversation 内的自然顺序，并让 cutoff、排序、long conversation 默认路由、inbox 读取、history window、by-ids、realtime cursor 等 API 必须理解隐式符号约定。这是系统边界错误，不应继续通过局部补丁维护。

## 目标

1. 取消知识治理 message、event、dispatch 对外负数 ID 模型。
2. 将消息归属边界显式落在 `conversationId` / `conversation.owner_type` 上，由 conversation 上下文选择项目表或知识治理表。
3. 保持项目管理线和知识治理线业务并行、物理存储隔离、共享协作基础设施可复用。
4. 让共享 API 复用基于显式 conversation owner，而不是基于 ID 符号。
5. 覆盖普通项目 conversation 与知识治理 conversation 的 sendMessage、dispatch、inbox、cutoff、history、long conversation、realtime cursor、message window、by-ids、quoted message、consumed dispatch 和 context cutoff。

## 非目标

1. 不把知识治理 conversation 合并进项目管理 `conversation` / `message` 表。
2. 不重构知识治理生命周期、候选裁决状态或提示词治理流程。
3. 不修改 runtime adapter 的消息事件语义。
4. 不把 HTTP / WebSocket 字段从 `number` 全量替换为对象协议；本 feature 改变的是 number 的边界语义：由全局裸 ID 变为 conversation-local ID。

## 设计

### 影响链路分析

当前共享基础设施复用情况如下：

1. `ConversationStore` 是统一 facade。它已经通过 `conversationId` 判断是否为知识治理 conversation，但 message/event/dispatch 单项操作仍通过负数 ID 判断表归属。
2. `ProjectManager.sendMessage` 与 `sendStructuredMessage` 全程携带 `conversationId`，本质不需要跨 conversation 只靠 message ID 寻址。
3. `message-bus` 从 `listPendingDispatches(conversationId)` 获取 dispatch，再按 `conversationId` 拉取 inbox 消息和标记 consumed；不需要负数 dispatch ID，只需要当前 conversation 的 dispatch 局部 ID。
4. realtime cursor、recent snapshot、events after、events between 都通过 `conversationId + event id` 查询。cursor 只需要在同一 conversation 的事件流中单调递增，不需要全局跨表唯一。
5. history by-ids、message window、quoted message、context cutoff 都已由 `conversationId` 限定；它们需要 conversation-local message ID，而不是全局裸 ID。
6. dispatch consumed、inbox cutoff 和 context cutoff 只比较同一 conversation 内消息顺序；负数 ID 会让数值比较语义反直觉，并迫使治理实现做编码/解码。
7. 真正仍依赖裸 number 隐式 namespace 的位置是：`ConversationStore` 单消息 facade、`knowledge-governance-conversation-model.ts` 的 `from*/to*` 映射、`markDispatchesConsumed/Seen/skipDispatches` 的 dispatch id 路由，以及旧测试对负数 ID 的断言。

### 新模型

1. `Message.id`、`MessageEvent.id`、`MessageDispatch.id` 对外表示当前 conversation 内的局部正整数 ID。
2. 所有跨表路由由 `conversationId` 或 message 本身的 `conversation_id` 决定，不再从 ID 符号推断 owner。
3. `ConversationStore` 增加 conversation-aware API，用于需要单项 message/event/dispatch 操作的共享链路：
   - 写事件、完成消息、读取消息事件、更新 context、更新 routing、更新状态时带上 `conversationId`。
   - dispatch 状态更新带上 `conversationId`，只操作该 conversation 所属表。
4. 旧的项目 conversation 读取与写入继续使用正整数 ID；知识治理 conversation 也返回正整数局部 ID。
5. realtime `after_event_id` / snapshot `last_event_id` 保持 number 字段，但语义限定为对应 conversation 的事件 cursor。

### 不变量

1. 不允许通过 message/event/dispatch ID 的正负号表达 owner/type。
2. conversation 是消息归属边界；跨 conversation 读取必须显式携带 `conversationId`。
3. `context_cutoff_at` 只保存同一 conversation 内 message ID 的十进制字符串。
4. `quoted_message_id` 只引用同一 conversation 内消息。
5. 项目管理表和知识治理表可以分别自增，因此相同数字 ID 可在不同 owner 下同时存在。

## 生效路径

1. `src/persistence/knowledge-governance-conversation-model.ts` 取消负数 external ID 映射，对外返回治理表内正整数 ID。
2. `src/persistence/store.ts` 通过 `conversationId` / message lookup 显式分发表操作。
3. `src/project/collaboration.ts`、`src/project/message-protocol.ts`、`src/project/message-bus.ts` 使用 conversation-aware store API。
4. 测试覆盖项目 conversation 与知识治理 conversation 的共享消息链路。

## 改动范围

1. `src/persistence/knowledge-governance-conversation-model.ts`
2. `src/persistence/store.ts`
3. `src/persistence/dispatch-store.ts`
4. `src/persistence/artifact-store.ts`
5. `src/project/collaboration.ts`
6. `src/project/message-protocol.ts`
7. `src/project/message-bus.ts`
8. `src/project/manager.ts`
9. `src/project/startup-recovery.ts`
10. `tests/persistence/persistence-test.ts`
11. `tests/project/stage-cycle-test.ts`

## 验证

1. 已运行 `npm test -- --runInBand`，33 个编译后测试文件全部通过。
2. 已运行 `npm run check`，33 个编译后测试文件全部通过。
3. 已手动检查代码搜索结果，治理 message/event/dispatch 不再通过负数 namespace 或 `toKnowledge*` / `fromKnowledge*` 映射表达 owner。

## 风险与决策记录

1. 决策：不把 HTTP/WS 字段改为对象型 `MessageRef`，因为当前所有相关 HTTP/WS API 已有 `conversationId` 路径或订阅上下文，整体协议替换会扩大前端迁移面；本次通过 conversation-local number 建立正确边界。
2. 兼容成本：已有数据库中知识治理表内正整数 ID 保持不变；旧前端或脚本如果缓存了负数治理 ID，需要重新从 conversation history 拉取正整数 ID。当前系统没有确认存在需长期兼容的外部消费者，因此不保留负数兼容层。
3. 风险：项目表与治理表可能出现相同 message id。该情况是新模型允许的局部 ID 语义，所有共享协作写路径已改为显式携带 `conversationId`，旧的无 conversation 单项 fallback 只保留给项目表历史调用。

## 范围变更记录

1. 实现过程中新增 `dispatch-store.ts` 和 `artifact-store.ts`，原因是 `ConversationStore` 已接近 lint 行数上限；抽出纯 persistence helper 不改变对外 API，但避免继续扩大 store facade 文件职责。
2. 实现过程中同步改造 `startup-recovery.ts`，原因是启动恢复会对既有 streaming message 执行单项 message/event/context 操作；在局部 ID 模型下也必须显式使用 `message.conversation_id`。
