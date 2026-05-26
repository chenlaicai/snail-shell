---
id: F2026050803
title: 问题卡片检视 Stage 边界
from_ids: []
tags: [workflow, review, security]
modules: [project_management]
---
# F2026050803 问题卡片检视 Stage 边界

## 背景

在 feature“问题卡片不是在最终正文而是在流式过程中”的 development stage，研发 Snail 曾错误地直接要求检视 Snail 检视；当时 conversation 的参与者中没有检视 Snail，且系统注入的当前 Stage 仍处于研发迭代。该行为说明提示词中关于“完成开发后进入检视”的要求可能跨越了 Stage 边界，使 agent 把后续 Stage 动作提前执行。

用户进一步指出，“研发阶段”“检视阶段”这类自然语言表述本身也存在歧义：AI 可能把它理解为普通工作进度，而不是 Snail Shell 系统上下文中的 `Stage` 状态，进而在完成 PR 后自行推断“现在已经进入检视阶段”。因此本 feature 不只补充前置条件，还要收敛阶段术语，明确 Stage 状态只能来自系统注入上下文。

用户继续指出，Snail Shell 的内置系统提示词是有组织、按当前上下文动态构建的；如果同一个内置提示词块同时写 development 和 review 的动作，即使措辞带有 `当前 Stage` 前置条件，也会破坏动态注入边界，让 development stage 看到 review stage 才该注入的任务说明。该问题需要通过 `.meta/prompts` 模块拆分解决，而不是继续在同一内置提示词块里堆条件。

用户随后澄清，`AGENTS.md` 与 Snail Shell 内置系统提示词是并行生效的两套提示词；当前阶段仍需要 `AGENTS.md` 提供全量规则，后续才会移除 `AGENTS.md`、只保留 Snail Shell 系统内置提示词。因此 `AGENTS.md` 不能被收敛成摘要式不变量；它可以完整描述 development/review 动作，但必须明确动作触发来源只能是系统注入的 `当前 Stage`，不能让模型根据普通工作进度自行切换 Stage。

## 目标

1. 分析 development stage 提前触发检视的提示词根因，确认是否存在多层提示词边界越界。
2. 调整长期提示词规则，使 development stage 完成实现和 PR 后只提交可检视产物，不直接 @ 未参与的检视 Snail。
3. 保留 review stage 的主动检视触发要求，避免削弱正式检视流程。
4. 消除“研发阶段 / 检视阶段”被误解为普通工作进度的歧义，明确 Snail 不能自行根据 PR 已提交推断 Stage 已切换。
5. 按 Snail Shell 内置动态提示词组织边界拆分研发者 development 与 review 规则，确保 `.meta/prompts` 中当前 Stage 只注入当前要做的动作。
6. 保持 `AGENTS.md` 作为当前并行提示词线的全量规则表达，同时用准确术语约束 Stage 权威来源。
7. 通过静态检查或自动化验证确认提示词边界表达一致。

## 非目标

1. 不调整问题卡片最终正文渲染逻辑；该问题属于已完成的独立 feature。
2. 不改变 Snail mention 协议、消息路由或参与者注入机制。
3. 不修改已合入 feature 的历史文档。

## 设计

development stage 和 review stage 的职责应由系统注入的 `当前 Stage` 与参与者上下文共同约束：研发 Snail 可以说明 PR 已准备好被检视，但只有 `当前 Stage` 明确为 review 且检视者参与当前 conversation 时，才应主动 @ 检视 Snail。不得把“PR 已提交”“代码已完成”“下一步应检视”等普通工作进度自行等同为 Stage 已切换。

本次分析确认存在多层提示词边界越界：全局研发执行提示虽然写明“在研发阶段不要 @Acceptance Snail”，但该表述仍可能被理解为普通开发进度；Implementation Snail 角色 profile 也曾写“检视阶段: 主动 @Acceptance Snail 检视 PR”，没有把系统注入的 `当前 Stage` 和 `Acceptance Snail` 已参与当前 conversation 作为前置条件。模型在 development stage 看到“完成开发后必须提交 PR”和“检视阶段主动检视”的相邻目标时，容易把后续 Stage 动作提前到当前 Stage 执行。因此修复点不是消息路由兜底，而是把 Stage 状态来源、参与者边界和禁止自行推断 Stage 的规则写入角色 profile、全局研发执行提示和 `AGENTS.md`。

进一步分析确认，`.meta/prompts` 已支持 `when.stage_types` 动态匹配，`SYS-CONV-GLOBAL-BRIDGE` 会按当前 Stage 和 Snail 注入命中的 global prompt；因此 Snail Shell 内置提示词应利用该组织能力控制边界。Implementation Snail 的静态 Profile 只保留身份、职责边界和输出要求；development 的实现/提交规则只在 `stage_types: ["development"]` 的研发执行提示中注入；review 的主动呼叫检视、处理评论和回复 PR 规则拆入独立 `stage_types: ["review"]` 提示词。这样 development stage 不再通过内置提示词看到 review stage 的具体动作说明。

`AGENTS.md` 当前不是 `.meta/prompts` 的动态模块，而是并行读取的完整仓库规则线。它需要保留 development/review 全量动作要求，但表达上必须强调当前阶段以系统注入的 `当前 Stage` 为准，并明确禁止根据“PR 已提交”等普通进度自行推断 review。

## 生效路径

本 feature 的具体 Stage 动作通过两条并行规则线生效：`.meta/prompts/` 作为 Snail Shell 内置动态提示词，按 `when.stage_types` 拆分注入 development/review 动作；`AGENTS.md` 作为当前仍并行生效的静态仓库规则线，保留全量动作要求，但必须用系统注入的 `当前 Stage` 作为唯一触发来源。后续移除 `AGENTS.md` 后，长期边界将只由 `.meta/prompts` 承载。

## 改动范围

预计修改：

1. `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md`
2. `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-REVIEW-implementation-review.md`
3. `.meta/prompts/scene/snails/SYS-SNAIL-IMPLEMENTATION-implementation-snail.md`
4. `.meta/snails.json`
5. `AGENTS.md`
6. `tests/meta/prompt-assets-test.ts`
7. 当前 feature 文档

## 验证

1. 搜索提示词中涉及“研发阶段”“检视阶段”“主动 @Acceptance Snail”“完成开发后”的规则，确认关键触发规则都绑定系统注入的 `当前 Stage`，且不再把自然语言阶段词作为状态来源。
2. 验证 development stage 的 Implementation Snail 只命中研发执行提示，不命中 review 处理提示。
3. 验证 review stage 的 Implementation Snail 只命中 review 处理提示，不命中 development 执行提示。
4. 确认 `AGENTS.md` 作为并行提示词线仍保留全量 development/review 动作规则，同时明确不得根据普通进度自行推断 Stage。
5. 运行 `npm run check`。

验证结果：

1. 已确认 `.meta/prompts/` 中主动 @Acceptance Snail 的研发侧规则只存在于 review 专属提示 `PRM-GLOBAL-IMPLEMENTATION-REVIEW`；development 专属提示只记录 PR 交付和等待系统推进，并明确禁止根据“PR 已提交”自行推断已进入 review。
2. 已确认 Implementation Snail 的静态 Profile 不再直接写入 development/review 的具体动作，具体动作改由按 `when.stage_types` 命中的 global prompt 注入。
3. 已确认 `AGENTS.md` 作为当前并行提示词线保留全量 development/review 动作规则，并明确这些动作只能由系统注入的 `当前 Stage` 触发，不能根据“PR 已提交”自行推断 review。
4. 已通过 `tests/meta/prompt-assets-test.ts` 覆盖动态注入边界：development stage 不注入 `PRM-GLOBAL-IMPLEMENTATION-REVIEW`，review stage 不注入 `PRM-GLOBAL-IMPLEMENTATION-EXECUTION`。
5. `npm run check` 通过，33 个编译后测试文件全部通过。

## 风险与决策记录

当前没有待用户确认的问题。用户已明确怀疑系统提示词多层边界越界；本 feature 按提示词治理问题处理，不需要改变运行时代码路径。

## 范围变更记录

初始范围为提示词边界分析与修复、feature 文档记录及必要验证。

实现中确认需要同步修改 `AGENTS.md`，原因是仓库级规则线也描述研发者职责；如果只修改 `.meta/prompts/`，后续 agent 仍可能从 `AGENTS.md` 中缺失 Stage 边界的表述得到不完整约束。

用户补充指出“研发阶段 / 检视阶段”的用词本身可能让 AI 把普通工作进度误认为 Snail Shell 的系统 Stage。本 feature 范围扩展为术语治理：长期规则应优先使用 `当前 Stage`、`development stage`、`review stage` 等系统状态表述，并明确禁止 Snail 根据 PR 已提交自行推断 Stage 已切换。

术语治理导致既有提示词资产测试中按旧文案断言“在研发阶段不要 @Acceptance Snail”的检查失效；该测试属于长期提示词边界覆盖，已同步改为断言规则绑定系统注入的 `当前 Stage`，并覆盖“不能根据 PR 已提交自行推断 review”。

用户进一步指出提示词动态构建边界问题后，范围扩展为提示词模块组织治理：不再把 development 与 review 的研发者动作写在同一个全局提示或静态 Snail Profile 中，而是按 `when.stage_types` 拆分到各自 Stage 才会命中的模块；同时更新 `.meta/snails.json`，避免工作规则列表残留“进入检视阶段后主动 @Acceptance Snail”这种跨 Stage 动作。

复检曾指出 `AGENTS.md` 仍是静态仓库规则，会在所有 Stage 被读取，因此不应展开主动 @Acceptance Snail 的具体动作；随后用户进一步澄清，当前阶段 `AGENTS.md` 与 Snail Shell 内置系统提示词仍是并行生效的两套提示词，后续才会移除 `AGENTS.md`，所以 `AGENTS.md` 仍应提供全量提示词。基于该决策，本次恢复 `AGENTS.md` 中 development/review 的完整动作规则，但把触发条件明确绑定到系统注入的 `当前 Stage`，并保留禁止根据普通工作进度推断 Stage 切换的约束。
