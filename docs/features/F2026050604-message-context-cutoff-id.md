# F2026050604 消息上下文截断边界修正

## 背景

`src/persistence/types.ts` 曾经包含数据模型字段注释，但在 PR #57 引入统一消息事件模型时，`types.ts` 被整体重写，原有模型与字段注释随旧 `message_part` 模型一起被删除。后续 `Message.context_cutoff_at` 又被主线实现持续按时间写入，导致字段名虽然保留 `at`，实际需要表达的上下文截断边界却被误解为时间戳。

`Message.context_cutoff_at` 的实际语义应是“创建当前消息时，其可见上下文截止到的历史 message id”，用字符串存储是为了延续既有字段，不新增迁移字段。

## 目标

1. 明确 `Message.context_cutoff_at` 和 `CreateMessageInput.contextCutoffAt` 的消息 ID 截断边界语义。
2. 修正用户消息、系统通知和 agent 回复的写入路径，停止写入当前时间。
3. 修正消息总线 batch cutoff，让 agent 回复记录其消费的最后一条源消息 id。
4. 补回 `types.ts` 中主要数据模型与字段注释，降低后续再次误解字段语义的风险。
5. 通过测试覆盖新消息、系统消息、agent 回复和既有分页/上下文窗口路径。

## 非目标

1. 不重命名数据库字段；`context_cutoff_at` 作为已存在持久化字段继续保留。
2. 不引入 `context_cutoff_message_id` 新列，避免在同一语义上形成两个来源。
3. 不迁移历史库中已经按时间写入的旧值；历史值无法可靠反推为当时的消息 ID 边界。

## 设计

`context_cutoff_at` 继续以 `TEXT` 存储，但写入值统一为十进制 message id 字符串：

1. 新用户消息和系统通知创建前读取当前 conversation 最后一条消息 id；空会话写入 `"0"`。
2. 消息总线按 pending dispatch 的源消息 id 计算 batch cutoff，agent 回复写入 `String(contextCutoffMessageId)`。
3. `ConversationStore.addMessage` 的兜底默认值改为 `"0"`，数据库 schema 默认值同步改为 `'0'`，避免绕过应用层写入时重新产生时间戳。
4. 读取历史上下文仍使用 batch 中的 `contextCutoffMessageId` 数值过滤，避免依赖字符串字段解析。

`types.ts` 注释采用正式 `/** ... */` 注释，既说明表/视图定位，也说明容易误解的字段语义。

## 生效路径

1. `src/persistence/schema.ts` 定义新库默认值。
2. `src/persistence/store.ts` 统一应用层写入兜底。
3. `src/project/collaboration.ts` 写入用户消息与系统通知的 cutoff id。
4. `src/project/message-bus.ts` 写入 agent batch 的 cutoff id。
5. `src/persistence/types.ts` 作为长期类型模型注释入口。
6. `docs/core/core-message-model.md` 同步长期消息模型语义，避免核心文档继续把字段样例写成时间戳。
7. `tests/project/collaboration-test.ts` 与 `tests/project/stage-cycle-test.ts` 覆盖修正路径。

## 改动范围

1. `docs/features/F2026050604-message-context-cutoff-id.md`
2. `src/persistence/types.ts`
3. `src/persistence/schema.ts`
4. `src/persistence/store.ts`
5. `src/project/collaboration.ts`
6. `src/project/message-bus.ts`
7. `docs/core/core-message-model.md`
8. `tests/project/collaboration-test.ts`
9. `tests/project/stage-cycle-test.ts`

## 验证

1. 运行 `npm run build`，覆盖类型生成、lint、TypeScript 编译和 dist 构建。
2. 运行 `npm run test`，覆盖项目现有测试与本次新增/调整的协作消息测试。

## 风险与决策记录

历史数据中按时间戳写入的 `context_cutoff_at` 不在本次迁移。原因是字段原本没有强约束，旧时间戳无法可靠反推出当时对应的消息 ID；强行迁移会制造更不可信的数据。后续如需要修复历史会话，应基于具体库快照单独制定可验证迁移策略。

## 范围变更记录

1. 实现时发现 `docs/core/core-message-model.md` 的最小场景样例仍将 `context_cutoff_at` 写成 ISO 时间戳；已将该核心文档纳入改动范围，同步为 message id 样例并补充约束说明。
