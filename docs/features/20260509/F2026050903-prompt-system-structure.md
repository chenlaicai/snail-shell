# F2026050903 系统提示词结构设计文档

## 背景

当前 `.meta/prompts/` 已经把系统提示词拆成多个文件，但现有结构主要围绕运行时 `target`、文件路径和注入顺序组织。用户指出当前系统提示词语义结构混乱，需要先从语义上重新设计提示词组成结构，并明确本次不涉及代码实现。

本 feature 单独沉淀一份 core 级设计文档，用于定义系统提示词长期语义分类、归属规则和维护边界。

## 目标

1. 新增系统提示词结构设计文档，作为后续整理 `.meta/prompts/` 和 Prompt Center 展示的长期依据。
2. 明确 `AI Base System Prompt`、`Scenario System Prompts`、`Project Conversation Prompt`、`Task Runtime Prompts` 和预留 `Chat Prompt` 的层级关系。
3. 明确 `Project Conversation Prompt` 内部的 `Work Context` 与 `Stage Role Playbook` 分工。
4. 明确知识、历史访问、skill references、`AGENTS.md` 与 Prompt Center 的归属和维护边界。
5. 保证本 PR 只包含 core 文档和当前 feature 文档，不夹带 Prompt Center UI 改造。

## 非目标

1. 不修改 `.meta/prompts/` 的具体提示词内容。
2. 不修改 prompt registry、prompt builder 或 Prompt Center 运行代码。
3. 不调整 UI 页面结构、样式或交互。
4. 不实现新的 Chat Prompt 场景；仅作为未来分类预留。
5. 不改写已合入 feature 的历史文档。

## 设计

新增 `docs/core/prompt-system-structure.md`，采用“归属规则 + 属于 + 不属于 + 示例”的结构描述提示词分类。

文档定义以下层级：

1. 第一层：`AI Base System Prompt（AI 基础系统提示词）`。
2. 第二层：`Scenario System Prompts（场景系统提示词）`。
3. `Scenario System Prompts` 下包含 `Project Conversation Prompt（项目推进会话提示词）`、`Task Runtime Prompts（任务运行时提示词）` 和预留 `Chat Prompt（闲聊提示词）`。
4. `Project Conversation Prompt` 下包含 `Work Context（工作上下文）` 与 `Stage Role Playbook（阶段角色行动手册）`。

文档同时定义维护规则：

1. 一条长期规则只能有一个主归属。
2. 事实与行为分离。
3. 能力引用与能力正文分离。
4. 知识按具体生效方式归属，不形成独立提示词分类。
5. `AGENTS.md` 与 `.meta/prompts/` 双线生效期间必须保持同类强约束一致。
6. Prompt Center 只展示语义阅读模型和运行时装配结果，不反向定义模型。

## 生效路径

本 feature 通过以下长期入口生效：

1. `docs/core/prompt-system-structure.md`：定义系统提示词语义结构与维护规则。
2. `docs/features/20260509/F2026050903-prompt-system-structure.md`：记录本次设计边界、取舍和验证结果。

## 改动范围

新增：

1. `docs/core/prompt-system-structure.md`
2. `docs/features/20260509/F2026050903-prompt-system-structure.md`

不修改：

1. `.meta/prompts/`
2. `src/`
3. `docs/features/20260509/F2026050901-prompt-center-redesign.md`

## 验证

1. 已检查新增文档只包含 core 设计文档和当前 feature 文档。
2. 已检查文档不修改 `.meta/prompts/` 和运行代码。
3. 已检查文档结构保留层级关系，不把所有提示词分类拍平成同级。
4. 已检查文档不设置 `Active Knowledge` 独立分类，不把知识作为独立系统提示词分类。

## 风险与决策记录

1. 决策：本 feature 只出语义结构文档，不直接调整提示词文件。原因是当前用户要求先收敛设计，避免在结构尚未稳定时改 `.meta/prompts/`。
2. 决策：知识不作为独立系统提示词分类；知识按具体生效方式归入 `AI Base System Prompt`、`Work Context`、`Stage Role Playbook`、`Task Runtime Prompts` 或未来 `Chat Prompt`。
3. 决策：历史访问能力不单独建分类；如果它作为能力入口存在，应与 skill references 使用同一抽象处理。
4. 决策：保留 `Chat Prompt` 作为预留分类，但本 feature 不实现对应运行时代码。
5. 风险：后续真正整理 `.meta/prompts/` 时，需要按本文档重新拆分现有 prompt 文件，届时必须同时检查 `AGENTS.md` 与 `.meta/prompts/` 双线一致性。

## 范围变更记录

1. 本 feature 从 Prompt Center UI 改造 PR 中拆出，独立提交 core 设计文档，避免 UI PR 夹带提示词结构治理内容。
