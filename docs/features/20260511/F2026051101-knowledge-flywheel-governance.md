# F2026051101 知识飞轮治理落地

## 背景

`docs/features/20260510/F2026051001-knowledge-flywheel-implementation-plan.md` 已明确知识治理 feature 不能复用项目管理 `feature` 表，只能复用工作流能力。当前代码中候选知识仍主要围绕审批与 prompt 反哺策略表达，缺少独立治理业务壳、治理对话入口、入口校验、查重定性、裁决去向和运行时反哺裁决记录。

## 目标

1. 为候选知识创建独立的 `knowledge_governance` 记录，不写入项目管理 `feature` 表。
2. 候选创建后自动生成真实知识治理对话，承载后续 Snail 与 Boss Snail 治理。
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

治理对话复用现有 `conversation` / message / runtime 能力，但通过 `conversation.owner_type = 'knowledge_governance'` 与 `owner_id = knowledge_governance.id` 归属到知识中心。它不设置 `project_id`、`feature_id`、`stage_id`，因此不会出现在项目管理 Feature、Stage 或 Conversation 列表里，也不会伪造项目工作流归属。

治理对话的系统提示词注入候选知识、来源、入口校验要求、查重要求、负反馈/新增知识分支、最终去向和回写要求。软件边界保持为“提取候选知识 + 开启治理对话 + 提供回写入口”；具体判断和 PR 工作由治理对话里的 AI 完成。

候选创建路径统一通过存储层自动创建治理业务壳。脚本输出新增 `governance_id` 与 `governance_conversation_id`，API 创建知识时返回的知识详情包含 `governance`。知识列表和搜索结果也携带治理摘要，便于 UI 展示。

运行时反哺以治理裁决为上游门禁：`listPromptInjectableKnowledge` 除了检查 `knowledge_item.status = active` 和 usage policy，还要求治理记录明确 `runtime_feedback_allowed = true` 且包含 `prompt` 通道。历史或迁移导入且没有治理记录的 active 知识保留原行为，避免破坏既有受控数据。

## 生效路径

1. `src/persistence/schema.ts` 新增知识治理表和索引。
2. `src/persistence/knowledge-model.ts` 负责候选创建、治理记录读写和 prompt 反哺门禁。
3. `src/api/knowledge-routes.ts` 暴露治理记录读取和更新 API。
4. `src/bin/knowledge-candidate.ts` 返回治理记录与治理对话 ID。
5. `src/snails/prompt-builder.ts` 与 `src/project/knowledge-governance-prompt.ts` 为知识治理对话注入候选知识和治理工作规则。
6. `src/web/knowledge-center.js` 展示治理进度、裁决去向和反哺门禁文案。

## 改动范围

1. 数据模型：`src/persistence/schema.ts`、`src/persistence/knowledge-types.ts`、`src/persistence/helpers.ts`、`src/persistence/knowledge-model.ts`、`src/persistence/store.ts`。
2. 业务/API：`src/project/manager.ts`、`src/project/knowledge-governance-prompt.ts`、`src/api/knowledge-routes.ts`、`src/bin/knowledge-candidate.ts`。
3. UI：`src/web/knowledge-center.js`。
4. 测试：`tests/persistence/persistence-test.ts`、`tests/project/stage-cycle-test.ts`、`tests/scripts/knowledge-candidate-test.ts`、`tests/web/knowledge-center-test.ts`。

## 验证

1. `npm run build`
2. `npm run test`
3. 测试覆盖候选创建后产生治理记录和真实治理对话。
4. 测试覆盖知识治理记录和治理 conversation 不进入项目管理 feature/stage 归属。
5. 测试覆盖治理 conversation 能进入现有 agent message pipeline，且系统提示词包含候选知识和 AI 驱动治理边界。
6. 测试覆盖 prompt 注入受治理裁决门禁控制。
7. 测试覆盖知识中心 UI 不再暗示候选或 active 知识会自动进入系统提示词。
8. 测试覆盖旧版 `conversation` 表在缺少治理 owner 语义或仍保留 project/feature/stage 非空约束时，仍可迁移后创建候选知识并生成治理对话。

## 风险与决策记录

1. 决策：治理对话写入现有 `conversation` 表，但用 owner 模型归属到 `knowledge_governance`，不填 project feature/stage。原因是治理对话必须复用现有 AI 消息运行时和系统提示词构建能力，但不能污染项目管理工作流。
2. 决策：没有治理记录的历史 active 知识继续按原 usage policy 参与 prompt 注入。原因是这类数据可能来自受控迁移或旧版本审批，立即强制阻断会造成不可预期回归；新候选都会自动生成治理记录并受门禁约束。
3. 决策：`approveKnowledge` 不再默认创建 prompt usage policy，除非治理裁决已经允许 prompt 反哺。原因是 active 只是知识本体状态，不等同最终反哺去向。
4. 决策：旧数据库里的 `conversation` 表如果仍保留 `project_id` / `feature_id` / `stage_id` 的 `NOT NULL` 约束，会在初始化时原地重建为当前可表达治理对话的结构。原因是治理对话必须写入真实的 `owner_type = knowledge_governance` 归属，不能依赖插空值或把错误约束留给运行期失败。

## 范围变更记录

1. 用户要求按 20260510 执行计划一次性改造知识飞轮。本次实现覆盖计划中的数据模型基座、治理对话 shell、候选启动治理、治理结果回写基础 API、UI 展示和知识反哺门禁。
2. 用户纠偏指出知识中心核心软件工程能力应是“提取知识 + 开启治理对话”，治理判断、系统提示词编写和 PR 流程应借助治理对话中的 AI 完成，而不是实现大量固定软件流程。本次因此把治理对话从专用 shell 改为真实 conversation owner，并新增治理系统提示词上下文。
3. 通用 workflow 抽象未在本次实现中展开；当前只补 conversation owner 能力以支撑知识治理对话，项目管理 feature/stage 仍保持原生命周期。
