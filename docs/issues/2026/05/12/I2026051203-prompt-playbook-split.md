---
id: I2026051203
title: 提示词行动手册拆分
from_ids: []
tags: [prompt, refactor]
modules: [project_management]
---
# I2026051203 提示词行动手册拆分

## 背景

用户指出当前系统提示词文件仍然混杂：例如研发文档中同时包含研发阶段要做的事、检视阶段要做的事、更新系统提示词要做的事。现有 `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md` 虽然已经按章节组织，但仍把 Development 流程、Feature 文档治理、提示词治理、代码与 PR 规则压在同一个文件中；`AGENTS.md` 也以长清单方式混合研发、检视、文档治理和提示词治理规则。

## 目标

1. 将研发阶段流程、Feature 文档治理、提示词治理、代码与 PR 交付规则拆成职责更单一的提示词文件。
2. 保持规则仍归属 `scenario.project-conversation.stage-role-playbook`，不把项目推进、角色或 stage 专有规则上移到 AI base。
3. 同步整理 `AGENTS.md` 的对应摘要，让双线规则按独立职责分区，避免继续堆叠为一个研发长清单。
4. 更新提示词资产测试，固化拆分后的文件发现、命中条件和关键正文约束。
5. 将“不要只修被点名的单个提示词文件，应检查同类文件并同步提示词规范”的要求沉淀到长期规范入口。

## 非目标

1. 不修改运行时代码、prompt registry、prompt builder 或 Prompt Center 展示逻辑。
2. 不改变现有 stage、snail、message-out、knowledge-candidate 或 conversation-history 协议。
3. 不重写全部 `.meta/prompts/`，也不二次修改已合入 feature 文档。
4. 不移除 `AGENTS.md`；当前仍保持 `AGENTS.md` 与 `.meta/prompts/` 双线生效。

## 设计

按照 `docs/core/prompt-system-structure.md`，这些规则仍属于 Project Conversation Prompt 下的 Stage Role Playbook，因为它们都只在项目推进、角色和 stage 语境下成立。拆分不新增语义层，也不引入新的 target。

本次拆分采用独立提示词文件承载不同治理责任：

1. `P010201-研发迭代手册.md` 收窄为 Implementation Snail / development 的身份、承接、需求收敛、设计、实现、验证和 PR 收口流程。
2. `P010205-Feature文档治理.md` 承载 feature 文档创建、更新、历史记录边界、风险决策记录和检视规则，命中 development / review 的 Implementation Snail 与 Acceptance Snail。
3. `P010206-提示词治理.md` 承载提示词归属判断、文件粒度、表达规则和双线一致，命中 development / review 的 Implementation Snail 与 Acceptance Snail。
4. `P010207-代码与PR交付规则.md` 承载 Implementation Snail 的 commit、PR、代码注释和 PR 信息边界，命中 development / review 的 Implementation Snail。

`P010204-代码仓工作基线.md` 保持独立，继续承载 worktree 隔离、目标分支和 repo context 记录。它与代码交付规则的区别是：前者保护仓库资源和隔离边界，后者保护研发者提交内容和 PR 可维护性。

`AGENTS.md` 只保留稳定摘要，但按“研发者”“检视者”“Feature 文档治理”“提示词治理”“代码与 PR 交付规则”分区，避免把所有规则混进研发者单一清单。

## 生效路径

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`：运行时注入 Implementation Snail / development 阶段流程。
2. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010205-Feature文档治理.md`：运行时注入项目推进中的 feature 文档治理规则。
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010206-提示词治理.md`：运行时注入提示词治理规则。
4. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010207-代码与PR交付规则.md`：运行时注入 Implementation Snail 的代码与 PR 交付规则。
5. `AGENTS.md`：当前双线生效期间的仓库级稳定工作规则摘要。
6. `tests/meta/prompt-assets-test.ts`：固化提示词拆分后的发现、注入和关键内容约束。
7. `docs/core/prompt-system-structure.md`：长期提示词文件粒度规范。
8. `.meta/prompts/prompt.md.template`：新增或调整提示词文档时的模板指引。

## 改动范围

新增：

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010205-Feature文档治理.md`
2. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010206-提示词治理.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010207-代码与PR交付规则.md`
4. `docs/features/20260512/I2026051203-prompt-playbook-split.md`

修改：

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
2. `AGENTS.md`
3. `tests/meta/prompt-assets-test.ts`
4. `docs/core/prompt-system-structure.md`
5. `.meta/prompts/prompt.md.template`

## 验证

1. 已基于最新 `origin/main` 合并 `feature/prompt-optimization-0512-01`，合并无冲突。
2. 合并后已执行 `npm run check` 并通过，包含 `generate-types`、`lint`、构建和 34 个编译后测试文件。
3. 已人工核对新增提示词 `P010205`、`P010206`、`P010207` 的 `target`、`semantic_layer`、`when` 和 `render_mode`，确认仍归属 `scenario.project-conversation.stage-role-playbook`。
4. 已人工核对 `P010201` 不再承载 Feature 文档治理、提示词治理和代码与 PR 交付规则的完整正文，只保留流程中的引用说明。
5. 已人工核对 `AGENTS.md` 与 `.meta/prompts/` 拆分后的规则强度一致，并按独立职责分区整理摘要。
6. 已根据用户反馈扩大范围，人工核对文件粒度规则已同步到 `docs/core/prompt-system-structure.md`、`.meta/prompts/prompt.md.template`、`P010206-提示词治理.md` 和 `AGENTS.md`。

## 风险与决策记录

1. 决策：不把 Feature 文档治理和提示词治理上移到 AI base。原因是这些规则依赖 Snail Shell 项目推进、Feature、Stage、PR 和仓库上下文，不适用于所有底层 AI 调用。
2. 决策：保留 `P010201` 中对独立治理规则的短引用。原因是 Development 流程需要提醒在对应节点调用治理规则，但完整规则主归属应在独立文件，避免重复漂移。
3. 决策：不拆分 `P010204-代码仓工作基线.md`。原因是 worktree 隔离和 repo context 记录已经是独立职责，与本次用户指出的研发文档混杂问题不同。
4. 风险处理：早期曾因网络问题未能确认远端 `origin/main` 最新状态；后续已成功执行 `git fetch origin main`，并将最新 `origin/main` 合并到当前 feature 分支，原网络风险已关闭。

## 范围变更记录

1. 初始范围：根据用户反馈拆分系统提示词中相互独立的研发、检视和提示词治理规则，重点处理研发行动手册混杂问题。
2. 根据用户反馈扩大范围：把“所有提示词文件都要考虑单一职责拆分，不能只修被点名文件”的要求补充到长期提示词规范、模板、运行时提示词治理规则和 `AGENTS.md` 摘要。
3. 合并最新 `origin/main` 后发现 `docs/features/20260512/I2026051202-knowledge-message-ref.md` 已占用当天 `02` 编号，因此将当前 feature 文档从 `I2026051202` 顺延为 `I2026051203`，避免同日编号冲突。
