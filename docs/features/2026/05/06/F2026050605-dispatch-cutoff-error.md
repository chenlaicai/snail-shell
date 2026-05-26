---
id: F2026050605
title: 协作投递 cutoff 与失败原因展示
from_ids: []
tags: [workflow, error-handling, messaging]
modules: [project_management]
---
# F2026050605 协作投递 cutoff 与失败原因展示

## 背景

“清理文件”Feature 的 review 对话中出现了 Acceptance Snail 响应失败和界面显示 `Unknown error` 的现象。数据库事件显示，真实失败原因是 `opencode exited with code 1: Error: You must provide a message or a command`，但界面实时状态没有展示该原因。

根因在于协作投递读取边界仍按目标 Snail 上一次回复的 message id 推导，而不是按该 Snail 上次发言时记录的 `context_cutoff_at` 语义读取未见消息。并行协作时，一个 Snail 可能在读取消息后、完成回复前，其他 Snail 又产生新消息；下一次该 Snail 发言必须能看到这些位于自身上次 cutoff 之后的新消息。

## 目标

1. 让 message bus 构造目标 Snail inbox 时使用该 Snail 上次 assistant message 的 `context_cutoff_at`，而不是上次回复 message id。
2. 保证 pending dispatch 的 source message 一定进入本轮输入，即使并发顺序或 cutoff 边界导致普通范围查询遗漏。
3. 防止 stateful runtime 收到空 prompt 时只暴露 CLI 的低层错误。
4. 让实时失败状态展示 `message_failed.payload.reason`，避免界面退化为 `Unknown error`。
5. 将历史中另一个可确认的 provider 层 `OpenAI request failed (502): Upstream authentication failed` 归类成明确的上游认证配置提示。

## 非目标

1. 不改变显式 mention 才触发 agent 投递的路由规则。
2. 不重构 runtime session 生命周期或改动 opencode CLI 调用协议。
3. 不修复历史已产生的 failed message，只修复后续同类消息的读取和展示。
4. 不新增或调整 `docs/core/core-message-model.md` 定义的核心消息字段。

## 设计

message bus 的 inbox 语义从“目标 Snail 上次回复之后的消息”调整为“目标 Snail 上次读取 cutoff 之后的新消息，并强制包含本批 dispatch source”。`context_cutoff_at` 继承早期命名，但当前系统语义是 Snail 开始发言时已经读到的 Snail Shell `message.id`，不是时间边界；目标 Snail 自己上一条回复的 `id` 是读取之后才产生的输出，不能替代 cutoff。

读取逻辑需要同时覆盖两类消息：

1. `id` 大于目标 Snail 上次 assistant message `context_cutoff_at` 记录的 cutoff message id 的消息。
2. 当前 pending dispatch 指向的 source messages。

第二类是强制兜底，因为 dispatch source 是本轮任务的直接输入，不能因并发顺序或历史异常 cutoff 记录被排除。

实时失败展示不改事件存储模型。后端终态事件已经把失败原因持久化到 `message_failed.payload.reason`；前端 store 在收到 `message_status_changed(status=failed)` 时，应优先使用 status 事件中的 `error_text`，否则从本地已收到的 message events 中提取最近的 `message_failed.payload.reason`，最后才使用 `Unknown error`。

## 生效路径

1. `src/persistence/message-read-model.ts` 提供按 Snail cutoff 与 dispatch source 读取 inbox 的持久化查询。
2. `src/project/message-bus.ts` 使用新的 inbox 查询构造 `MessageBusBatch`，并记录本轮 assistant message 的 cutoff。
3. `src/agent/stateful-cli-agent.ts` 在调用 CLI 前拒绝空 prompt，输出包含运行时名称的明确错误。
4. `src/web/message-store.js` 在实时 failed 状态下从已收到事件提取 `message_failed` 原因。
5. `src/agent/runtime-error.ts` 将上游认证失败归类为需要管理员检查供应商配置的错误。
6. `tests/project/collaboration-test.ts` 覆盖并行 dispatch 后目标 Snail 仍能读到上次 cutoff 后产生的 source message。
7. `tests/project/collaboration-test.ts` 覆盖 cutoff id 后、目标回复前写入的非 source 消息不会被误判已读。
8. `tests/web/message-store-test.ts` 覆盖 failed status 从 message_failed signal 展示真实原因。
9. `tests/agent/opencode-parser-test.ts` 覆盖空 stateful prompt 在 spawn CLI 前失败。
10. `tests/agent/runtime-error-test.ts` 覆盖 provider 502 上游认证失败摘要。

## 改动范围

1. 更新 `src/persistence/message-read-model.ts`、`src/persistence/store.ts`、`src/persistence/schema.ts`、`src/persistence/types.ts`，同步 cutoff inbox 查询、默认值、类型格式和核心持久化入口。
2. 更新 `src/project/message-bus.ts`、`src/project/collaboration.ts`，同步协作投递 batch 构造和消息创建时的 cutoff 记录。
3. 更新 `src/agent/stateful-cli-agent.ts`、`src/agent/opencode.ts`、`src/agent/runtime-error.ts`，覆盖空 prompt 防御、测试入口和上游认证失败摘要。
4. 更新 `src/web/message-store.js`，同步实时失败原因展示。
5. 更新 `tests/project/collaboration-test.ts`、`tests/web/message-store-test.ts`、`tests/agent/opencode-parser-test.ts`、`tests/agent/runtime-error-test.ts`，覆盖协作投递、实时失败展示、空 prompt 和上游认证失败摘要。
6. 新增 `docs/features/F2026050605-dispatch-cutoff-error.md`。
7. 更新 `docs/core/core-message-model.md`，将 `context_cutoff_at` 核心样例和约束同步为 message id cutoff 语义。

## 验证

1. `npx tsx tests/project/collaboration-test.ts`
2. `npx tsx tests/web/message-store-test.ts`
3. `npx tsx tests/agent/opencode-parser-test.ts`
4. `npx tsx tests/agent/runtime-error-test.ts`
5. `npm run lint`
6. `npm run test`

已执行结果：上述验证均通过。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本次不新增 `context_cutoff_message_id` 字段。`docs/core/core-message-model.md` 已定义核心消息模型，`context_cutoff_at` 当前承载 cutoff message id 语义；问题不在缺字段，而在读取逻辑误用目标 Snail 上一条回复 id 作为边界。

决策记录：读取 cutoff 后消息时只按 Snail Shell `message.id` 递增边界判断。`lastSnailReply.id` 是目标 Snail 自己上一次输出的 id，不是上次读取输入时的 cutoff id，不能参与 inbox 截断。

决策记录：Boss Snail 明确决定，本 PR 合入后会保证所有既有对话已完结，后续只新开会话使用，因此不需要为旧 ISO 时间戳 `context_cutoff_at` 保留运行时兼容路径。读取层应把非数字 `context_cutoff_at` 视为数据不变量错误，而不是静默回退。

## 范围变更记录

1. 初始问题只聚焦 opencode 空 prompt；分析后确认根因是 message bus 未按 `context_cutoff_at` 使用原有读取边界设计，因此范围扩大到持久化读取模型与协作投递 batch 构造。
2. 用户补充看到 `Unknown error` 后，范围增加前端实时失败原因展示修复；该问题与空 prompt 共享同一 failed message，但属于展示层错误传播缺失。
3. 用户提醒历史里还有另一个错误后，确认 message `244` 的 `OpenAI request failed (502): Upstream authentication failed` 是 provider 层上游认证失败，本次补充错误摘要归类；环境初始化、脚本参数和临时 SQL 错误不属于产品代码修复范围。
4. 复检后曾误引入 `context_cutoff_message_id`，用户指出该改动违反 `docs/core` 核心消息模型约束；已撤回该字段，改回按现有 `context_cutoff_at` 的 cutoff message id 语义修复。
5. 复检指出核心模型样例、schema 默认值和旧 ISO 数据兼容仍停留在时间戳语义；本次同步核心模型文档、schema/store 默认值。
6. Boss Snail 明确裁决合入后旧对话不再继续使用，后续只新开会话，因此范围收敛为不做旧 ISO cutoff 兼容；已移除兼容回退分支和对应测试。
7. 复检指出 `改动范围` 未覆盖最终 diff 中仍存在的 agent、persistence、tests 等文件；本次补齐文档追溯范围，不改变代码语义。
