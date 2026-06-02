---
id: I2026050906
title: AI Base 判断契约优化
from_ids: [I2026050905]
tags: [prompt, governance]
modules: [knowledge_governance]
---
# I2026050906 AI Base 判断契约优化

## 背景

当前 `ai.base.system` 已覆盖用户决策、message-out、skill 引用边界、提示词可信边界和事实查证等基础契约，但对 AI 作为责任主体的判断方式约束不足。实际协作中仍会出现机械执行、只看表象不看本质、把反馈当方案、人云亦云或为了完成而完成的问题。

本 feature 需要以历史 feature、历史 conversation、知识中心候选和已审批知识为原料，抽象出适合所有 Snail 底层 AI 生效的判断契约，并补入 `.meta/prompts/base`。

## 目标

1. 为 `ai.base.system` 增补通用的判断与责任契约，要求 AI 把输入视为待判断的信息，而不是自动成立的结论或必须机械执行的命令。
2. 明确需求、反馈、工具输出、历史消息和检视意见都需要经过事实、层级和边界判断。
3. 把“先识别问题本质，再选择行动方式”的要求沉淀到 base 层，同时避免与研发迭代手册、检视手册和 `AGENTS.md` 重复堆叠。
4. 使用历史 feature、conversation 和知识中心内容作为提示词优化原料，确保新增规则来自真实问题而不是抽象口号。
5. 对原料分析中能明确归属到非 base 模块的长期优化点，按提示词语义结构补入对应 stage role playbook，而不是因本 feature 核心聚焦 base 就静默舍弃。
6. 将主动性定义为有边界的主体判断：尊重用户目标和决策权，但不把用户身份、权威或表达方式当作免判断理由；在当前目标和职责边界内主动暴露风险、机会、反例、范围缺口和更合适的归属。

## 非目标

1. 不重构 prompt 装配器或 skill 机制。
2. 不改变 Snail Shell 的 stage 流程、mention 协议或知识候选审批流程。
3. 不二次修改已合入 feature 文档来追写当前结论。
4. 不把研发者、检视者的具体阶段动作完整搬入 `ai.base.system`。

## 设计

`ai.base.system` 只承载所有 Snail 都应遵守的底层认知契约。本次优化采用新增 base prompt 模块的方式表达“判断与责任契约”，避免把 `P0001-AI基础契约.md` 继续扩成混合文档。

原料提取结果：

1. 历史 feature 显示多个问题都不是单点症状，而是未先判断本质归属，例如提示词重构中把历史上下文误放入 base、知识闭环中把字段或状态误包装成真实生效、UI 修复中为减少重复改写业务术语。
2. 历史 conversation 显示用户多次纠偏“不要只看表面词义”“要理解本质”，说明提示词需要直接约束 AI 处理输入前的判断链路。
3. 知识中心中已审批知识 `f73fc179-807f-4fe1-86c7-e85b817decbd` 和 `6e96a6c7-c3ac-4825-a3a8-ce8161270754` 指向同一类底层问题：反馈和症状必须先被归因到正确层级，再选择方案。
4. 候选知识中关于“提示词治理必须控制能力边界与上下文成本”“文档类 PR 检视不能停留在结构完整性”“禁止未收敛指标语义时用宽松字段兜底”等内容，进一步说明 base 规则应强调输入可信度、职责边界、真实生效和证据缺口，而不是罗列具体事故。

新增规则应保持短句、可执行、跨角色成立，重点覆盖以下判断链路：

1. 责任主体：AI 需要对判断、行动和输出负责，不能把自身降级为文本转换器或命令执行器。
2. 输入可信度：用户、历史、工具、文档和检视意见都是输入，不是自动成立的结论。
3. 独立判断：尊重用户目标和明确决策权，但不把用户身份、权威或表达方式当作免判断理由；即使用户是老板或需求提出者，也应基于事实、目标和系统边界形成独立判断。
4. 有边界的主动性：主动性不是无边界扩张任务，而是在当前目标和职责边界内主动暴露相关风险、机会、反例、范围缺口和更合适的归属；确定的问题应直接处理，存在真实取舍时应主动提问。
5. 问题层级：先判断问题指向表层表达、可见症状、事实缺口、业务语义、流程边界、系统模型还是长期规则。
6. 反馈处理：反馈描述不等于最终方案，不能为了表现为“已处理”而做形式化替换、局部遮掩、机械改名或条件分支堆叠。
7. 真实生效：不能把字段存在、状态变化、文档表述或局部配置伪装成能力已经真实生效。
8. 行动校准：行动前识别目标、约束和成功标准；行动中发现边界变化时，必须更新判断，而不是继续执行过期计划。
9. 语义验收：检视、验收或宣称完成前，必须回到任务本质目标、语义成功标准和可接受证据；不能把测试通过、文档齐全、流程完成或代码无明显缺陷当作语义有效性的替代证明。
10. 上升与提问：表层要求会延续错误模型或破坏长期可维护性时，应上升到正确层级说明取舍；需要用户决策时再提问。

review 阶段再次分析用户反馈后，确认还有两类规则不应放在 base，而应归入 Project Conversation / Stage Role Playbook：

1. 研发者在提示词治理中使用历史 feature、conversation 和知识中心作为原料时，如果发现可落入其他提示词模块的长期优化点，必须按语义结构主动归属和处理；不能因为初始核心范围聚焦某一模块而静默舍弃。该规则依赖 Snail Shell 提示词治理和研发者 development 行动，因此进入 `P010201`。
2. 检视者在 PR 检视前必须先判断 PR 的语义类型和本质目标，再选择检视重点；提示词、文档、流程治理、UI、运行时和数据模型类 PR 需要不同成功标准，不能默认套用代码缺陷清单。该规则绑定 Acceptance Snail review 行动，因此进入 `P010203`。

## 生效路径

1. `.meta/prompts/base/P0004-AI判断与责任契约.md`：新增 `ai.base.system` prompt 模块，运行时注入所有 Snail 的 base system prompt。
2. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`：补充提示词治理原料分析时的跨模块优化点处理规则，只在 Implementation Snail development stage 注入。
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010203-验收检视手册.md`：补充按 PR 语义类型和本质目标选择检视重点的规则，只在 Acceptance Snail review stage 注入。
4. `.meta/prompts/base/P0001-AI基础契约.md`：保留现有基础协议和事实边界，不承载本次新增认知契约。
5. `tests/meta/prompt-assets-test.ts`：覆盖新增 base prompt 的发现、归属和核心内容，并锁定新增 stage role playbook 规则，避免后续提示词重构时静默丢失判断契约。
6. `AGENTS.md`：同步补充与新增 stage role playbook 对应的长期规则，保持双线生效期间职责边界和术语一致。

## 改动范围

预计修改或新增：

1. `docs/features/20260509/I2026050906-ai-base-judgment-contract.md`
2. `.meta/prompts/base/P0004-AI判断与责任契约.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
4. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010203-验收检视手册.md`
5. `AGENTS.md`
6. `tests/meta/prompt-assets-test.ts`

已检查但不修改：

1. `.meta/prompts/base/P0001-AI基础契约.md`

## 验证

已执行：

1. `git diff --check`：通过。
2. 首次运行 `npm run check` 因隔离 worktree 尚未安装依赖失败，错误为 `tsx: command not found`。
3. `npm install`：完成 worktree 依赖安装。
4. 再次运行 `npm run check`：通过，包含 `generate-types`、`lint`、`build` 和 33 个编译后测试文件。
5. 已检查 prompt frontmatter 与正文格式符合 `.meta/prompts/prompt.md.template` 约定。
6. 已人工核对新增 base 契约与 `AGENTS.md`、研发迭代手册、检视手册不存在职责冲突或重复表达漂移。
7. 已人工核对原料来源：历史 feature、conversation 和知识中心内容被抽象为长期通用规则，而不是复制单次事故细节。
8. review 阶段根据 Acceptance Snail 语义复检意见，补充核对新增契约是否覆盖“不能以载体验收替代语义有效性判断”的本质目标。
9. review 阶段根据用户关于主动性的反馈，重新核对原料分析中可明确归属到非 base 模块的优化点，确认新增规则分别进入 `P010201`、`P010203` 和 `AGENTS.md`，而不是继续堆入 base。
10. review 阶段根据用户关于“老板不等于必须无条件听从”的反馈，补充核对 `P0004` 是否明确覆盖 AI 独立判断与有边界主动性。

## 风险与决策记录

用户已确认优化方向，并明确历史 feature、数据库中的对话、系统提示词和知识中心候选知识都可以作为提示词优化原料。

PR 记录：本 feature 已提交 PR #144，链接为 `https://github.com/chenlaicai/snail-shell/pull/144`。

已接受的设计决策：新增契约应放在 `ai.base.system`，因为问题本质是所有 Snail 的底层判断方式，而不是某个 stage 或单个角色的操作细则。

已接受的设计决策：本次新增 `P0004`，不把内容追加进 `P0001`。原因是 `P0001` 当前负责基础协议、事实和 skill 边界，判断契约单独成模块更符合提示词结构治理要求。

已接受的设计决策：本次不把已有审批知识原文直接复制到 base prompt。原因是现有知识多绑定 Implementation Snail 或具体场景；base 层只保留抽象后的跨角色判断契约。

已接受的设计决策：将“语义验收不能被载体验收替代”补入 `P0004`，而不是只加强 Acceptance Snail 检视手册。原因是该问题不只发生在 PR 检视，也发生在研发者自检、任务收口和任何 Snail 宣称完成时；它属于所有 Snail 都需要遵守的底层判断契约。

已接受的设计决策：将“原料分析发现非 base 优化点时不能静默舍弃”补入 `P010201`，而不是 `P0004`。原因是该规则依赖 Snail Shell 提示词治理、feature 范围和研发者实现职责，不是所有 AI 调用都成立的底层契约。

已接受的设计决策：将“按 PR 语义类型和本质目标选择检视重点”补入 `P010203`，而不是 `P0004`。原因是这是 Acceptance Snail 在 review stage 的检视方法论；base 只保留更通用的语义验收原则。

已接受的设计决策：将“用户权威不构成免判断理由”和“有边界的主动性”补入 `P0004`，并同步 `AGENTS.md`。原因是它们不是某个 stage 的操作细则，而是所有 Snail 在面对用户要求、老板反馈、检视意见和工具结果时都应遵守的底层主体性契约。

## 范围变更记录

1. 实现阶段新增 `tests/meta/prompt-assets-test.ts` 覆盖 `P0004`，原因是新增 base prompt 属于长期入口，测试应锁定其发现、归属和核心内容。
2. review 阶段根据用户反馈和 Acceptance Snail 复检意见，新增语义验收规则。原因是原契约虽然要求识别目标和成功标准，但仍可能让检视停留在测试、文档、流程或代码缺陷等载体层，未强制回到本次任务的语义目标判断。
3. review 阶段根据用户关于主动性的进一步反馈，范围扩展到 `P010201`、`P010203` 和 `AGENTS.md`。原因是本 feature 的原料分析确实包含可落入非 base 模块的优化点，继续只改 base 会把“核心聚焦”误当成“范围封闭”，与用户期望的主动发现和主动提问相违背。
4. review 阶段根据用户关于 AI 独立个体和非无条件服从的反馈，继续扩展 `P0004` 和 `AGENTS.md`。原因是原 base 契约虽然说 AI 不是被动执行器，但还没有直接约束“用户权威不能免除判断”和“主动性必须在目标边界内暴露风险、机会和反例”。
