---
id: I2026051103
title: 当前 Stage Conversation 选中语义确认
from_ids: []
tags: [ui, workflow]
modules: [project_management]
---
# I2026051103 当前 Stage Conversation 选中语义确认

## 背景

用户反馈点开 Feature“系统提示词优化0511”后看不到预期对话。进一步查证后，`development #3` 不是系统擅自推进，而是在 review 已收口后，用户明确选择方案 `2`，允许重新打开当前 Feature 的 development 后创建的合法 stage。

因此问题不应被建模为“Feature 下必须展示所有历史 conversation”。Snail Shell 的左侧 Feature 展开区当前承载的是当前 stage 的工作入口；旧 development/review conversation 通过 stage、from conversation 和历史查询保持可追溯，但不应混入当前 stage conversation 列表。

再次复核 PR 净 diff 后确认：`origin/main` 已具备当前 stage 选中行为，但用户实际遇到的“空白”来自另一个运行时缺口：当前 stage 的默认 conversation 可能是刚创建的空对话，只通过 `from_conversation_ids` 承接上一 stage，上游上下文没有在消息区形成可见入口。本 PR 不应把 Feature 左侧列表改成全量历史混合展示，而应在当前 conversation 空且存在来源 conversation 时展示来源入口，让用户能从当前 stage 明确跳转到承接上下文。

## 目标

1. 保留 Feature 展开后展示当前 stage conversations 的语义。
2. 明确并锁定进入新 development stage 后，当前 Feature 应锚定到后端 `current_stage` 并默认选中该 stage 的 conversation。
3. 撤回“展示 Feature 下所有 conversations”的错误修复方向。
4. 增加回归检查，避免后续把当前 stage 工作入口误改为 Feature 全量历史入口。
5. 当前 stage conversation 没有消息但存在来源 conversation 时，消息区提供来源对话入口，避免用户看到空白而误以为记录丢失。
6. 补充长期约束：Snail 不能主动推进 stage、重开 development、完成/归档 Feature 或直接修改工作流状态数据；这些状态变更只能由用户明确触发的系统动作完成。

## 非目标

1. 不新增 Feature 下所有历史 conversation 的混合展示。
2. 不改变 conversation 与 stage 的归属关系。
3. 不改数据库 schema。
4. 不新增 stage 分组历史浏览 UI；如果后续需要历史总览，应单独设计。

## 设计

当前 Feature 的主工作入口由 `current_stage` 决定。前端选中 Feature 时，应调用 `/features/:featureId` 获取后端最新 Feature detail，使用其中的 `current_stage`，再调用 `/stages/:stageId/conversations` 加载当前 stage conversations，并选中列表中的默认 conversation。

这能覆盖合法重启 development 的场景：用户允许从 review 重新进入 development 后，后端会创建新的 development stage 和默认 conversation；再次打开该 Feature 时，前端应依据后端 `current_stage` 进入新的 development conversation，而不是继续停留在旧 review conversation，也不是展示所有历史 conversations 混合列表。

同时，当前 stage conversation 可能还没有任何消息，这种空白本身是合法数据状态，但不能在 UI 上伪装成“没有上下文”。如果当前 conversation 声明了 `from_conversation_ids`，消息区应显示来源 conversation 入口；点击后切换到来源 conversation 所属 stage 并选中该 conversation。

进一步复盘后确认：来源入口只能解释已有空态，不能替代状态机本身。更上位的问题是 Snail 不应主动推进 stage 或修改工作流状态；如果用户通过系统入口明确触发 stage 切换，新 stage conversation 可以作为新的工作入口存在，Snail 在该 conversation 内继续工作应由用户输入、系统入口或明确路由触发，而不是由 Snail 擅自推进状态后再补启动消息。

## 生效路径

1. `src/web/app.js`：确认并保留 stage 级 conversation 加载路径、`current_stage` 选中路径，以及重启 development 后直接锚定新 conversation 的路径；当前 conversation 为空但存在来源 conversation 时，在消息区展示来源入口并支持跳转。
2. `src/web/project-tree-view.js`：保留“当前阶段还没有对话”的空态语义。
3. `src/api/feature-routes.ts`、`src/project/manager.ts`：补充 stage detail 只读接口，支持来源 conversation 跳转时恢复其所属 stage 上下文。
4. `.meta/prompts/scenarios/project-conversation/work-context/P010101-项目推进入口.md` 与 `AGENTS.md`：沉淀 Snail 不得主动推进 stage 或修改工作流状态数据的长期约束。
5. `src/web/conversation-source-empty-state.js`：封装来源 conversation 空态卡片，避免继续膨胀主入口文件。
6. `src/web/styles.css`：补充来源 conversation 空态卡片样式。
7. `tests/web/feature-list-view-test.ts`：补充静态断言，防止 conversation 分支被误改为 Feature 全量历史列表。
8. `tests/web/ui-entrypoint-test.ts`：补充来源 conversation 空态入口和异步过期保护的静态断言。
9. `tests/meta/prompt-assets-test.ts`：补充提示词长期约束的回归断言。

## 改动范围

1. `tests/web/feature-list-view-test.ts`
2. `docs/issues/20260511/I2026051103-current-stage-conversation-selection.md`
3. `src/web/app.js`
4. `src/api/feature-routes.ts`
5. `src/project/manager.ts`
6. `src/web/styles.css`
7. `tests/web/ui-entrypoint-test.ts`
8. `src/web/conversation-source-empty-state.js`
9. `.meta/prompts/scenarios/project-conversation/work-context/P010101-项目推进入口.md`
10. `AGENTS.md`
11. `tests/meta/prompt-assets-test.ts`

## 验证

1. 运行 `npm run test -- --runInBand tests/web/feature-list-view-test.ts tests/web/ui-entrypoint-test.ts tests/meta/prompt-assets-test.ts`。
2. 运行 `npm run build`。
3. 使用当前数据库核对“系统提示词优化0511”的 `development #3` 来源：用户选择 `2` 后由 restart development workflow 创建，属于合法 stage 切换。

## 风险与决策记录

1. 已撤回错误方向：不能为了让旧对话都可见而把 Feature 展开区改成所有 stage conversations 混合列表。
2. 已确认 `development #3` 是用户授权后的合法行为，不是 Snail 擅自推进。
3. 如果后续需要历史 conversation 总览，应作为独立 UI 能力设计，不能污染当前 stage 工作入口。
4. “当前 stage conversation 为空”与“历史记录丢失”是两类问题。前者应通过来源 conversation 入口显式解释和承接，后者才需要检查持久化数据。
5. 已撤回“新 stage 自动投递启动消息”的错误方向；正确边界是禁止 Snail 主动推进或修改工作流状态，避免产生未经用户明确触发的半启动状态。

## 范围变更记录

1. 初始修复曾误判为 Feature 历史 conversation 完整展示问题，实际应修正为当前 stage conversation 选中和展示语义；因此撤回全量 Feature conversations 方案，并更新本文档记录正确边界。
2. Review 阶段复核发现仅确认 current stage 选中语义仍不足以解释用户看到的空白；当前 `review #4` conversation 存在但消息数为 0，且通过 `from_conversation_ids` 指向上一 stage，因此本次范围扩展为消息区空态来源入口，而不是 Feature 左侧全量历史列表。
3. 用户进一步指出问题本质不是自动启动新 stage，而是不应允许 Snail 主动推进 stage 或修改工作流状态；本次撤回自动投递启动消息方案，改为沉淀工作流状态变更权限约束，并保留来源入口异步快切竞态修复。
