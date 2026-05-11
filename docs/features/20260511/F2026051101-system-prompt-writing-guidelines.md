# F2026051101 系统提示词文档编写规范

## 背景

用户指出，前几轮系统提示词改造后，部分提示词文档仍呈现为大量并列长句。例如 `P0004-AI判断与责任契约.md` 虽然表达的原则重要，但正文更像原则堆叠，而不是便于模型执行和后续维护的结构化契约。

经讨论，本问题不应只作为 P0004 的单点改写处理，而应上升为所有系统提示词文档的编写规范：先建立长期写作规范，再逐步改造具体提示词文档。

## 目标

1. 在现有系统提示词结构设计文档中补充编写规范，定义 `.meta/prompts/` 正文应如何组织、表达和自检。
2. 将结构归属和正文写法集中到一个 core 文档，避免查规范时漏看或多文档漂移。
3. 在提示词治理相关入口补充对该规范的引用，确保后续调整提示词前先按规范组织内容。
4. 按新增编写规范改写首批既有系统提示词，优先处理 `P0004-AI判断与责任契约.md` 的长句堆叠问题，并同步整理小型 task runtime prompt 的输出契约表达。

## 非目标

1. 不批量重构所有现有 `.meta/prompts/` 文件；本轮只处理已确认问题明显、可在当前上下文完整验证的首批提示词。
2. 不改变提示词的语义强度、运行时 target、id 编号或装配顺序。
3. 不修改 prompt registry、prompt builder 或 Prompt Center 运行代码。
4. 不二次修改已合入 feature 文档。

## 设计

在 `docs/core/prompt-system-structure.md` 中新增“文档编写规范”章节，覆盖以下内容：

1. 系统提示词文档的编写目标：服务运行时执行效果，而不是复制设计文档或讨论记录。
2. 推荐正文结构：目标、适用边界、行动规则、禁止项、输出要求。
3. 表达方式：使用可执行规则，控制句子长度，合并重复语义，区分规则和说明。
4. 规则类型：不变量、触发式流程、禁止项、输出契约。
5. 文件粒度：何时拆分、何时合并。
6. 与长期文档、`.meta/README.md`、feature 文档的边界。
7. 新增或调整系统提示词文档前的检查清单。

同步调整长期入口：

1. `docs/core/prompt-system-structure.md`：同时承载提示词结构归属和文档编写规范。
2. `.meta/README.md`：将原有简短“prompt 写法建议”替换为对 core 规范章节的引用和最小边界说明。
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`：在梳理或调整提示词前，要求对照结构文档中的归属规则和编写规范。
4. `AGENTS.md`：在双线生效期间同步同等提示词治理要求。

首批提示词改写原则：

1. `P0004-AI判断与责任契约.md` 保持 AI base 归属不变，将原本大量并列长句拆成目标、适用边界、行动规则和禁止项，减少模型执行时需要自行归纳的隐含结构。
2. `P0201-Mention提取任务.md` 和 `P0202-Conversation摘要任务.md` 保持 task runtime 归属不变，只整理任务目标、判断规则和输出契约，不引入项目推进、PR 或角色行动规则。
3. `AGENTS.md` 中与 P0004 同源的长期规则同步改写为同等语义，避免双线生效期间出现表达漂移。

## 生效路径

本 feature 通过以下长期入口生效：

1. `docs/core/prompt-system-structure.md`：定义系统提示词结构归属和文档正文写作规范。
2. `.meta/README.md`：提示 `.meta/prompts/` 文件正文应遵循 core 规范。
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`：让研发迭代阶段的提示词梳理工作引用该规范。
4. `AGENTS.md`：保持双线规则一致。
5. `.meta/prompts/base/P0004-AI判断与责任契约.md`：将 AI 判断责任规则改写为更适合运行时执行的结构化契约。
6. `.meta/prompts/scenarios/task-runtime/P0201-Mention提取任务.md`：将 mention 提取任务改写为目标、判断规则和输出契约。
7. `.meta/prompts/scenarios/task-runtime/P0202-Conversation摘要任务.md`：将摘要任务改写为目标、内容选择和输出契约。

## 改动范围

新增：

1. `docs/features/20260511/F2026051101-system-prompt-writing-guidelines.md`

修改：

1. `docs/core/prompt-system-structure.md`
2. `.meta/README.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
4. `AGENTS.md`
5. `.meta/prompts/base/P0004-AI判断与责任契约.md`
6. `.meta/prompts/scenarios/task-runtime/P0201-Mention提取任务.md`
7. `.meta/prompts/scenarios/task-runtime/P0202-Conversation摘要任务.md`

## 验证

已执行：

1. 已检查新增规范章节只定义系统提示词正文写法，不改变现有 prompt target、id 或运行时装配。
2. 已检查 `docs/core/prompt-system-structure.md` 同时承载结构归属和正文写法，且两个章节职责清晰。
3. 已检查 `AGENTS.md` 与 `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md` 的提示词治理规则保持一致。
4. 已执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。
5. 合并规范文档后已再次执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。
6. 扩展改写首批提示词后已执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。
7. 已更新 `tests/meta/prompt-assets-test.ts`，使 prompt asset 测试覆盖结构化改写后的 P0004、mention 提取任务和 conversation 摘要任务关键语义。

## 风险与决策记录

1. 决策：先建立编写规范，再在同一 PR 中改写首批既有提示词。原因是用户明确选择扩展当前 PR 范围，要求本轮直接修改已有提示词并再次请求检视。
2. 决策：规范进入 `docs/core/prompt-system-structure.md`，而不是 `.meta/prompts/`。原因是该规范指导提示词文档编写，本身不是需要注入给运行时 AI 执行的提示词正文。
3. 决策：不保留独立的 `system-prompt-writing-guidelines.md`。原因是用户明确希望系统提示词规范集中在一个文档中，便于一次性定位，避免查规范时漏看个别文档。
4. 决策：`.meta/README.md` 只引用规范，不复制完整写法要求。原因是 README 负责说明文件格式和边界，完整写作规范应由 core 文档维护，避免双处漂移。
5. 风险：本轮只完成首批提示词改写，仍可能存在其他提示词后续可继续按规范优化；该风险不影响本轮改写范围的独立交付。

## 范围变更记录

1. 根据用户补充，将目标从“改写 P0004”调整为“先建立系统提示词文档编写规范，再改造具体提示词文档”。
2. 根据用户反馈，将独立的 `docs/core/system-prompt-writing-guidelines.md` 合并回 `docs/core/prompt-system-structure.md`，保留一个系统提示词规范文档作为统一入口。
3. 根据用户在 review 收口后的明确选择，将当前 Feature 重新打开 development，并把 PR #150 范围扩展为“建立编写规范 + 改写首批既有提示词”。
