# F2026051101 当前 Stage Conversation 选中语义确认

## 背景

用户反馈点开 Feature“系统提示词优化0511”后看不到预期对话。进一步查证后，`development #3` 不是系统擅自推进，而是在 review 已收口后，用户明确选择方案 `2`，允许重新打开当前 Feature 的 development 后创建的合法 stage。

因此问题不应被建模为“Feature 下必须展示所有历史 conversation”。Snail Shell 的左侧 Feature 展开区当前承载的是当前 stage 的工作入口；旧 development/review conversation 通过 stage、from conversation 和历史查询保持可追溯，但不应混入当前 stage conversation 列表。

再次复核 PR 净 diff 后确认：`origin/main` 已具备当前 stage 选中行为，本 PR 没有新增运行时代码修复。它的作用是撤回错误的 Feature 全量 conversation 方案，并用文档与回归断言锁定正确语义，避免后续再次把当前工作入口改成历史总览入口。

## 目标

1. 保留 Feature 展开后展示当前 stage conversations 的语义。
2. 明确并锁定进入新 development stage 后，当前 Feature 应锚定到后端 `current_stage` 并默认选中该 stage 的 conversation。
3. 撤回“展示 Feature 下所有 conversations”的错误修复方向。
4. 增加回归检查，避免后续把当前 stage 工作入口误改为 Feature 全量历史入口。

## 非目标

1. 不新增 Feature 下所有历史 conversation 的混合展示。
2. 不改变 conversation 与 stage 的归属关系。
3. 不改数据库 schema。
4. 不新增 stage 分组历史浏览 UI；如果后续需要历史总览，应单独设计。

## 设计

当前 Feature 的主工作入口由 `current_stage` 决定。前端选中 Feature 时，应调用 `/features/:featureId` 获取后端最新 Feature detail，使用其中的 `current_stage`，再调用 `/stages/:stageId/conversations` 加载当前 stage conversations，并选中列表中的默认 conversation。

这能覆盖合法重启 development 的场景：用户允许从 review 重新进入 development 后，后端会创建新的 development stage 和默认 conversation；再次打开该 Feature 时，前端应依据后端 `current_stage` 进入新的 development conversation，而不是继续停留在旧 review conversation，也不是展示所有历史 conversations 混合列表。当前代码已具备该行为，因此本 PR 的验证重点是确认现有生效路径并补充防回归约束。

## 生效路径

1. `src/web/app.js`：确认并保留 stage 级 conversation 加载路径、`current_stage` 选中路径，以及重启 development 后直接锚定新 conversation 的路径。
2. `src/web/project-tree-view.js`：保留“当前阶段还没有对话”的空态语义。
3. `tests/web/feature-list-view-test.ts`：补充静态断言，防止 conversation 分支被误改为 Feature 全量历史列表。

## 改动范围

1. `tests/web/feature-list-view-test.ts`
2. `docs/features/20260511/F2026051101-current-stage-conversation-selection.md`

## 验证

1. 运行 `npm run test -- --runInBand tests/web/feature-list-view-test.ts`。
2. 运行 `npm run build`。
3. 使用当前数据库核对“系统提示词优化0511”的 `development #3` 来源：用户选择 `2` 后由 restart development workflow 创建，属于合法 stage 切换。

## 风险与决策记录

1. 已撤回错误方向：不能为了让旧对话都可见而把 Feature 展开区改成所有 stage conversations 混合列表。
2. 已确认 `development #3` 是用户授权后的合法行为，不是 Snail 擅自推进。
3. 如果后续需要历史 conversation 总览，应作为独立 UI 能力设计，不能污染当前 stage 工作入口。
4. 本 PR 不应被描述为新增运行时代码修复；如果用户本地仍然看不到当前 stage conversation，应优先核对运行版本、前端刷新状态和数据库中的 `current_stage`，而不是期待本 PR 合入后凭空改变运行时代码。

## 范围变更记录

1. 初始修复曾误判为 Feature 历史 conversation 完整展示问题，实际应修正为当前 stage conversation 选中和展示语义；因此撤回全量 Feature conversations 方案，并更新本文档记录正确边界。
2. Review 阶段复核发现最终 PR 净 diff 没有运行时代码改动，上一阶段“合入本 PR 后重启即可看到修复”的表述不严谨；本次补充记录本 PR 的真实生效边界，并加强测试断言。
