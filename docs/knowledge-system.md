# Snail Shell 知识系统设计

## 定位

知识系统是独立于 stage artifact 主链路的旁路学习链路。它观察对话、产物、PR、检视和人工输入，沉淀可复用知识，并在人工审批后反哺 agent 与系统能力。

知识不得进入 `stage.formal_artifacts`，也不得作为 stage 推进条件。知识提炼、审批或反哺失败不能阻塞主工作流。

## 核心边界

1. 所有知识必须有生效范围。
2. 候选知识默认不影响系统行为。
3. 候选知识转为生效知识必须人工审批。
4. 未审批知识不得自动进入 prompt、skill、工具查询优先结果或检查器。
5. 项目设计决策默认是 project scope，不得跨项目自动生效。
6. 每条可生效知识必须保留来源，便于审批和回溯。

## 生效范围

知识通过 `scope_type` 和 `scope_ref` 表达生效范围：

1. `global`: 整个 Snail Shell 实例生效。
2. `project`: 指定项目内生效。
3. `feature`: 指定 feature 内生效。
4. `stage_type`: 指定阶段类型生效。
5. `conversation`: 指定 conversation 内生效，默认不自动反哺。
6. `snail`: 指定 snail 角色生效。
7. `code_area`: 指定代码区域生效。
8. `workflow`: 指定工作流机制生效。

prompt 注入只读取 `active` 状态且匹配当前 project、feature、stage 或 snail 的知识。

## 治理生命周期

知识状态：

1. `candidate`: 待审批候选，不自动反哺。
2. `active`: 已人工审批，可按策略反哺。
3. `rejected`: 已拒绝。
4. `superseded`: 被替代。
5. `deprecated`: 已废弃。
6. `archived`: 已归档。

治理等级表示系统承诺程度：

1. `L0`: 候选知识。
2. `L1`: 已确认知识。
3. `L2`: 运行约束，会影响 agent 判断。
4. `L3`: 系统规则，未来可绑定 checker 或工作流策略。

治理等级不是 prompt、skill 或 MCP 的技术等级。prompt、skill、MCP、checker 都是反哺方式，具体使用哪种方式由知识语义决定。

## 反哺方式

`knowledge_usage_policy` 记录知识如何被使用：

1. `allow_prompt_injection`: 是否允许进入 prompt。
2. `prompt_mode`: `none`、`summary`、`full`、`reference_only`。
3. `skill_visibility`: 哪些 skill 可见。
4. `tool_visibility`: 哪些工具或 MCP 可见。
5. `checker_binding`: 是否绑定检查器。
6. `stage_types` 和 `snail_names`: 使用场景约束。
7. `priority` 和 `token_budget`: 注入排序和预算。

第一版实现了已审批知识的 prompt 注入和使用记录；skill、MCP、checker 绑定作为策略字段保留。

## UI

首层导航包含“项目管理”和“知识中心”。

知识中心包含：

1. 知识库：查看已存在知识。
2. 待审批：查看候选知识并批准或拒绝。
3. 当前项目知识：按当前项目过滤知识。

审批详情必须展示知识内容、来源、生效范围、治理状态、反哺策略和使用次数。
