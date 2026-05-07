# F2026050705 知识真实生效闭环

## 背景

用户反馈已批准过一条知识，但知识中心显示使用次数仍为 0，因此怀疑“知识生效、反哺、再沉淀”的飞轮流程没有成立。进一步讨论后确认，本 feature 的目标不是“只修一个计数显示”，而是让知识真正生效；同时必须实事求是地区分当前系统已经封装的运行时生效方式和仍需静态产物落地的未来方式。

当前代码事实如下：

1. `knowledge_item` 已支持候选、审批、active、废弃等知识治理状态。
2. `knowledge_usage_policy` 已支持 prompt 相关字段，并预留了 `skill_visibility`、`tool_visibility`、`checker_binding` 等字段。
3. 当前唯一已经封装并接入运行时的自动反哺方式是系统提示词注入：构建 agent system prompt 时查询 active 且策略命中的知识，渲染到“知识上下文”，并记录 `prompt_injection` 使用。
4. Skill、MCP/tool、checker 在当前系统中更接近静态仓库产物或运行环境配置；没有“批准一条知识后自动生成/注册 skill、MCP server/tool 或 checker”的封装链路。
5. 因此，把 skill、MCP/tool、checker 做成知识中心里的“可配置生效方式”但不落地产物或运行时接入，是伪生效，会继续破坏用户对知识飞轮的信任。

本 feature 需要先把当前真实可用的 prompt 反哺闭环打通，并在文档中明确后续静态载体要如何真正落地，而不是把预留字段包装成能力。

## 目标

1. 明确“知识生效”的定义：知识被运行时消费、静态产物落地后被系统读取，或被人工引用并记录使用，才算生效；仅 active 或仅配置字段不算生效。
2. 打通当前已有封装的真实生效路径：审批后的知识默认具备 prompt 反哺策略，后续匹配上下文时进入系统提示词并记录使用次数。
3. 知识中心只展示和配置当前真实运行时接入的 prompt 反哺策略，避免把 skill、MCP/tool、checker 预留字段误导成可立即生效的配置。
4. 将默认策略职责集中到 project/service 层，存储层只负责状态、策略和使用记录的持久化，避免业务默认值隐藏在 store。
5. 保持显式策略优先：如果审批前已有 prompt 策略，审批动作不覆盖用户或系统已设置的约束。
6. 用自动化测试覆盖 service 层审批默认策略、显式策略保留、prompt 注入计数、UI 真实生效说明和策略保存入口。
7. 在 feature 文档中给出 skill、MCP/tool、checker 作为后续静态载体真正生效所需的落地条件和拆分方向。

## 非目标

1. 不实现自动生成知识候选或自动审批；人工审批仍是治理边界。
2. 不把 `skill_visibility`、`tool_visibility`、`checker_binding` 做成知识中心可配置项，因为当前没有对应真实生效封装。
3. 不把“字段保存成功”当作 skill、MCP/tool 或 checker 已经生效。
4. 不对历史 active 且无策略知识做批量迁移；历史数据可能包含刻意只作为人工知识库存在的记录，批量补策略需要单独迁移设计。
5. 不在本 feature 中实现完整 skill 生成、MCP/tool 注册或 checker 生成调度；这些都需要独立的静态产物、验证和 review 流程。

## 设计

### 生效定义

本 feature 采用可验证的生效定义：

1. 动态运行时生效：知识在 agent 调用前被系统查询、匹配、注入或执行，并写入 `knowledge_use`。
2. 静态产物生效：知识被转化为仓库中的长期产物，例如 `.meta/skills`、`.meta/prompts`、checker 规则、MCP/tool 配置或 `AGENTS.md` 规则，并通过代码 review、commit、测试和后续运行时读取形成闭环。
3. 人工引用生效：用户或 agent 明确引用某条知识，并通过 `knowledge_use` 记录 `manual_reference` 或后续对应 use type。

只改变 `knowledge_item.status` 为 active 不等于生效；active 只代表通过审批，具备进入生效路径的资格。

### 当前真实运行时路径：prompt

当前唯一已有运行时封装的是 prompt 注入。批准知识时，如果尚无 `knowledge_usage_policy`，`ProjectManager` 创建默认 prompt 策略：

1. `allow_prompt_injection = true`。
2. `prompt_mode` 沿用现有知识类型默认规则。
3. `stage_types = []`、`snail_names = []`，表示不额外收窄。
4. `priority` 根据作用域或知识类型给出稳定默认值。

后续构建系统提示词时，`listPromptInjectableKnowledge` 继续按状态、作用域、stage、snail、prompt 开关和 prompt mode 匹配知识；命中后把知识渲染到“知识上下文”，并写入 `knowledge_use(use_type = prompt_injection)`。因此使用次数增长代表真实进入过运行时上下文，而不是批准次数。

### 知识中心交互

知识中心应清晰展示两层状态：

1. 审批状态：candidate、active、deprecated 等。
2. 真实反哺状态：当前是否启用系统提示词注入、prompt mode、stage/snail 约束、优先级、使用次数。

知识中心允许编辑当前真实生效的 prompt 策略：

1. 系统提示词注入开关。
2. Prompt mode：`none`、`summary`、`full`、`reference_only`。
3. Stage 约束。
4. Snail 约束。
5. 优先级。

知识中心不得展示 skill、MCP/tool、checker 为“可配置反哺方式”。这些方向只能在说明中作为“需要后续静态产物落地”的路径出现。

### 后续静态载体方案

Skill、MCP/tool、checker 不应通过当前 `knowledge_usage_policy` 字段伪装成已生效。真正落地至少需要：

1. Skill：把知识转化为 `.meta/skills/<name>/SKILL.md` 和必要脚本，更新 skill registry 可读取路径，提交代码并测试；使用时由 agent 显式加载或 prompt 引用 skill reference，并记录 `knowledge_use(use_type = skill)`。
2. MCP/tool：把知识转化为 MCP server/tool 配置、工具说明或运行环境配置，经过验证后由 runtime 暴露给 agent；调用时记录 `knowledge_use(use_type = tool)`。
3. Checker：把知识转化为 checker 规则、脚本或测试，纳入 `npm run check`、CI 或阶段推进校验；执行命中时记录 `knowledge_use(use_type = checker)`。

这些都是独立 feature 的范围。它们可以复用知识本体、来源和使用记录模型，但不能只靠保存 `skill_visibility`、`tool_visibility` 或 `checker_binding` 字段宣称生效。

## 生效路径

1. `src/project/manager.ts` 在审批无策略知识时创建默认 prompt 反哺策略，作为业务默认值入口。
2. `src/persistence/knowledge-model.ts` 负责知识、prompt 策略和使用记录的持久化，以及 prompt 注入匹配查询；存储层不隐藏业务默认策略。
3. `src/project/manager.ts` 构建系统提示词时继续调用 `listPromptInjectableKnowledge`。
4. `src/snails/prompt-builder.ts` 继续把匹配 prompt 知识渲染到“知识上下文”。
5. `src/web/knowledge-center.js` 展示和编辑真实 prompt 反哺策略，并解释使用次数含义。
6. `tests/project/stage-cycle-test.ts` 覆盖 service 层审批默认策略和显式策略保留。
7. `tests/persistence/persistence-test.ts` 覆盖存储层职责、prompt 策略匹配和使用计数。
8. `tests/web/knowledge-center-test.ts` 覆盖知识中心只暴露真实 prompt 生效配置，不暴露伪 skill/MCP/checker 配置。

## 改动范围

1. 更新 `docs/features/20260507/F2026050705-knowledge-activation-usage.md`，用真实生效定义替代“多载体配置”伪模型，并符合 feature 文档日期目录与当日编号规则。
2. 调整 `src/project/manager.ts` 和 `src/persistence/knowledge-model.ts` 的审批默认策略职责边界。
3. 更新 `src/web/knowledge-center.js`，只保留当前真实 prompt 反哺策略的展示和编辑。
4. 更新 `src/web/styles.css` 的策略表单布局。
5. 更新 `tests/persistence/persistence-test.ts`、`tests/project/stage-cycle-test.ts` 和 `tests/web/knowledge-center-test.ts`。

## 验证

1. 运行 `npm run check`。
2. 验证批准无策略候选知识后会在 service 层获得默认 prompt 反哺策略。
3. 验证已有显式 prompt 策略的知识在审批后不被覆盖。
4. 验证知识中心可以展示并保存 prompt 开关、prompt mode、stage/snail 约束和 priority。
5. 验证知识中心不再展示 skill、MCP/tool、checker 为可配置生效方式。
6. 验证匹配 prompt 注入后 `use_count` 增长，禁用 prompt 后不会继续注入。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本 feature 只把当前已有封装的 prompt 注入作为自动运行时生效路径。Skill、MCP/tool、checker 必须通过静态产物或运行时注册机制单独落地，不能只在知识策略表里保存字段后宣称生效。

决策记录：本 feature 不对历史已批准但无策略的知识做批量迁移。原因是历史数据可能包含刻意只作为人工知识库存在的 active 知识，直接补策略会改变既有行为；如果用户确认需要“历史 active 知识一键纳入反哺”，应单独设计迁移和回滚策略。

## 范围变更记录

1. 用户补充指出知识反哺载体包括系统提示词、skill、MCP/tool、checker 等，本 feature 因此必须从真实系统能力出发分析生效路径，而不是只修计数显示。
2. 实现梳理确认当前真实运行时自动生效路径只有 prompt 注入；上一轮把 skill、MCP/tool、checker 做成可配置 UI 但没有运行时或静态产物落地，属于错误设计，本次修正为只暴露真实 prompt 配置，并在文档中记录其他载体的真实落地条件。
3. 实现梳理发现当前分支存在存储层和 project/service 层重复补默认策略的问题，因此新增职责归位目标：默认策略保留在 project/service 层，存储层只做持久化。
4. PR 检视发现 feature 文档新增在 `docs/features/` 根目录，违反 `docs/README.md` 的 `docs/features/YYYYMMDD/` 日期目录规则，因此移动到 `docs/features/20260507/` 并同步路径引用。
5. 合入最新 `origin/main` 后发现同日已存在 `F2026050703-startup-orphan-streaming-recovery.md` 和 `F2026050704-avoid-current-feature-knowledge.md`，因此本 feature 文档编号调整为当天下一个可用编号 `F2026050705`，避免破坏 `docs/README.md` 的编号唯一性和日期目录扫描规则。
