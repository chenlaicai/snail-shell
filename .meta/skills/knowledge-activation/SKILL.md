---
name: knowledge-activation
description: 设计已审批知识的生效途径时使用。用于在动态提示词、skill、MCP/tool、checker、文档和代码等路径之间做取舍，并记录反馈与更新边界。
---

# Knowledge Activation Protocol

## Purpose

你负责把已审批知识从“可复用结论”转化为明确的生效方案。知识生效不等于系统提示词注入；prompt 注入只是动态生效的一种方式，skill、MCP/tool、checker、文档和代码是同等重要的静态生效路径。

## When To Use

当你处理以下任务时使用本 skill：

1. 审批或复核知识后，需要决定它如何影响后续 agent 行为。
2. 已审批知识频繁被动态提示词注入，可能需要沉淀为 skill、prompt、checker、文档或代码。
3. 用户要求把某类知识“长期生效”“沉淀为 skill/tool/MCP/checker”。
4. 检视发现知识只通过 prompt 生效，无法覆盖静态工作流、工具能力或自动验证。
5. 需要根据知识使用反馈决定更新、废弃、归档或替代路径。

## Activation Routes

1. `dynamic_prompt`: 适合短期或可调整的规则、偏好、提醒和上下文约束。必须受 `allow_prompt_injection`、`prompt_mode`、scope、stage 和 snail 策略约束。
2. `skill`: 适合可复用操作协议、领域流程、结构化输出或需要附带脚本的能力包。入口为 `.meta/skills/<skill-name>/SKILL.md`。
3. `prompt`: 适合稳定身份、角色职责、场景边界和必须在系统上下文中持续出现的规则。入口为 `.meta/prompts/`。
4. `mcp_or_tool`: 适合需要外部系统、自动化动作、可调用接口或运行时能力的知识。入口可能是 MCP 配置、工具实现、脚本或服务接入。
5. `checker`: 适合必须自动防回归的规则。入口可能是测试、lint、CI、脚本或专用检查器。
6. `docs_or_code`: 适合长期模型、用户手册、系统不变量、业务规则或实现逻辑。入口包括 `docs/core`、`user-manual`、`AGENTS.md`、代码和脚本。
7. `reference_only`: 适合保留为可搜索背景，不应主动注入或改写静态入口的知识。

## Decision Rules

1. 如果知识只是当前任务的临时上下文，不要生效为长期入口。
2. 如果知识需要每轮提醒但仍可能调整，优先动态提示词，并设置清晰 scope、stage、snail 和 token 策略。
3. 如果知识描述“如何完成一类任务”，优先沉淀为 skill，而不是把步骤复制到系统提示词。
4. 如果知识描述“某个角色或场景必须遵守的身份边界”，优先沉淀到 `.meta/prompts/`，并同步检查 `AGENTS.md` 是否存在并行规则。
5. 如果知识必须通过自动动作或外部系统执行，优先设计 MCP/tool 或脚本路径；不要假设 agent 仅靠提示词能稳定完成。
6. 如果知识必须防止回归，优先绑定 checker、测试或 CI；不要只依赖人工记忆。
7. 如果静态生效会修改仓库长期入口，必须通过 feature 文档、代码 diff、验证和 PR 完成，不能把知识审批本身当作已落地。

## Static Activation Workflow

1. 确认知识已是 `active`，并读取来源、范围、治理等级和现有 `knowledge_usage_policy`。
2. 判断目标路径是 skill、prompt、MCP/tool、checker、docs/code 还是组合路径。
3. 检查目标长期入口是否已有相同规则，避免重复、冲突或边界漂移。
4. 如需修改仓库，创建 feature 文档并按正常开发流程提交 PR。
5. 在 PR 说明或 feature 文档中记录知识来源、设计取舍、生效路径和验证结果。
6. 更新或确认使用策略字段，例如 `skill_visibility`、`tool_visibility`、`checker_binding`、`prompt_mode`。
7. 后续根据 `knowledge_use` 反馈决定是否保留动态注入、转为 reference only、废弃或替代。

## Hard Rules

1. 不要把候选知识直接生效；候选必须先经人工审批。
2. 不要把 prompt 注入当作默认唯一答案；必须显式考虑静态生效路径。
3. 不要在多个长期入口复制同一规则；如必须双线生效，应说明职责边界和一致性检查方式。
4. 不要让 `skill_visibility`、`tool_visibility` 或 `checker_binding` 伪装成已落地实现；它们只是策略字段，实际落地必须由仓库入口或外部配置证明。
5. 不要为当前 feature 正在交付且已通过本轮 diff 固化的同一内容再创建重复知识候选。
