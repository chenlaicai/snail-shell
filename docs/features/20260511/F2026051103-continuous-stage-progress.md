# F2026051103 阶段内连续推进边界

## 背景

用户反馈指出，部分 LLM 模型会让 Snail 说几句话就停下，导致用户在 feature“优化提示词0511-2”中反复发送“继续”。这些停顿通常不是因为需要用户决策或其他 Snail 介入，而只是 Snail 在说明“下一步准备做什么”后提前结束本轮响应。

该问题的本质不是禁止进度说明，而是项目推进提示词没有明确区分“阶段内可自主完成的后续动作”和“必须停下等待外部输入的真实阻塞”。Snail 应在当前 Stage 目标和剩余协作轮次允许的范围内持续推进，直到完成阶段可交付结果、遇到真实待决策事项、需要通过 `message-out` mention 协议转交其他 Snail，或受到运行时/工具阻塞。

## 目标

1. 明确项目推进会话中 Snail 不能把“下一步准备做什么”当作停下等待用户说“继续”的理由。
2. 明确 Development Stage 中 Implementation Snail 要持续推进到实现、自检、提交 PR 和记录 PR 状态完成。
3. 明确 Review Stage 中 Implementation Snail 要持续推进到请求检视、处理检视意见、验证、更新 PR 和回复评论完成。
4. 明确 Review Stage 中 Acceptance Snail 要持续推进到完成检视、提交 PR 评论并给出可投递的检视或复检结论。
5. 保留必要停顿边界：真实用户决策、范围扩大确认、其他 Snail 介入、系统 Stage 切换、外部权限或工具阻塞仍可以停下。

## 非目标

1. 不改变当前 Stage 定义、产物类型、PR 创建机制或 mention 协议。
2. 不要求 Snail 在需要用户决策或其他 Snail 介入时强行继续。
3. 不要求一次响应无条件覆盖超出当前 Stage、当前 Feature 或当前剩余协作轮次的工作。
4. 不修改 AI Base 基础契约；本问题依赖 Snail Shell 项目推进场景和阶段角色边界。

## 设计

根据 `docs/core/prompt-system-structure.md` 的归属规则，本次规则属于 `Project Conversation Prompt / Stage Role Playbook`：它约束的是 Snail 在特定 Stage 内如何判断、行动和收口，而不是所有 AI 调用都适用的基础契约。

具体设计为：

1. 在 `P010201-研发迭代手册.md` 增加“连续推进边界”，要求 Development Stage 内 Implementation Snail 持续推进到 PR 状态记录完成，不因已经说明下一步而停下等待用户继续。
2. 在 `P010202-研发检视处理.md` 增加同类规则，要求 Review Stage 内 Implementation Snail 处理检视意见时持续推进到修复、验证、PR 更新和评论回复完成。
3. 在 `P010203-验收检视手册.md` 增加同类规则，要求 Acceptance Snail 持续推进到 PR 评论和对话结论完成，避免只说明准备检视或下一步动作。
4. 在 `AGENTS.md` 的研发者和检视者职责中同步稳定规则，保持双线生效期间一致。

允许停下的边界集中为真实阻塞：需要用户作业务或范围决策、需要其他 Snail 通过 mention 接手、需要系统 Stage 切换、当前剩余协作轮次或工具/权限不足导致无法继续。普通进度说明可以出现，但必须伴随继续执行，而不是作为结束当前响应的理由。

## 生效路径

本 feature 通过以下长期入口生效：

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
2. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010202-研发检视处理.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010203-验收检视手册.md`
4. `AGENTS.md`
5. `docs/features/20260511/F2026051103-continuous-stage-progress.md`

## 改动范围

新增：

1. `docs/features/20260511/F2026051103-continuous-stage-progress.md`

修改：

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
2. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010202-研发检视处理.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010203-验收检视手册.md`
4. `AGENTS.md`
5. `tests/meta/prompt-assets-test.ts`

## 验证

已执行：

1. 人工核对规则归属符合 `docs/core/prompt-system-structure.md`，未把项目推进专有规则放入 AI Base。
2. 人工核对新增规则与既有“需要真实决策才提问”“Development Stage 不主动 @Acceptance Snail”“review 阶段必须使用 mention 协议”不冲突。
3. 已补充 `tests/meta/prompt-assets-test.ts`，覆盖 Development、Implementation Review 和 Acceptance Review 三类阶段手册中的连续推进关键语义。
4. 已执行 `npm run check`：通过，包含 `generate-types`、`lint`、构建和 33 个编译后测试文件。

## 风险与决策记录

1. 决策：本次不修改 AI Base。原因是“说下一步后不要停下”在这里依赖 Snail Shell 的 Stage、PR 和 mention 语义；通用 AI Base 只保留用户决策和行动强度边界。
2. 决策：不禁止短进度说明。原因是进度说明有助于用户理解当前动作，问题在于把进度说明当作停下等待“继续”的理由。
3. 决策：保留外部介入停顿。原因是用户明确要求不要矫枉过正；需要用户或其他 Snail 介入时应停下并按协议提问或 mention。

## 范围变更记录

1. 实现自检时发现既有 prompt asset 测试已覆盖阶段手册关键语义，因此追加 `tests/meta/prompt-assets-test.ts` 断言，避免连续推进规则在后续提示词重组中丢失。
