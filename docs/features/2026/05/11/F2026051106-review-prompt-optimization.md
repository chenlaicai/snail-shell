---
id: F2026051106
title: 检视提示词优化
from_ids: [F2026051102]
tags: [prompt, review]
modules: [project_management]
---
# F2026051106 检视提示词优化

## 背景

当前 Feature 名为“检视提示词优化”，但当前 conversation 没有更早需求细节，Stage 输入和上一 Stage 产物也为空。可确认的工作边界是：在 development stage 内对 Snail Shell 自身的检视提示词做一次可追溯优化，并提交可检视 PR。

现有 `P010203-验收检视手册.md` 已包含检视者的核心规则，但正文主要按规则来源堆叠：语义检视、代码结构、why 注释、文档治理、PR 评论、mention 和复检规则并列存在。该结构容易让检视者在执行时遗漏“先追溯输入与 PR 目标，再按 PR 类型选择检查项，最后完成 PR 评论和对话 mention”的顺序闭环。

## 目标

1. 优化 Acceptance Snail / Review 行动手册，使检视过程更接近可执行流程。
2. 明确检视前必须追溯 PR、Feature 文档、Stage 输入、conversation 上下文和必要历史线索，避免只看局部 diff。
3. 把语义有效性、专项检查、问题报告、对话回传和复检收口分区表达，减少规则遗漏。
4. 同步 `AGENTS.md` 中检视者稳定规则摘要，保持双线生效期间一致。

## 非目标

1. 不修改运行时代码、prompt registry、prompt builder 或 Prompt Center。
2. 不改变 `P010203` 的 metadata、target、when 条件或注入范围。
3. 不重写全部 `.meta/prompts/`，也不二次修改已合入 feature 文档。
4. 不引入新的检视产物类型、自动化检视器或 GitHub 评论机制。

## 设计

`P010203` 保持 `scenario.project-conversation.stage-role-playbook` 归属。按照 `docs/core/prompt-system-structure.md`，Acceptance Snail 在 review stage 的检视动作属于阶段角色行动手册，不应上移到 AI base，也不应下沉到具体 skill 正文。

手册正文调整为以下执行结构：

1. 身份与工作要求：保留检视者身份、检视对象、PR 留痕和通过标准。
2. 检视输入：新增 PR、Feature 文档、Stage 输入、conversation 上下文、必要历史、测试结果和仓库规则的追溯要求。
3. 检视方法：先判断 PR 语义类型、本质目标和成功标准，再决定专项检查重点。
4. 专项检查：保留代码、提示词、文档治理、why 注释和验证覆盖检查，并按检查主题分组。
5. 问题报告：明确所有真实问题必须评论到 PR，按严重度排序，普通 PR 评论即可。
6. 对话回传：明确检视结论、问题已提交、复检通过或仍需响应时，必须用 `message-out` mention 协议投递 Implementation Snail。
7. 复检规则：保留完整复检要求，并强调不能只确认单条评论已处理。

`AGENTS.md` 的检视者摘要同步增加输入追溯和语义目标对齐要求，但不复制 `P010203` 的完整分区正文，避免双线漂移。

## 生效路径

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010203-验收检视手册.md`：运行时注入 Acceptance Snail / review stage 的检视行动手册。
2. `AGENTS.md`：当前双线生效期间的仓库级稳定工作规则摘要。
3. `docs/features/20260511/F2026051106-review-prompt-optimization.md`：记录本次需求边界、设计取舍、改动范围和验证结果。

## 改动范围

新增：

1. `docs/features/20260511/F2026051106-review-prompt-optimization.md`

修改：

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010203-验收检视手册.md`
2. `AGENTS.md`

## 验证

已执行：

1. 人工核对 `P010203` metadata、target、semantic_layer 和 when 条件未改变。
2. 人工核对本次新增规则归属仍为 Acceptance Snail / review stage 行动手册，没有污染 AI base。
3. 人工核对 `AGENTS.md` 与 `.meta/prompts/` 的检视者规则强度一致。
4. 首次执行 `npm run check` 因新 worktree 缺少依赖失败，错误为 `tsx: command not found`；已在 worktree 内执行 `npm install` 补齐依赖。
5. 执行 `npm run check` 时曾出现一次 `managed-process-test` 超时升级断言失败；单独复跑 `node dist/tests/agent/managed-process-test.js` 通过，随后再次执行 `npm run check` 通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。
6. 根据用户要求基于最新 `main` 更新后，合并 `origin/main` 至当前分支，解决 `P010203` 合并冲突，并再次执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。

## 风险与决策记录

1. 决策：在当前需求细节不足时，不扩大为全量提示词重写。原因是上一轮 `F2026051102` 已完成全量 `.meta/prompts/` 正文规范化，本 Feature 名称只支持针对检视提示词继续优化。
2. 决策：优化重点放在 `P010203`。原因是它是 Acceptance Snail / review stage 的直接运行时入口，最贴近“检视提示词优化”的职责边界。
3. 决策：同步 `AGENTS.md` 但只写摘要。原因是当前仓库规则要求双线一致，但完整流程主归属应保留在 stage role playbook，避免长期维护两份完整手册。

## 范围变更记录

1. 初始范围：根据当前 Feature 名称和 development stage 交付要求，新增 feature 文档并优化 Acceptance Snail 检视提示词。
2. 根据用户要求基于最新 `main` 更新，合并 `origin/main` 后发现 `docs/features/20260511/F2026051103-current-stage-conversation-selection.md` 已存在，因此将本 Feature 文档编号从 `F2026051103` 顺延为 `F2026051106`，避免修改已合入 feature 文档或制造编号冲突。
