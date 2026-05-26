---
id: F2026051107
title: 知识飞轮治理落地
from_ids: []
tags: [knowledge, governance]
modules: [knowledge_governance]
---
# F2026051107 知识飞轮治理落地

## 背景

`docs/features/20260510/F2026051001-knowledge-flywheel-implementation-plan.md` 已明确知识治理 feature 不能复用项目管理 `feature` 表，只能从流程上复用工作流能力。当前代码中候选知识仍主要围绕审批与 prompt 反哺策略表达，缺少独立治理业务壳、治理对话入口、入口校验、查重定性、裁决去向和运行时反哺裁决记录。

## 目标

1. 为候选知识创建独立的 `knowledge_governance` 记录，不写入项目管理 `feature` 表。
2. 候选创建后自动生成真实知识治理对话，承载后续 Snail 与 Boss Snail 治理；治理对话、消息、事件和派发数据必须写入知识治理专用表，不写入项目管理 `conversation` / `message` / `message_event` / `message_dispatch` 表。
3. 记录入口校验、查重定性、场景类型、裁决去向、PR URL、最终落地入口和反哺通道裁决。
4. 让脚本、API 和知识中心 UI 都能展示或返回治理记录。
5. 确保候选创建和 active 状态都不会绕过治理裁决自动进入 prompt 注入。

## 非目标

1. 本次不抽象完整通用 `workflow_instance` / `workflow_stage`。
2. 本次不把项目管理 feature 迁移为 workflow owner。
3. 本次不把治理判断、系统提示词编写、PR 处理和最终去向裁决软件化为固定状态机；这些由治理对话中的 AI 按提示词完成。
4. 本次不新增 skill、checker 或 tool 的真实运行时注册能力。

## 设计

新增 `knowledge_governance` 作为知识中心业务壳，字段覆盖入口校验、查重、场景类型、裁决状态、产物类型、关联知识、最终去向、PR URL、延后原因、再次触发条件、运行时反哺允许状态和反哺通道。它与 `knowledge_item` 一对一关联，不与项目管理 `feature` 表共享记录。

治理对话不复用项目管理 `conversation` / `message` / `message_event` / `message_dispatch` 数据表，而是写入 `knowledge_governance_conversation`、`knowledge_governance_message`、`knowledge_governance_message_event` 和 `knowledge_governance_message_dispatch`。这些表可以复用现有消息运行时的流程和代码模式，但数据必须从项目管理工作流表中隔离，避免知识治理被误认为 Project Feature 或 Stage 的一部分。

治理对话的系统提示词注入候选知识、来源、入口校验要求、查重要求、负反馈/新增知识分支、最终去向和回写要求。软件边界保持为“提取候选知识 + 开启治理对话 + 提供回写入口”；具体判断和 PR 工作由治理对话里的 AI 完成。

候选创建路径统一通过存储层自动创建治理业务壳和专用治理对话。脚本输出新增 `governance_id` 与 `governance_conversation_id`，API 创建知识时返回的知识详情包含 `governance`。知识列表和搜索结果也携带治理摘要，便于 UI 展示。

运行时反哺以治理裁决为上游门禁：`listPromptInjectableKnowledge` 除了检查 `knowledge_item.status = active` 和 usage policy，还要求治理记录明确 `runtime_feedback_allowed = true` 且包含 `prompt` 通道。历史或迁移导入且没有治理记录的 active 知识保留原行为，避免破坏既有受控数据。

## 生效路径

1. `src/persistence/schema.ts` 新增知识治理表、治理专用对话/消息表和索引。
2. `src/persistence/knowledge-model.ts` 与治理专用 persistence 模块负责候选创建、治理记录读写、治理消息读写和 prompt 反哺门禁。
3. `src/api/knowledge-routes.ts` 暴露治理记录读取和更新 API。
4. `src/bin/knowledge-candidate.ts` 返回治理记录与治理对话 ID。
5. `src/snails/prompt-builder.ts` 与 `src/project/knowledge-governance-prompt.ts` 为知识治理对话注入候选知识和治理工作规则。
6. `src/web/knowledge-center.js` 展示治理进度、裁决去向和反哺门禁文案。

## 改动范围

1. 数据模型：`src/persistence/schema.ts`、`src/persistence/knowledge-types.ts`、`src/persistence/helpers.ts`、`src/persistence/knowledge-model.ts`、`src/persistence/knowledge-governance-conversation-model.ts`、`src/persistence/store.ts`。
2. 业务/API：`src/project/manager.ts`、`src/project/knowledge-governance-prompt.ts`、`src/api/knowledge-routes.ts`、`src/bin/knowledge-candidate.ts`。
3. UI：`src/web/knowledge-center.js`。
4. 测试：`tests/persistence/persistence-test.ts`、`tests/project/stage-cycle-test.ts`、`tests/scripts/knowledge-candidate-test.ts`、`tests/web/knowledge-center-test.ts`。

## 验证

1. `npm run build`
2. `npm run test`
3. 测试覆盖候选创建后产生治理记录和真实治理对话。
4. 测试覆盖知识治理记录和治理 conversation/message/event/dispatch 不写入项目管理 conversation/message/event/dispatch 表，也不进入项目管理 feature/stage 归属。
5. 测试覆盖治理 conversation 能进入现有 agent message pipeline，且系统提示词包含候选知识和 AI 驱动治理边界。
6. 测试覆盖 prompt 注入受治理裁决门禁控制。
7. 测试覆盖知识中心 UI 不再暗示候选或 active 知识会自动进入系统提示词。
8. 测试覆盖旧版项目管理 `conversation` 表即使仍保留 project/feature/stage 非空约束，也不影响知识治理专用对话创建。
9. 测试覆盖治理 message event 对外 cursor 使用独立命名空间，普通项目 conversation 的较大 event cursor 不会过滤治理 conversation 的增量事件。
10. 测试覆盖治理 dispatch 对外 id 使用独立命名空间，治理 dispatch 与项目 dispatch 内部 id 碰撞时，项目 `markDispatchesSeen()` / 治理 `skipDispatches()` 仍分别路由到正确物理表。

## 风险与决策记录

1. 决策：治理对话、消息、事件和派发写入知识治理专用表，不写入项目管理 `conversation` / `message` 等表。原因是“复用工作流能力”只表示流程模式可复用，不表示数据模型共享；知识治理必须保持干净独立，后续如需公共抽象应在独立实现稳定后再提炼。
2. 决策：没有治理记录的历史 active 知识继续按原 usage policy 参与 prompt 注入。原因是这类数据可能来自受控迁移或旧版本审批，立即强制阻断会造成不可预期回归；新候选都会自动生成治理记录并受门禁约束。
3. 决策：`approveKnowledge` 不再默认创建 prompt usage policy，除非治理裁决已经允许 prompt 反哺。原因是 active 只是知识本体状态，不等同最终反哺去向。
4. 决策：不再为了知识治理改造项目管理 `conversation` 表的 owner 语义或 project/feature/stage 可空约束。原因是知识治理已使用专用数据表，旧项目管理 conversation schema 不应成为知识治理启动路径的依赖。

## 范围变更记录

1. 用户要求按 20260510 执行计划一次性改造知识飞轮。本次实现覆盖计划中的数据模型基座、治理对话 shell、候选启动治理、治理结果回写基础 API、UI 展示和知识反哺门禁。
2. 用户纠偏指出知识中心核心软件工程能力应是“提取知识 + 开启治理对话”，治理判断、系统提示词编写和 PR 流程应借助治理对话中的 AI 完成，而不是实现大量固定软件流程。本次因此新增治理系统提示词上下文。
3. 用户进一步澄清“复用工作流能力”只允许流程复用，数据必须独立；本次因此取消治理对话对项目管理 conversation/message 表的复用，改为知识治理专用对话数据表。通用 workflow 抽象未在本次实现中展开，后续如需消除代码重复，应在独立数据边界稳定后再抽象公共层。
4. PR 复检指出治理 message id 虽已隔离，但 message event id 仍暴露治理专表本地自增值，会与项目 `message_event` 的 conversation 级实时 cursor 混用。本次将治理 event id 也映射到外部负数命名空间，保持治理专表独立的同时兼容既有 `last_event_id` API。
5. PR 复检指出治理 dispatch 专表仍暴露本地正整数 id，`markDispatchesSeen()` / `skipDispatches()` 会因治理表和项目表自增 id 碰撞而误路由。本次将治理 dispatch id 映射到独立负数命名空间，门面更新 API 按外部 id 命名空间拆分更新，避免再通过裸正整数探测物理表。
