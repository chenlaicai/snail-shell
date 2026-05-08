# F2026050801 问题卡片检视阶段边界

## 背景

在 feature“问题卡片不是在最终正文而是在流式过程中”的研发阶段，研发 Snail 曾错误地直接要求检视 Snail 检视；当时 conversation 的参与者中没有检视 Snail，且 stage 仍处于研发迭代。该行为说明提示词中关于“完成开发后进入检视”的要求可能跨越了阶段边界，使研发阶段的 agent 把后续阶段动作提前执行。

## 目标

1. 分析研发阶段提前触发检视的提示词根因，确认是否存在多层提示词边界越界。
2. 调整长期提示词规则，使研发阶段完成实现和 PR 后只提交可检视产物，不直接 @ 未参与的检视 Snail。
3. 保留进入检视阶段后的主动检视触发要求，避免削弱正式检视流程。
4. 通过静态检查或自动化验证确认提示词边界表达一致。

## 非目标

1. 不调整问题卡片最终正文渲染逻辑；该问题属于已完成的独立 feature。
2. 不改变 Snail mention 协议、消息路由或参与者注入机制。
3. 不修改已合入 feature 的历史文档。

## 设计

研发阶段和检视阶段的职责应由 stage 与参与者上下文共同约束：研发 Snail 可以说明 PR 已准备好被检视，但只有进入检视阶段且检视者参与当前 conversation 时，才应主动 @ 检视 Snail。

本次分析确认存在多层提示词边界越界：全局研发执行提示已经写明“在研发阶段不要 @Acceptance Snail”，但 Implementation Snail 角色 profile 只写“检视阶段: 主动 @Acceptance Snail 检视 PR”，没有把“当前 stage 已进入检视”和“Acceptance Snail 已参与当前 conversation”作为前置条件。模型在研发阶段看到“完成开发后必须提交 PR”和“检视阶段主动检视”的相邻目标时，容易把后续阶段动作提前到当前阶段执行。因此修复点不是消息路由兜底，而是把阶段与参与者边界写入角色 profile、全局研发执行提示和 `AGENTS.md`。

## 生效路径

本 feature 的规则通过 `.meta/prompts/` 的长期提示词模块生效；如发现 `AGENTS.md` 存在同类边界表达，也同步调整，保持两条提示词规则线一致。

## 改动范围

预计修改：

1. `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md`
2. `.meta/prompts/scene/snails/SYS-SNAIL-IMPLEMENTATION-implementation-snail.md`
3. `AGENTS.md`
4. 当前 feature 文档

## 验证

1. 搜索提示词中涉及“检视阶段”“主动 @Acceptance Snail”“完成开发后”的规则，确认研发阶段与检视阶段边界表达不冲突。
2. 运行 `npm run check`。

验证结果：

1. 已确认 `.meta/prompts/` 中主动 @Acceptance Snail 的研发侧规则都带有“当前 stage 已进入检视且 Acceptance Snail 已参与当前 conversation”的前置条件。
2. `npm run check` 通过，32 个编译后测试文件全部通过。

## 风险与决策记录

当前没有待用户确认的问题。用户已明确怀疑系统提示词多层边界越界；本 feature 按提示词治理问题处理，不需要改变运行时代码路径。

## 范围变更记录

初始范围为提示词边界分析与修复、feature 文档记录及必要验证。

实现中确认需要同步修改 `AGENTS.md`，原因是仓库级规则线也描述研发者职责；如果只修改 `.meta/prompts/`，后续 agent 仍可能从 `AGENTS.md` 中缺失阶段边界的表述得到不完整约束。
