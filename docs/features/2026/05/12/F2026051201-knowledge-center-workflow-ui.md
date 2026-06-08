---
id: F2026051201
title: 知识中心工作流程 UI 适配
from_ids: [F2026051107]
tags: [knowledge, ui]
modules: [knowledge_governance]
---
# F2026051201 知识中心工作流程 UI 适配

## 背景

知识中心已经落地独立知识治理业务壳和治理对话，但前端仍残留旧版“审批中心”表达：左侧入口、右侧上下文、详情空态、操作按钮和提示反馈仍暗示候选知识只需审批即可生效。这与 `docs/core/knowledge-lifecycle.md` 中定义的“候选 -> 治理对话 -> 入口校验 -> 查重定性 -> 裁决去向 -> 运行时反哺门禁”流程不一致。

## 目标

1. 让知识中心 UI 以知识治理流程为主语，不再把候选处理描述为简单审批。
2. 左侧模式、右侧上下文、详情空态和状态操作文案统一表达“待治理候选”“治理裁决”和“反哺门禁”。
3. 详情页继续保留现有 active / reject / deprecate API 操作，但把 active 表达为知识本体确认，而不是最终落地或自动反哺。
4. 测试覆盖旧审批文案不再回流到知识中心 UI 关键入口。

## 非目标

1. 本次不新增知识治理状态编辑表单。
2. 本次不改造后端 `approveKnowledge`、`rejectKnowledge` 等既有 API 命名。
3. 本次不接入知识治理对话的跳转或消息面板。
4. 本次不二次修改已合入 feature 文档。

## 设计

知识中心 UI 仍复用现有数据结构和 API，只调整用户可见的流程模型表达：候选列表入口命名为“待治理”，右侧上下文展示“待治理”“治理流程”“反哺门禁”，详情空态说明选择知识后查看来源、治理对话、裁决去向和反哺策略。

候选详情操作保留现有 `approve` API 调用，但按钮和通知改为“确认知识本体”，强调该动作只让知识进入 active 本体状态；是否进入系统提示词仍由治理裁决和 prompt 策略共同决定。

## 生效路径

1. `src/web/ui-shell.js` 更新知识中心左侧和右侧固定文案。
2. `src/web/app.js` 更新加载待治理候选失败提示。
3. `src/web/knowledge-center.js` 更新详情空态、操作文案、状态说明和治理等级说明。
4. `tests/web/knowledge-center-test.ts` 与 `tests/web/workspace-layout-test.ts` 固化新版流程文案和旧审批文案约束。

## 改动范围

1. `docs/issues/20260512/F2026051201-knowledge-center-workflow-ui.md`
2. `src/web/ui-shell.js`
3. `src/web/app.js`
4. `src/web/knowledge-center.js`
5. `tests/web/knowledge-center-test.ts`
6. `tests/web/workspace-layout-test.ts`

## 验证

1. 已执行 `npm run test -- --runInBand tests/web/knowledge-center-test.ts tests/web/workspace-layout-test.ts`。项目测试入口会先执行完整 build，再运行当前编译产物下的全部测试文件；本次 33 个编译后测试文件均通过。
2. 已执行 `npm run build` 并通过。
3. 已通过 UI 文案和布局测试约束左侧模式、右侧上下文和详情空态不再回流旧审批语义。

## 风险与决策记录

1. 决策：本次不改后端 API 命名。原因是 API 名称属于既有内部接口，用户可见问题来自 UI 语义；直接改 API 会扩大范围并影响现有测试与调用链。
2. 决策：保留 active 操作入口，但重命名为“确认知识本体”。原因是核心模型仍允许知识本体进入 active 状态，只是 active 不等同最终落地和自动反哺。

## 范围变更记录

1. 初始范围覆盖知识中心 UI 的工作流程文案、交互反馈和测试，不修改后端治理状态机。
