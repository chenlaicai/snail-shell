# F2026051001 知识飞轮执行计划

## 背景

`docs/core/knowledge-lifecycle.md` 已定义知识闭环飞轮：Snail 在工作中提交候选知识，知识中心为每条候选启动知识治理 feature，由 Snail 与 Boss Snail 在治理对话中完成入口校验、查重定性、负反馈或新增知识审视，并最终回写候选去向。

本 feature 原计划直接改造当前知识模块。实现分析中发现一个关键边界：文档中的“知识治理 feature”不能直接复用项目管理的 `feature` 业务表。项目管理 feature 表达 Project 下的产品或系统迭代事项；知识治理 feature 是知识中心里的治理工作单元。如果两者共用同一张业务表，知识治理任务会污染项目管理 feature 列表，并让 Project Feature、知识治理、工作流实例三类概念混在一起。

因此本次先沉淀执行计划，作为后续实现基线。计划只描述要建设的能力、能力完成后达成的目标和实现要求；禁止事项作为约束写入对应能力，不作为独立动作。

## 目标

1. 明确知识治理 feature 与项目管理 feature 的业务边界。
2. 明确哪些能力可以复用，哪些表和模型不能共用。
3. 明确知识飞轮要建设的核心能力集合。
4. 给出每项能力的目标、实现要求和验证重点。
5. 为后续实现“治理对话”能力提供最小正确路径。

## 非目标

1. 本 PR 不直接改造数据库 schema。
2. 本 PR 不直接改造知识中心 UI。
3. 本 PR 不实现候选创建后自动启动治理。
4. 本 PR 不改动 prompt 注入逻辑。
5. 本 PR 不抽象完整通用工作流引擎，只定义后续实现边界和能力目标。

## 设计

### 核心边界

知识飞轮涉及三类不同概念：

1. 项目管理 feature：Project 下的产品、系统或文档迭代事项，对应现有项目管理页面、stage、PR、合入和仓库上下文。
2. 知识治理 feature：知识中心下围绕单条候选知识发起的治理事项，负责入口校验、查重定性、负反馈或新增知识审视、结论或 PR 去向回写。
3. 工作流能力：stage、conversation、artifact、snail 协作、正式产物要求、PR 或结论记录等可复用机制。

后续实现必须遵守：

1. 知识治理 feature 不写入项目管理 `feature` 表。
2. 项目管理 feature 列表不展示知识治理任务。
3. 知识治理可以复用 conversation、stage、artifact 和 snail 协作能力，但必须通过独立的治理归属模型表达。
4. 知识中心不是系统提示词权威源；它只记录候选如何被治理、最终去了哪里、再次出现时应看哪里。
5. 候选知识不自动变成 active，也不自动注入 prompt。

### 推荐目标模型

长期模型应抽出可被项目管理 feature 和知识治理 feature 共用的工作流实例层：

1. `workflow_instance`
   - 表达一个可推进的工作流实例。
   - 字段建议包括 `id`、`domain`、`kind`、`title`、`summary`、`status`、`owner_ref`、`metadata`、`created_at`、`updated_at`、`closed_at`。
   - `domain` 示例：`project_management`、`knowledge_center`。
   - `kind` 示例：`project_feature`、`knowledge_governance`。

2. `workflow_stage`
   - 替代或包裹现有 `stage` 的归属关系。
   - 字段建议包括 `id`、`workflow_instance_id`、`type`、`sequence`、`status`、`formal_artifacts`、`entered_at`、`left_at`。
   - 现有 Project Feature 的 stage 可以迁移为 `workflow_instance(kind='project_feature')` 下的 stage。

3. `conversation`
   - 应能归属到 `workflow_stage`。
   - Project、feature、stage 的上下文可以由 workflow owner 解析，而不是让 conversation 永远强依赖项目管理 feature。

4. `project_feature`
   - 项目管理 feature 的业务壳。
   - 可以保留现有 `feature` 表并逐步改名或新增表，最终它应指向 `workflow_instance_id`。

5. `knowledge_governance`
   - 知识治理 feature 的业务壳。
   - 字段建议包括 `id`、`knowledge_id`、`workflow_instance_id`、`entry_check_status`、`dedupe_status`、`scenario_type`、`disposition_status`、`artifact_type`、`related_knowledge_ids`、`final_destination`、`governance_pr_url`、`disposition_reason`、`deferred_reason`、`retrigger_condition`。

该模型的关键点是：业务壳分开，工作流能力共享。项目管理 feature 和知识治理 feature 都是 workflow 的 owner，但不是同一张业务表里的同一种记录。

## 能力建设计划

### 工作流归属边界与数据模型基座

目标：建立知识治理不共用项目管理 feature 表的基础模型。

实现要求：

1. 新增 `knowledge_governance` 表，记录候选知识对应的治理任务。
2. 新增治理状态枚举，至少覆盖入口校验、延后、负反馈、新增知识审视、结论、PR、落地、合并、仅参考。
3. 给 `knowledge_item` 增加最小关联字段，例如 `governance_status` 或通过 `knowledge_governance.knowledge_id` 反查。
4. 不修改项目管理 `feature` 表语义，不向项目管理 feature 列表写入知识治理任务。

验证重点：

1. 创建候选知识时可以创建 `knowledge_governance` 记录。
2. 项目管理 feature 列表不出现知识治理记录。
3. 治理状态与知识本体状态分开表达。

### 治理对话能力

目标：支持知识中心下的 Snail + Boss Snail 治理对话。

实现要求：

1. 优先抽象 conversation owner：允许 conversation 归属于 `project_feature` 或 `knowledge_governance`。
2. 如果短期无法改造 conversation 强依赖字段，则新增知识治理专用 conversation 表或桥接表，但必须明确后续迁移路径。
3. 治理对话默认包含 Boss Snail 与负责治理的 Snail。
4. 治理对话的系统上下文必须注入候选知识、来源、入口校验要求、查重要求、负反馈/新增知识分支和回写要求。

验证重点：

1. 知识中心可以打开某条候选的治理对话。
2. 治理对话不会出现在项目管理 feature conversation 列表中。
3. Snail 在治理对话中能看到候选来源和 `docs/core/knowledge-lifecycle.md` 定义的流程边界。

### 候选创建后启动治理

目标：把知识候选入口接入治理任务创建。

实现要求：

1. `.meta/scripts/knowledge-candidate` 创建候选后创建 `knowledge_governance`。
2. API 创建候选后创建 `knowledge_governance`。
3. 对同一 conversation 中短时间高度重复候选，允许先创建独立记录，但必须支持后续合并去向回写；不在创建前静默丢弃。
4. 输出中返回 `knowledge_id`、`governance_id`、`governance_conversation_id`。

验证重点：

1. 脚本测试覆盖候选创建后产生治理记录。
2. API 测试覆盖候选创建后产生治理记录。
3. 治理入口初始状态为等待入口校验。

### 入口校验与查重定性回写

目标：让治理 feature 能记录入口校验结果、查重结果和场景类型。

实现要求：

1. API 支持记录入口校验结果：继续治理、关闭、合并、延后。
2. API 支持记录查重结果和关联知识 ID。
3. API 支持记录场景类型：负反馈或新增知识审视。
4. 知识中心展示入口校验、查重和场景类型。

验证重点：

1. 入口关闭必须记录原因。
2. 延后治理必须记录延后原因和再次触发条件。
3. 负反馈必须记录关联旧知识或旧入口。
4. 新增知识审视必须记录为什么不是重复知识。

### 治理结论、PR 去向与最终回写

目标：完整表达候选最终去了哪里。

实现要求：

1. 支持产物形式：`conclusion_only`、`system_prompt_pr`、`skill_pr`、`core_doc_pr`、`user_manual_pr`、`code_or_checker_pr`、`merge_or_supersede_record`。
2. 支持记录 PR URL、合入状态、最终落地入口、不落地原因、仅参考原因、合并或替代关系。
3. 治理结束时强制候选有最终去向或明确延后状态。

验证重点：

1. 治理不能无结论关闭。
2. PR 型治理必须记录 PR URL 和预期落地入口。
3. 结论型治理必须记录不需要 PR 的原因。

### 知识中心 UI 改造

目标：知识中心按知识本体、治理进度和裁决去向展示，而不是按“审批候选”展示。

实现要求：

1. 候选列表展示治理状态和去向状态。
2. 详情页展示来源、治理对话、入口校验、查重、场景类型、裁决去向、最终落地入口。
3. 去掉“批准候选即生效”的主路径表达。
4. 保留 prompt 反哺配置，但明确它只适用于已治理为可用且允许注入的知识。

验证重点：

1. UI 文案不暗示候选会自动变成系统提示词。
2. UI 不暴露虚假的 skill/tool/checker 运行时开关。
3. 项目管理 feature 页面不展示知识治理任务。

### 知识反哺接入能力

目标：当系统需要让已治理知识进入 prompt、skill、检查器或其他运行时能力时，提供明确的知识反哺接入方式。

实现要求：

1. 反哺接入能力只读取已有治理结论的知识，候选创建本身不产生任何自动生效路径。
2. 治理裁决必须记录该知识是否允许进入运行时上下文，以及以 prompt、skill、检查器或其他形式进入。
3. 使用次数、正向反馈或人工引用次数只能作为参考信息，不能替代治理裁决。
4. 如果当前阶段不建设知识反哺能力，则不需要为不存在的自动生效路径单独规划实现步骤。

验证重点：

1. 反哺接入点能追溯到治理裁决。
2. 候选创建后不会自动进入任何运行时上下文。
3. 没有治理裁决的知识不能被反哺能力读取为生效输入。

### 通用 workflow 抽象收敛

目标：在知识治理对话跑通后，将项目管理 feature 和知识治理 feature 的共性沉淀到稳定工作流层。

实现要求：

1. 引入 `workflow_instance` 与 `workflow_stage`，或等价抽象。
2. 项目管理 feature 迁移为 `project_feature` 业务壳 + workflow。
3. 知识治理 feature 迁移为 `knowledge_governance` 业务壳 + workflow。
4. Conversation、artifact、stage input/output 通过 workflow owner 解析上下文。

验证重点：

1. 现有项目 feature 生命周期不回归。
2. 知识治理生命周期不污染项目 feature 列表。
3. 两类 workflow 都能保留 stage、conversation、artifact 和 PR/结论追溯能力。

## 生效路径

本 PR 的生效路径是文档基线：

1. `docs/features/20260510/F2026051001-knowledge-flywheel-implementation-plan.md` 作为当前 feature 的正式改造步骤记录。
2. `docs/core/knowledge-lifecycle.md` 作为长期生命周期模型，明确知识治理 feature 与项目管理 `feature` 表分离，只复用工作流能力。
3. 后续知识飞轮实现必须以 `docs/core/knowledge-lifecycle.md` 的长期模型为裁决依据，并参考本文档的能力建设计划。
4. 后续实现发生范围变更时，应更新对应实现 feature 的 feature 文档，不能改写已合入的历史 feature 文档。

## 改动范围

1. 新增当前 feature 文档：`docs/features/20260510/F2026051001-knowledge-flywheel-implementation-plan.md`。
2. 更新核心生命周期文档：`docs/core/knowledge-lifecycle.md`。
3. 不修改代码、schema、脚本或 UI。

## 验证

1. 核心生命周期文档保持“每条候选进入治理 feature，并且每条候选都有可追溯去向”的边界。
2. 核心生命周期文档明确知识治理 feature 不共用项目管理 `feature` 表，只通过独立治理归属模型复用工作流能力。
3. 当前执行计划与核心生命周期文档的边界一致：业务壳分开，工作流能力共享。
4. 文档能力计划覆盖治理对话、候选启动治理、入口校验、查重定性、裁决去向、知识中心 UI、知识反哺接入和 workflow 抽象。
5. 本 PR 无代码改动，不需要运行构建或测试；如提交前执行检查，应以文档 diff 审核为主。

## 风险与决策记录

1. 决策：知识治理 feature 不共用项目管理 `feature` 表。原因是两者业务语义不同，共表会污染项目管理 feature 列表，并让后续工作流抽象边界错误。
2. 决策：可复用的是工作流能力，不是项目管理 feature 业务表。后续应通过 workflow owner 或 workflow instance 抽象复用 stage、conversation、artifact 和产物机制。
3. 决策：本次不继续推进错误的直接实现，先以文档 PR 收敛能力目标和实现边界。原因是直接把知识治理写进项目管理 `feature` 表会建立错误模型。
4. 决策：如果后续先做基础治理对话能力，应优先保证对话归属在知识中心，不进入项目管理 feature 列表。

## 范围变更记录

1. 初始意图是直接按 `docs/core/knowledge-lifecycle.md` 改造当前知识模块。
2. 实现讨论中发现“治理 feature”不能共用项目管理 `feature` 表；用户确认该结论正确，并建议当前先聚焦改造步骤文档，后续分多个会话和 PR 按序实现。
3. 本 feature 范围因此从直接实现改为编写知识飞轮执行计划。
4. PR 检视指出“知识治理 feature 与项目管理 feature 业务表分离，只复用工作流能力”的关键约束不能只停留在当前 feature 文档；本 PR 因此同步更新 `docs/core/knowledge-lifecycle.md`，把该边界沉淀为长期生命周期模型。
