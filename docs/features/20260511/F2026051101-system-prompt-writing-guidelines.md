# F2026051101 系统提示词文档编写规范

## 背景

用户指出，前几轮系统提示词改造后，部分提示词文档仍呈现为大量并列长句。例如 `P0004-AI判断与责任契约.md` 虽然表达的原则重要，但正文更像原则堆叠，而不是便于模型执行和后续维护的结构化契约。

经讨论，本问题不应只作为 P0004 的单点改写处理，而应上升为所有系统提示词文档的编写规范：先建立长期写作规范，再逐步改造具体提示词文档。

## 目标

1. 新增系统提示词文档编写规范，定义 `.meta/prompts/` 正文应如何组织、表达和自检。
2. 明确该规范与 `docs/core/prompt-system-structure.md` 的分工：结构文档决定规则归属，编写规范决定规则表达方式。
3. 在提示词治理相关入口补充对新规范的引用，确保后续调整提示词前先按规范组织内容。
4. 本轮不直接重写 P0004 或其他具体系统提示词，避免在规范尚未单独落地时混入大范围内容重构。

## 非目标

1. 不改写 `.meta/prompts/base/P0004-AI判断与责任契约.md` 正文。
2. 不批量重构现有 `.meta/prompts/` 文件。
3. 不修改 prompt registry、prompt builder 或 Prompt Center 运行代码。
4. 不改变现有 prompt target、id 编号规则或运行时装配顺序。
5. 不二次修改已合入 feature 文档。

## 设计

新增 `docs/core/system-prompt-writing-guidelines.md`，作为长期 core 规范，覆盖以下内容：

1. 系统提示词文档的编写目标：服务运行时执行效果，而不是复制设计文档或讨论记录。
2. 推荐正文结构：目标、适用边界、行动规则、禁止项、输出要求。
3. 表达方式：使用可执行规则，控制句子长度，合并重复语义，区分规则和说明。
4. 规则类型：不变量、触发式流程、禁止项、输出契约。
5. 文件粒度：何时拆分、何时合并。
6. 与长期文档、`.meta/README.md`、feature 文档的边界。
7. 新增或调整系统提示词文档前的检查清单。

同步调整长期入口：

1. `docs/core/prompt-system-structure.md`：补充与编写规范的关系，说明其负责归属，编写规范负责表达。
2. `.meta/README.md`：将原有简短“prompt 写法建议”替换为对 core 编写规范的引用和最小边界说明。
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`：在梳理或调整提示词前，要求同时对照结构文档和编写规范。
4. `AGENTS.md`：在双线生效期间同步同等提示词治理要求。

## 生效路径

本 feature 通过以下长期入口生效：

1. `docs/core/system-prompt-writing-guidelines.md`：定义系统提示词文档正文写作规范。
2. `docs/core/prompt-system-structure.md`：补充结构归属与编写规范的关系。
3. `.meta/README.md`：提示 `.meta/prompts/` 文件正文应遵循 core 编写规范。
4. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`：让研发迭代阶段的提示词梳理工作引用该规范。
5. `AGENTS.md`：保持双线规则一致。

## 改动范围

新增：

1. `docs/core/system-prompt-writing-guidelines.md`
2. `docs/features/20260511/F2026051101-system-prompt-writing-guidelines.md`

修改：

1. `docs/core/prompt-system-structure.md`
2. `.meta/README.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
4. `AGENTS.md`

## 验证

已执行：

1. 已检查新增规范只定义系统提示词正文写法，不改变现有 prompt target、id 或运行时装配。
2. 已检查 `docs/core/prompt-system-structure.md` 与新规范职责分离：前者负责规则归属，后者负责正文表达。
3. 已检查 `AGENTS.md` 与 `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md` 的提示词治理规则保持一致。
4. 已执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。

## 风险与决策记录

1. 决策：本轮先建立编写规范，不直接重写 P0004。原因是用户已明确问题属于所有系统提示词文档的写作规范，先改单个文件会继续依赖隐含经验，缺少后续重构的裁决依据。
2. 决策：规范进入 `docs/core/`，而不是 `.meta/prompts/`。原因是该规范指导提示词文档编写，本身不是需要注入给运行时 AI 执行的提示词正文。
3. 决策：`.meta/README.md` 只引用规范，不复制完整写法要求。原因是 README 负责说明文件格式和边界，完整写作规范应由 core 文档维护，避免双处漂移。
4. 风险：现有 P0004 等提示词仍未按新规范重写；该风险由后续 feature 处理，本 feature 只提供改造依据。

## 范围变更记录

1. 根据用户补充，将目标从“改写 P0004”调整为“先建立系统提示词文档编写规范，再改造具体提示词文档”。
