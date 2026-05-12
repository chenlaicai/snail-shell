# F2026051108 系统提示词内容格式优化

## 背景

当前系统提示词已经按 AI Base、项目推进上下文和阶段角色手册拆分，但部分文件仍把身份认知、原则、工作流步骤、仓库基线、文档治理和输出契约混在同一个长行动清单中。典型表现是 `P010201` 的行动规则过长，模型接收的是大量并列命令，而不是清晰的职责模型和阶段工作流。

用户进一步指出：AI Base 应聚焦 AI 身份认知和原则性要求；场景提示词应聚焦场景中的职责描述；场景工作流程应通过准确的工作流描述约束，而不是通过散乱规则堆叠。用户也提出可考虑把“原则、做事流程”作为提示词文件拆分边界之一。

## 目标

1. 将 `Implementation Snail / Development` 提示词从散列行动规则改为职责原则、工作流程、专项规则和输出边界组成的结构。
2. 在核心提示词结构规范中明确“原则、流程”是提示词文件内部组织边界，只有在语义职责和触发条件也不同的情况下才升级为文件拆分边界。
3. 同步更新提示词模板、测试和 `AGENTS.md`，避免 `.meta/prompts/` 与双线规则漂移。
4. 保持现有 Development Stage 的关键约束不丢失，包括需求收敛、完整修复、feature 文档、提示词治理、验证、PR 收口、中文标题和注释要求。

## 非目标

1. 不调整 prompt registry 的运行时装配机制。
2. 不新增新的 `semantic_layer` 或 target。
3. 不重构全部阶段角色手册，只处理当前用户明确指出且影响当前研发阶段的结构问题，并更新长期规范供后续迁移使用。
4. 不改变 Snail Shell 的 stage 状态机、PR 流程或仓库隔离要求。

## 设计

本次调整采用“语义职责优先，原则/流程作为正文组织边界”的模型。

AI Base 继续承载所有 Snail 底层调用都必须遵守的身份认知、可信边界、决策边界和原则性约束，不引入 Project、Feature、Stage、Conversation 或 PR 相关规则。

项目推进场景继续由 Work Context 和 Stage Role Playbook 组成。Work Context 负责当前事实和场景边界；Stage Role Playbook 负责某个角色在某个 Stage 的职责原则、阶段工作流、专项规则和输出要求。

“原则”和“做事流程”不直接成为新的目录层或 target。原因是二者通常服务同一语义职责：原则说明判断边界，流程说明行动顺序。如果仅按原则/流程拆文件，模型需要跨多个短文件拼回同一阶段职责，反而降低执行效果。只有当原则与流程的命中条件、角色、stage、target 或维护责任不同，才应拆成独立文件。

## 生效路径

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md` 调整 Development 行动手册正文结构。
2. `docs/core/prompt-system-structure.md` 更新系统提示词文档编写规范和文件粒度规则。
3. `.meta/prompts/prompt.md.template` 更新模板写法建议，提示新增 prompt 按原则、流程、专项规则、输出契约组织。
4. `AGENTS.md` 同步提示词治理双线规则。
5. `tests/meta/prompt-assets-test.ts` 更新断言，验证关键约束仍进入运行时 prompt。

## 改动范围

1. 新增 `docs/features/20260511/F2026051108-prompt-content-format-optimization.md`。
2. 修改 `docs/core/prompt-system-structure.md`。
3. 修改 `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`。
4. 修改 `.meta/prompts/prompt.md.template`。
5. 修改 `tests/meta/prompt-assets-test.ts`。
6. 修改 `AGENTS.md`。

## 验证

1. 运行 `npm run test -- tests/meta/prompt-assets-test.ts`，验证 prompt registry 和运行时渲染断言。
2. 运行 `npm run check`，验证 lint、build 和完整测试。
3. 人工检查 `P010201` 渲染结果中的关键约束未丢失，且结构从散列行动规则改为可执行流程。

## 风险与决策记录

1. 决策：不把“原则”和“流程”直接升级为新目录层或 `semantic_layer`。它们作为正文组织边界更合适，避免引入新的装配层和跨文件拼装成本。
2. 决策：本次只重写 `P010201`，不批量迁移所有 playbook。用户指出的核心痛点集中在 Development 手册；其他 playbook 可按更新后的规范在后续 feature 中逐步治理。
3. 风险：`render_mode: outline` 只提取 bullet，正文小节标题不会进入最终 prompt。为避免流程标题丢失，流程步骤本身使用自描述 bullet 表达。

## 范围变更记录

暂无。
