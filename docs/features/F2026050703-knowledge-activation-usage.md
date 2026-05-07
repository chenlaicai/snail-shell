# F2026050703 知识反哺载体与策略闭环

## 背景

用户反馈已批准过一条知识，但知识中心显示使用次数仍为 0，因此怀疑“知识生效、反哺、再沉淀”的飞轮流程没有成立。进一步沟通后确认，问题不能只按“批准后默认 prompt 注入”做小修：知识沉淀后的反哺载体应该是多种形态，至少包括系统提示词、skill、MCP/tool、checker 等；知识中心也应该让用户能看见并配置这些生效方式。

当前代码已有部分基础设施：`knowledge_item` 记录知识本体和审批状态，`knowledge_usage_policy` 记录 prompt、skill、tool、checker 相关策略字段，`knowledge_use` 记录实际使用历史，系统提示词构建会查询匹配知识并记录 `prompt_injection` 使用。但完整链路尚未成立：

1. 审批 UI 只提供批准、拒绝、废弃动作，没有策略配置入口。
2. “已生效”在 UI 上容易被理解为“已经反哺到后续 agent”，但实际还取决于 `knowledge_usage_policy`。
3. 真实自动生效载体只有系统提示词注入；`skill_visibility`、`tool_visibility`、`checker_binding` 等字段目前只是预留，没有 UI 配置、匹配查询和运行时挂载。
4. 使用次数统计的是 `knowledge_use` 记录，不是批准次数；当知识未进入任何反哺载体时，使用次数保持 0 是符合当前实现但不符合用户预期。
5. 当前分支早期小修把默认策略放进了存储层审批事务，同时 `ProjectManager.approveKnowledge` 已有默认策略补齐逻辑，职责边界出现重复，需要重新归位。

## 目标

1. 明确知识闭环模型：候选知识经人工审批成为 active，active 知识通过可配置生效方式反哺到系统提示词、skill、MCP/tool 或 checker 等载体，实际命中后写入使用记录。
2. 在知识中心补齐反哺策略可视化与编辑能力，让用户能看到并调整 prompt、skill、MCP/tool、checker 的生效方式，而不是只能审批。
3. 让批准动作具备合理默认策略：无显式策略时创建默认反哺策略；已有显式策略时不覆盖。
4. 将默认策略职责集中到 project/service 层，存储层只负责原子持久化和策略 upsert，避免审批模型隐藏业务默认值。
5. 保证系统提示词注入的现有真实生效路径继续可用，并在命中时继续记录 `prompt_injection` 使用次数。
6. 为 skill、MCP/tool、checker 提供可配置和可追踪的策略表达；若本 feature 不完成运行时自动挂载，必须在 UI 和文档中明确标记为“已配置、待接入运行时”，避免误导为已经真实生效。
7. 用自动化测试覆盖审批默认策略、显式策略保留、策略编辑 API、prompt 注入计数、非 prompt 载体策略持久化和 UI 展示。

## 非目标

1. 不实现自动生成知识候选或自动审批；人工审批仍是治理边界。
2. 不改变 `knowledge_use` 的含义；使用次数仍代表实际被某个载体引用、注入、执行或手动记录的次数。
3. 不把 skill、MCP/tool、checker 的预留字段伪装成已运行时生效；未接入运行时的载体只能作为策略配置和后续接入入口展示。
4. 不对历史 active 且无策略知识做批量迁移；历史数据可能包含刻意只作为人工知识库存在的记录，批量补策略需要单独迁移设计。
5. 不设计完整的知识质量评估、自动召回排序或 token 预算分配算法；本 feature 聚焦反哺载体、策略可见性和统计闭环。

## 设计

### 知识状态与反哺策略

`knowledge_item.status = active` 只表示知识通过人工审批，具备进入反哺系统的资格；具体通过哪些载体生效由 `knowledge_usage_policy` 决定。UI 需要区分“审批状态”和“反哺方式”，避免把“已生效”误读为“已在所有后续上下文中使用”。

批准知识时，如果尚无 `knowledge_usage_policy`，project/service 层创建默认策略：

1. `allow_prompt_injection = true`。
2. `prompt_mode = summary`。
3. `stage_types = []`、`snail_names = []`，表示不额外收窄。
4. `skill_visibility = []`、`tool_visibility = []`、`checker_binding = null`，表示这些载体默认不启用。
5. `priority` 根据作用域或知识类型给出稳定默认值，沿用现有 `ProjectManager.defaultKnowledgeUsagePolicy` 的意图。

如果审批前已经存在策略，审批动作不覆盖策略。这样用户可以先设定“只手动引用”“禁用 prompt”“只对某些 snail 生效”或后续更细策略，审批只改变治理状态。

### 多载体语义

本 feature 将 `knowledge_usage_policy` 的字段解释为统一的反哺载体策略：

1. 系统提示词：由 `allow_prompt_injection` 和 `prompt_mode` 控制，当前已有真实运行时生效路径。
2. Skill：由 `skill_visibility` 表示哪些 skill 可以看到或引用该知识；本 feature 先提供配置和展示，若未接入 skill registry 运行时检索，则标记为“待运行时接入”。
3. MCP/tool：当前表结构字段名为 `tool_visibility`，作为 MCP/tool 载体的可见范围表达；本 feature 先提供配置和展示，后续 tool runtime 可按该字段检索。
4. Checker：由 `checker_binding` 表示绑定到哪个 checker 或检查规则；本 feature 先提供配置和展示，后续 checker 执行时可记录 `checker` 类型使用。

### 知识中心交互

知识详情页需要展示：

1. 审批状态、治理级别、作用域和来源。
2. 反哺策略总览：prompt 状态、prompt 模式、skill 可见性、MCP/tool 可见性、checker 绑定、stage/snail 约束、优先级和 token 预算。
3. 使用统计说明：使用次数来自 `knowledge_use`，批准本身不增加计数；当前真实自动计数的载体是 prompt 注入，手动记录和后续 skill/tool/checker 运行时也应写入对应 use type。
4. 策略编辑表单：允许保存 prompt 开关、prompt 模式、stage/snail 约束、skill/tool 列表、checker 绑定、优先级和 token 预算。

策略编辑使用现有 `PUT /knowledge/:knowledgeId/usage-policy` API。前端需要把逗号或换行分隔的列表规范化为数组，保存后重新加载详情并提示成功。

### 使用记录

`knowledge_use.use_type` 保持现有枚举：`prompt_injection`、`manual_reference`、`search_result`、`skill`、`tool`、`checker`。本 feature 确认并测试：

1. prompt 注入命中会写入 `prompt_injection`。
2. API 仍可手动记录其他 use type，便于后续 skill/tool/checker runtime 接入时复用。
3. UI 展示使用次数时说明它是实际使用记录总数，而不是策略配置数量或审批次数。

## 生效路径

1. `src/project/manager.ts` 在审批无策略知识时创建默认反哺策略，作为业务默认值入口。
2. `src/persistence/knowledge-model.ts` 继续负责知识、策略和使用记录的持久化，以及 prompt 注入匹配查询；移除存储层重复默认策略职责。
3. `src/api/knowledge-routes.ts` 继续提供策略读取和更新 API，并补齐策略字段解析的测试覆盖。
4. `src/web/knowledge-center.js` 提供反哺策略展示、编辑、保存和使用次数说明。
5. `src/snails/prompt-builder.ts` 继续把匹配 prompt 知识渲染到“知识上下文”。
6. `tests/persistence/persistence-test.ts` 覆盖审批默认策略、显式策略保留、prompt 注入计数和多载体策略持久化。
7. Web 相关测试覆盖知识中心展示和策略编辑表单的关键文本与行为。

## 改动范围

1. 更新 `docs/features/F2026050703-knowledge-activation-usage.md`，记录扩大后的目标、非目标、设计和范围变化。
2. 调整 `src/project/manager.ts` 和 `src/persistence/knowledge-model.ts` 的审批默认策略职责边界。
3. 更新 `src/web/knowledge-center.js`，补齐策略展示和编辑。
4. 必要时更新 API 解析或类型定义，使 UI 能完整保存多载体策略。
5. 更新 `tests/persistence/persistence-test.ts`。
6. 新增或更新 web 测试，覆盖知识中心策略 UI。

## 验证

1. 运行 `npm run check`。
2. 验证批准无策略候选知识后会自动获得默认 prompt 反哺策略。
3. 验证已有显式策略的知识在审批后不被覆盖。
4. 验证知识中心可以展示并保存 prompt、skill、MCP/tool、checker、stage/snail、priority、token budget 策略字段。
5. 验证匹配 prompt 注入后 `use_count` 增长，禁用 prompt 后不会继续注入。
6. 验证非 prompt 载体策略可保存但不会被 UI 描述为已运行时自动生效。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本 feature 接受“多载体策略先可见可配，运行时逐步接入”的阶段性设计，但必须在 UI 和文档中区分真实已接入的 prompt 注入与尚待运行时接入的 skill/MCP/tool/checker。原因是一次性实现所有载体运行时接入会跨越 prompt 构建、skill registry、工具运行、checker 调度等多个系统边界；若为了扩范围而伪造生效，会继续破坏用户对知识飞轮的信任。

决策记录：本 feature 不对历史已批准但无策略的知识做批量迁移。原因是历史数据可能包含刻意只作为人工知识库存在的 active 知识，直接补策略会改变既有行为；如果用户确认需要“历史 active 知识一键纳入反哺”，应单独设计迁移和回滚策略。

## 范围变更记录

1. 用户补充指出知识反哺载体不应只限于系统提示词，还应包括 skill、MCP/tool、checker 等方式，因此本 feature 从“批准后默认 prompt 策略和使用统计说明”扩大为“知识反哺载体与策略闭环”。
2. 实现梳理发现当前分支存在存储层和 project/service 层重复补默认策略的问题，因此新增职责归位目标：默认策略保留在 project/service 层，存储层只做持久化。
