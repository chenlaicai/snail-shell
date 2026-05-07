# F2026050703 知识生效与使用统计闭环

## 背景

用户反馈已批准过一条知识，但知识中心显示使用次数仍为 0，因此怀疑“知识生效、反哺、再沉淀”的飞轮流程没有成立。

当前存储和 prompt 构建链路已经具备以下能力：已审批知识可按范围、阶段和 snail 匹配注入系统提示词；注入命中时会写入 `knowledge_use`，知识中心通过 `use_count` 展示使用次数。问题在于审批动作只把候选知识置为 `active`，不会自动创建可注入的反哺策略；如果用户只点击“批准”，这条知识虽然处于已生效状态，但不会进入 prompt 注入候选集，使用次数自然保持为 0。

## 目标

1. 让“批准知识”默认进入 prompt 反哺路径，形成用户可感知的生效闭环。
2. 保持人工审批仍是候选知识进入 active 的治理边界。
3. 保持显式反哺策略优先：如果知识在审批前或审批时已有策略，不被默认策略覆盖。
4. 让使用次数在后续匹配注入时自动增长，并用测试覆盖这一链路。
5. 在知识中心展示中解释“使用次数”统计的是实际反哺记录，而不是单纯批准次数。

## 非目标

1. 不实现自动生成知识候选或自动审批。
2. 不改变 `knowledge_use` 的含义；使用次数仍代表实际被引用、注入或手动记录的次数。
3. 不引入新的复杂策略配置界面；本 feature 只修复默认生效路径和说明。
4. 不重算历史使用次数；既有 active 但无策略的知识是否批量补策略需后续单独迁移设计。

## 设计

审批流程在把候选知识转为 `active` 后，如果该知识尚无 `knowledge_usage_policy`，自动写入默认策略：允许 prompt 注入，`prompt_mode` 为 `summary`，阶段和 snail 不额外收窄，优先级为 0。

显式策略仍然优先。若审批前已有策略，审批流程只更新知识状态，不覆盖调用方已有的 `allow_prompt_injection`、`prompt_mode`、阶段约束、角色约束或优先级。这保证用户或后续治理能力可以在审批前配置“仅手动引用”“禁用注入”或更窄范围，而不会被批准动作重置。

默认策略选择 `summary` 而不是 `full`，原因是批准知识应该默认可反哺，但系统提示词预算仍需要可控；`summary` 复用现有 prompt 构建中的截断逻辑，既能让知识生效，也避免长内容无约束扩张。

知识中心继续展示 `use_count`，并补充说明它统计实际反哺/引用记录。批准本身不会增加计数，只有后续 prompt 匹配注入或手动记录使用才会增长。

## 生效路径

1. `src/persistence/knowledge-model.ts` 在审批事务中为无策略知识创建默认反哺策略。
2. `src/project/manager.ts` 构建系统提示词时继续调用 `listPromptInjectableKnowledge` 获取匹配知识。
3. `src/persistence/knowledge-model.ts` 的 prompt 注入查询命中后继续写入 `knowledge_use`。
4. `src/snails/prompt-builder.ts` 继续把匹配知识渲染到“知识上下文”。
5. `src/web/knowledge-center.js` 展示默认反哺策略和使用次数说明。
6. `tests/persistence/persistence-test.ts` 覆盖批准默认策略、显式策略不覆盖、注入后使用次数增长。

## 改动范围

1. 新增 `docs/features/F2026050703-knowledge-activation-usage.md`。
2. 更新 `src/persistence/knowledge-model.ts` 的审批默认策略逻辑和注释。
3. 更新 `src/web/knowledge-center.js` 的反哺策略展示说明。
4. 更新 `tests/persistence/persistence-test.ts` 的知识审批和注入统计测试。

## 验证

1. 运行 `npm run check`。
2. 确认批准无策略候选知识后会自动获得 summary prompt 反哺策略。
3. 确认已有显式策略的知识在审批后策略不被覆盖。
4. 确认匹配 prompt 注入后 `use_count` 增长，且禁用 prompt mode 后不会继续注入。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本 feature 不对历史已批准但无策略的知识做批量迁移。原因是历史数据可能包含刻意只作为人工库存在的 active 知识，直接补策略会改变既有行为；如果用户确认需要“历史 active 知识一键纳入反哺”，应单独设计迁移和回滚策略。

## 范围变更记录

当前没有范围变更。
