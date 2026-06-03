---
id: I2026051003
title: AI 上下文一致性判断
from_ids: [I2026050903, I2026050905, I2026050906]
tags: [prompt, governance]
modules: [knowledge_governance]
---
# I2026051003 AI 上下文一致性判断

## 背景

用户在另一个 feature 中误发“pr145已合入；但我突然想到另外一点”后，Snail 没有先判断该消息与当前上下文是否一致，而是无条件继续执行。这个反应暴露的问题不是单纯“用户权威不能免判断”，而是 AI 面对突兀输入时缺少上下文一致性校验：用户消息、历史摘要和当前 stage 之间可能存在语义断裂，不能因为文本看起来像任务指令就直接推进。

PR #144 已合入并新增 `P0004-AI判断与责任契约`，其中已覆盖输入可信度、独立判断、问题层级、有边界主动性和语义验收。但现有规则还没有明确要求 AI 在行动前判断“新输入是否属于当前任务边界和对话上下文的有效延续”。因此需要继续补充 base 判断契约，要求 AI 对上下文错位保持疑惑并先查证或提问。

Review 阶段用户进一步指出，本 PR 初稿把 `project / feature / stage / conversation` 这类 Snail Shell 工作流专有概念直接写进 `ai.base.system`，违背了既有提示词分层边界。该反馈暴露的本质不是简单删词，而是提示词优化时必须先判断规则的语义层级：通用 AI base 只承载跨场景判断能力，具体工作流归属校验应由 Snail Shell project conversation 工作上下文承载。

用户随后进一步指出，当前提示词本身已有组织结构，研发者仍未识别并随意改动，说明缺陷还包括“提示词修改前缺少结构基线校验”。本质原因是实现时只响应了“从现象归纳到 ai base”的表层方向，没有先查证 `docs/core/prompt-system-structure.md` 和目标提示词 metadata 中已有的 `target`、`semantic_layer` 归属模型，导致已有结构没有成为修改前的约束。

## 目标

1. 在 `ai.base.system` 中补充通用上下文一致性判断规则，要求 AI 面对突兀、引用对象不明、状态冲突、语义不连贯或疑似发错上下文的输入时，先判断语义关联和有效归属。
2. 将 Snail Shell 专有的 `Project / Feature / Stage / Conversation` 归属校验放入 project conversation 工作上下文，避免 base 契约越层承载工作流概念。
3. 明确不能把用户新消息的表面可执行性当作上下文有效性证明；如果消息可能发错位置、引用对象不明或与当前工作流状态冲突，应先说明不一致并查证或提问。
4. 同步 `AGENTS.md` 的通用原则，保持仓库规则线与 `.meta/prompts/` 双线生效一致。
5. 更新 prompt 资产测试，锁定新增 base 契约和工作上下文归属，避免后续提示词重构时丢失。
6. 在研发迭代手册中补充提示词修改前的结构基线校验，要求先对照 core 结构文档和目标 prompt metadata 判断归属，防止后续系统提示词被越层污染。

## 非目标

1. 不修改已合入的 `docs/issues/20260509/I2026050906-ai-base-judgment-contract.md` 历史记录。
2. 不改变 Snail Shell 的 stage 流程、mention 协议、历史查询机制或知识候选流程。
3. 不新增跨 conversation 自动路由能力；本次只约束 AI 在当前输入与上下文不连贯时的判断和提问行为。
4. 不要求所有轻微话题切换都提问；只有归属、事实或下一步行动存在真实不确定时才需要暂停直接执行。

## 设计

本问题属于所有 Snail 都可能遇到的底层判断缺陷：用户、历史消息、工具输出或注入上下文之间可能互相冲突，AI 必须先判断它们是否构成当前任务的有效输入。该通用判断能力不绑定单一角色或 stage，因此归入 `P0004`；但 `project / feature / stage / conversation` 是 Snail Shell project conversation 场景的工作流概念，应由该场景的工作上下文承载，不能混入 `ai.base.system`。

新增规则应强调三个边界：

1. 通用上下文归属：新输入需要能解释为当前任务边界、对话上下文、既有目标和已知事实的延续，不能只因用户说了可执行内容就默认归属当前任务。
2. 工作流上下文归属：Snail Shell project conversation 需要额外校验当前 Project、Feature、Stage 和 Conversation；发现跨 feature、跨 PR、跨 stage、引用对象不明、状态冲突或语义不连贯时，应先暴露疑惑，查证历史或提出真实待决策问题。
3. 正常切换保护：如果用户明确提出新的目标，且与当前状态不冲突，AI 可以继续处理；规则针对的是上下文有效性不足却被机械执行的情况。

本次失误的直接原因不是缺少提示词结构文档，而是执行提示词优化时没有把结构文档作为前置约束。后续修改提示词时，研发者必须先完成候选规则归属判断：该规则是否对所有 AI 成立、是否依赖 Project / Feature / Stage / Conversation / Task、是否属于 Work Context 或 Stage Role Playbook、目标文件 metadata 是否与语义归属一致。只有归属成立后才能编辑对应提示词；如果用户表述的目标层级与既有结构冲突，应先暴露冲突并说明取舍，而不是直接把规则写入用户提到的层级。

## 生效路径

1. `.meta/prompts/base/P0004-AI判断与责任契约.md`：补充通用上下文一致性判断规则，运行时注入所有 Snail 的 base system prompt。
2. `.meta/prompts/scenarios/project-conversation/work-context/P010101-项目推进入口.md`：承载 Snail Shell 专有的 Project、Feature、Stage 和 Conversation 归属校验。
3. `AGENTS.md`：同步补充通用原则，并明确工作流专有概念由工作上下文提示词承载。
4. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`：补充提示词修改前的结构基线校验，要求先对照 core 结构文档和 prompt metadata 判断规则归属。
5. `tests/meta/prompt-assets-test.ts`：增加断言，锁定新增规则文本、分层归属和提示词修改前置校验。

## 改动范围

预计修改或新增：

1. `docs/issues/20260510/I2026051003-ai-context-coherence.md`
2. `.meta/prompts/base/P0004-AI判断与责任契约.md`
3. `.meta/prompts/scenarios/project-conversation/work-context/P010101-项目推进入口.md`
4. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
5. `AGENTS.md`
6. `tests/meta/prompt-assets-test.ts`

## 验证

已执行：

1. `git diff --check`：通过。
2. 首次运行 `npm run check` 因隔离 worktree 尚未安装依赖失败，错误为 `tsx: command not found`。
3. `npm install`：完成 worktree 依赖安装。
4. 再次运行 `npm run check`：通过，包含 `generate-types`、`lint`、`build` 和 33 个编译后测试文件。
5. 已人工核对新增规则与 PR #144 的 base 契约不重复、不冲突，并确认未二次修改已合入 feature 文档。
6. Review 修复后重新执行 `git diff --check`：通过。
7. Review 修复后重新执行 `npm run check`：通过，包含 `generate-types`、`lint`、`build` 和 33 个编译后测试文件。

## 风险与决策记录

已接受的设计决策：本次反馈应作为新 feature 记录，而不是修改 PR #144 的历史 feature 文档。原因是 PR #144 已合入，历史 feature 文档不应被后续需求追写。

已接受的设计决策：通用上下文一致性判断归入 `ai.base.system`，而不是某个 stage playbook。原因是该缺陷发生在所有 Snail 接收输入并选择行动前的基础判断链路。

已接受的设计决策：`project / feature / stage / conversation` 不应出现在 `ai.base.system` 的规则正文中。原因是这些是 Snail Shell project conversation 的工作流专有概念，应由场景工作上下文提示词承载；base 层只表达通用任务边界、对话上下文、目标和事实一致性判断。

已接受的设计决策：提示词修改前的结构基线校验应放入 `P010201`，而不是 `P0004`。原因是该规则约束的是 Implementation Snail 在 development 阶段梳理或调整 Snail Shell 提示词资产时的工作方法，不是所有 AI 调用都需要知道的底层契约。

已接受的设计决策：规则不应要求任何话题变化都停下来提问。明确的新目标可以直接处理；只有当前输入与现有上下文无法合理衔接、事实不足或行动归属存在真实不确定时，才应先查证或提问。

## 范围变更记录

1. Review 阶段根据用户反馈扩大改动范围：从单纯补充 `P0004`，调整为同时修正提示词分层归属，在 `P010101` 承载 Snail Shell 专有的 Project、Feature、Stage 和 Conversation 归属校验，并更新测试锁定 base 不混入工作流专有概念。
2. Review 阶段根据用户追加反馈继续扩大范围：补充提示词修改前的结构基线校验，要求研发者先对照 `docs/core/prompt-system-structure.md` 和目标提示词 metadata 判断归属，避免后续提示词资产被当前现象或用户表述的目标层级牵引而越层污染。
