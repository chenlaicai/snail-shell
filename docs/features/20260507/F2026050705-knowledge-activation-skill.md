# F2026050705 知识生效途径 Skill

## 背景

PR120 暴露出知识体系后半段的设计缺口：当前知识从候选到已审批后的反哺路径主要按动态系统提示词理解，而用户的原始设想还包括沉淀为 skill、MCP、tool、checker 等静态生效路径。动态提示词只覆盖运行过程中的上下文注入，不能代表知识长期生效的全部方式。

作为 skill 沉淀是知识生效的典型路径，因此需要把“已提取知识后如何选择生效形态、如何反馈、如何更新”的模型重新梳理，并让 agent 在处理知识审批和落地时有明确的能力包可调用。

## 目标

1. 明确知识生效分为动态生效和静态生效两大类，不再把动态系统提示词当作唯一反哺方式。
2. 新增一个面向 agent 的 `knowledge-activation` skill，用于判断已审批知识应进入 prompt、skill、MCP/tool、checker 或文档/代码等长期入口。
3. 补充长期核心设计文档，定义候选、审批、生效、反馈、更新的生命周期边界。
4. 调整知识中心展示文案，让 UI 明确呈现 skill、tool、checker 等策略字段，避免继续暗示只有 prompt 注入。
5. 保持现有动态提示词注入能力可用，不破坏既有已审批知识的 prompt 匹配、使用记录和范围约束。

## 非目标

1. 本 feature 不实现自动生成或自动安装 skill、MCP server、tool 或 checker。
2. 本 feature 不改变知识候选创建、人工审批、拒绝、废弃或归档的状态流。
3. 本 feature 不迁移既有知识数据，也不补录 PR120 相关历史知识。
4. 本 feature 不为 MCP 建立完整运行时注册表；本轮只把 MCP/tool 作为静态生效路径纳入设计与策略表达。

## 设计

知识生命周期拆为五段：提取为候选、人工审批、选择生效途径、记录使用反馈、按反馈更新或废弃。

生效途径分为：

1. 动态生效：已审批知识在运行时按 project、feature、stage、snail 范围匹配，注入到系统提示词或被搜索引用。
2. 静态生效：知识转化为仓库内长期入口，例如 `.meta/skills/<skill>/SKILL.md`、`.meta/prompts/`、MCP/tool 配置、checker、`AGENTS.md`、`docs/core`、`user-manual`、代码或脚本。

新增 `knowledge-activation` skill 只负责提供判断和落地流程，不负责自动写入任何长期入口。这样可以避免把所有生效规则继续塞进系统提示词，也避免让候选知识绕过人工审批直接生效。

现有 `knowledge_usage_policy` 已包含 `allow_prompt_injection`、`prompt_mode`、`skill_visibility`、`tool_visibility`、`checker_binding`、`stage_types`、`snail_names` 等字段，本 feature 复用这些字段表达多路径策略，不新增 schema。UI 详情页改为展示完整策略摘要。

## 生效路径

1. `.meta/skills/knowledge-activation/SKILL.md` 提供知识生效路径选择、静态落地、反馈和更新的 agent 操作协议。
2. `.meta/prompts/scene/conversation/SYS-CONV-KNOWLEDGE-ACTIVATION-knowledge-activation.md` 声明已审批知识生效设计的条件式 skill 调用入口，不复制 skill 的完整规则。
3. `docs/core/knowledge-activation-lifecycle.md` 作为长期核心设计文档，约束后续知识体系开发和检视。
4. `src/web/knowledge-center.js` 在知识中心展示多路径反哺策略，避免 UI 继续只强调 prompt。
5. `tests/meta/prompt-assets-test.ts` 验证 `knowledge-activation` skill 可发现且提示入口正确引用。
6. `tests/web/knowledge-center-test.ts` 覆盖知识中心策略展示，锁定 skill/tool/checker 字段不会被忽略。
7. `tests/persistence/persistence-test.ts` 覆盖既有动态 prompt 注入路径与静态策略字段共存，确认不会回归为单一路径。

## 改动范围

1. 新增 `docs/features/20260507/F2026050705-knowledge-activation-skill.md`。
2. 新增 `docs/core/knowledge-activation-lifecycle.md`。
3. 新增 `.meta/skills/knowledge-activation/SKILL.md`。
4. 新增 `.meta/prompts/scene/conversation/SYS-CONV-KNOWLEDGE-ACTIVATION-knowledge-activation.md`。
5. 更新 `src/web/knowledge-center.js`。
6. 更新 `tests/persistence/persistence-test.ts`。
7. 新增或更新知识中心前端测试和 prompt/skill 资产测试。

## 验证

1. 运行 `npm run check`。
2. 验证新增 feature 文档编号与目录符合 `docs/README.md`。
3. 验证知识中心详情页能展示 prompt、skill、tool、checker、stage/snail 范围和优先级。
4. 验证已有 prompt injection 成功、禁用 `prompt_mode = none`、使用记录查询等既有路径不退化。
5. 验证会话系统提示词能以条件式 skill reference 暴露 `knowledge-activation`，且具体取舍仍集中在 skill 中。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本 feature 选择先固化生效模型、skill 协议和现有策略字段展示，不在本轮自动生成静态入口。原因是静态生效会修改仓库长期规则、工具或 skill，本质上需要人工评审和 PR 流程，不能由知识审批动作直接隐式完成。

## 范围变更记录

1. 实现阶段发现仅新增 skill 不足以让运行上下文知道何时调用该能力，因此补充轻量会话级提示入口；该入口只声明触发场景和 skill reference，不复制生效路径细节。
