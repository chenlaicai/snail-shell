---
id: F2026051102
title: 系统提示词文档编写规范
from_ids: []
tags: [prompt, ui, convention]
modules: [project_management]
---
# F2026051102 系统提示词文档编写规范

## 背景

用户指出，前几轮系统提示词改造后，部分提示词文档仍呈现为大量并列长句。例如 `P0004-AI判断与责任契约.md` 虽然表达的原则重要，但正文更像原则堆叠，而不是便于模型执行和后续维护的结构化契约。

经讨论，本问题不应只作为 P0004 的单点改写处理，而应上升为所有系统提示词文档的编写规范：先建立长期写作规范，再逐步改造具体提示词文档。

## 目标

1. 在现有系统提示词结构设计文档中补充编写规范，定义 `.meta/prompts/` 正文应如何组织、表达和自检。
2. 将结构归属和正文写法集中到一个 core 文档，避免查规范时漏看或多文档漂移。
3. 在提示词治理相关入口补充对该规范的引用，确保后续调整提示词前先按规范组织内容。
4. 按新增编写规范改写全部现有 `.meta/prompts/` 系统提示词正文，优先消除长句堆叠、事实与行为混杂、输出契约不清和章节边界不明确的问题。

## 非目标

1. 不改变提示词的语义强度、运行时 target、id 编号或装配顺序。
2. 不修改 prompt registry、prompt builder 或 Prompt Center 运行代码。
3. 不二次修改已合入 feature 文档。

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

全量提示词改写原则：

1. `P0004-AI判断与责任契约.md` 保持 AI base 归属不变，将原本大量并列长句拆成目标、适用边界、行动规则和禁止项，减少模型执行时需要自行归纳的隐含结构。
2. `P0201-Mention提取任务.md` 和 `P0202-Conversation摘要任务.md` 保持 task runtime 归属不变，只整理任务目标、判断规则和输出契约，不引入项目推进、PR 或角色行动规则。
3. `AGENTS.md` 中与 P0004 同源的长期规则同步改写为同等语义，避免双线生效期间出现表达漂移。
4. `P0001` 到 `P0003` 保持 AI base 归属不变，按用户决策边界、结构化消息边界、能力引用边界、知识候选触发、transcript 可信边界等主题拆分正文。
5. `P010101` 到 `P010107` 保持 work context 归属不变，把运行时事实、上下文归属边界、历史查询示例和使用边界分开，避免事实模板与行动规则混写。
6. `P010201` 到 `P010204` 保持 stage role playbook 归属不变，把身份、边界、行动规则、检视规则、复检规则、代码仓追溯和输出要求拆开。
7. `P0201` 和 `P0202` 保持 task runtime 归属不变，按任务目标、判断规则、禁止项和输出要求组织正文。

## 生效路径

本 feature 通过以下长期入口生效：

1. `docs/core/prompt-system-structure.md`：定义系统提示词结构归属和文档正文写作规范。
2. `.meta/README.md`：提示 `.meta/prompts/` 文件正文应遵循 core 规范。
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`：让研发迭代阶段的提示词梳理工作引用该规范。
4. `AGENTS.md`：保持双线规则一致。
5. `.meta/prompts/base/`：将全部 AI base prompt 改写为更适合运行时执行的结构化契约。
6. `.meta/prompts/scenarios/project-conversation/work-context/`：将全部项目推进上下文 prompt 改写为事实、归属边界和使用边界清晰分离的结构。
7. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/`：将全部阶段角色手册改写为身份、边界、行动规则、验证和输出要求清晰分离的结构。
8. `.meta/prompts/scenarios/task-runtime/`：将全部后台任务 prompt 改写为目标、判断规则、禁止项和输出契约明确的结构。

## 改动范围

新增：

1. `docs/features/20260511/F2026051102-system-prompt-writing-guidelines.md`

修改：

1. `docs/core/prompt-system-structure.md`
2. `.meta/README.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
4. `AGENTS.md`
5. `.meta/prompts/base/P0004-AI判断与责任契约.md`
6. `.meta/prompts/scenarios/task-runtime/P0201-Mention提取任务.md`
7. `.meta/prompts/scenarios/task-runtime/P0202-Conversation摘要任务.md`
8. `.meta/prompts/base/P0001-AI基础契约.md`
9. `.meta/prompts/base/P0002-知识候选入口.md`
10. `.meta/prompts/base/P0003-Claude转录边界.md`
11. `.meta/prompts/scenarios/project-conversation/work-context/P010101-项目推进入口.md`
12. `.meta/prompts/scenarios/project-conversation/work-context/P010102-项目范围.md`
13. `.meta/prompts/scenarios/project-conversation/work-context/P010103-Feature范围.md`
14. `.meta/prompts/scenarios/project-conversation/work-context/P010104-Stage范围.md`
15. `.meta/prompts/scenarios/project-conversation/work-context/P010105-参与者范围.md`
16. `.meta/prompts/scenarios/project-conversation/work-context/P010106-Conversation范围.md`
17. `.meta/prompts/scenarios/project-conversation/work-context/P010107-历史能力入口.md`
18. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010202-研发检视处理.md`
19. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010203-验收检视手册.md`
20. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010204-代码仓工作基线.md`

## 验证

已执行：

1. 已检查新增规范章节只定义系统提示词正文写法，不改变现有 prompt target、id 或运行时装配。
2. 已检查 `docs/core/prompt-system-structure.md` 同时承载结构归属和正文写法，且两个章节职责清晰。
3. 已检查 `AGENTS.md` 与 `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md` 的提示词治理规则保持一致。
4. 已执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。
5. 合并规范文档后已再次执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。
6. 扩展改写首批提示词后已执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。
7. 已更新 `tests/meta/prompt-assets-test.ts`，使 prompt asset 测试覆盖结构化改写后的 P0004、mention 提取任务和 conversation 摘要任务关键语义。
8. 根据用户要求继续扩展为全量 `.meta/prompts/` 正文规范化后，已执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。

## 风险与决策记录

1. 决策：先建立编写规范，再在同一 PR 中改写首批既有提示词。原因是用户明确选择扩展当前 PR 范围，要求本轮直接修改已有提示词并再次请求检视。
2. 决策：规范进入 `docs/core/prompt-system-structure.md`，而不是 `.meta/prompts/`。原因是该规范指导提示词文档编写，本身不是需要注入给运行时 AI 执行的提示词正文。
3. 决策：不保留独立的 `system-prompt-writing-guidelines.md`。原因是用户明确希望系统提示词规范集中在一个文档中，便于一次性定位，避免查规范时漏看个别文档。
4. 决策：`.meta/README.md` 只引用规范，不复制完整写法要求。原因是 README 负责说明文件格式和边界，完整写作规范应由 core 文档维护，避免双处漂移。
5. 决策：根据用户明确选择，将范围从“首批提示词改写”扩展为“全量现有 `.meta/prompts/` 正文规范化”。本轮只调整正文组织方式，不改变 metadata、target、id、when 条件或运行时代码，降低语义回归风险。
6. 风险：全量正文重组可能改变模型读取时的注意力分布；通过保留原有关键语义、扩展 prompt asset 测试和执行完整检查来降低风险。

## 范围变更记录

1. 根据用户补充，将目标从“改写 P0004”调整为“先建立系统提示词文档编写规范，再改造具体提示词文档”。
2. 根据用户反馈，将独立的 `docs/core/system-prompt-writing-guidelines.md` 合并回 `docs/core/prompt-system-structure.md`，保留一个系统提示词规范文档作为统一入口。
3. 根据用户在 review 收口后的明确选择，将当前 Feature 重新打开 development，并把 PR #150 范围扩展为“建立编写规范 + 改写首批既有提示词”。
4. 根据用户继续选择，将当前 PR #150 范围再次扩展为“建立编写规范 + 全量改写现有 `.meta/prompts/` 正文”。
