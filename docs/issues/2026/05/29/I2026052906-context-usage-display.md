---
id: I2026052906
title: context-usage-display
from_ids: []
tags: []
modules: []
doc_kind: spec
---

# I2026052906 [agent] 上下文用量显示改进

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

用户在 `config/snail-den.json` 中配置了 Snail 的 `contextWindow`（如 100000），但消息头显示的上下文最大长度却是 200000。原因是 Claude Code CLI 返回的 `modelUsage.contextWindow` 值（硬编码 200000）优先于用户配置值。

用户反馈：配置项没有说明 CLI 返回值会优先，导致用户无法理解显示值的来源。

另外，流式过程中不显示上下文用量信息（显示为空），流式结束后才显示。原因是 Claude Code CLI 只在 `result` 消息中返回 usage 数据，流式 `assistant` 消息不包含 usage。

## 目标

1. 在配置项处增加说明，让用户知道 `contextWindow` 的优先级规则
2. 流式过程中，当 usage 数据尚未到达时，在 UI 上显示占位符（如 `- / -`）表示"暂时没有数据"

## 非目标

- 不修改 `runtime-usage.ts` 中的优先级逻辑（保持 CLI 返回值优先）
- 不在流式过程中估算或预测 usage 数据

## 设计

### P1 详设：配置说明

在 `config/snail-den.json` 的 `contextWindow` 字段处增加注释，说明：
- 此值为 Snail 的上下文窗口大小配置
- 如果 agent 运行时返回了 `contextWindow` 值，将以运行时返回值为准
- 此配置仅在运行时未返回值时生效

### P2 详设：流式占位符

在 `src/web/message-view.js` 的 `buildRuntimeUsageView` 函数中：
- 当 `usageEvents` 为空数组时（流式过程中），返回占位显示而非 `null`
- 占位显示格式：`- / -`（表示"用量数据尚未到达"）
- 样式与正常用量显示一致，但使用灰色或半透明以示区别

## 生效路径

- 配置说明：`config/snail-den.json` 中的注释
- 占位显示：`src/web/message-view.js` 中的 `buildRuntimeUsageView` 函数

<!-- [design-time] 章节结束 -->

## 改动范围

1. `config/snail-den.json` — 增加 `contextWindow` 字段的注释说明
2. `src/web/message-view.js` — 修改 `buildRuntimeUsageView` 函数，增加流式中占位显示

## 验证

### P1

- [ ] 在 `config/snail-den.json` 中能看到 `contextWindow` 字段的注释说明
- [ ] 注释清晰解释了优先级规则

### P2

- [ ] 流式过程中，消息头显示 `- / -` 占位符
- [ ] 流式结束后，占位符被实际用量数据替换
- [ ] 占位符样式与正常用量显示一致但有视觉区分

### 通用

- [ ] 已有功能（OpenCode/Codex 的流式 usage 显示）不受影响

## 关联

无

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 是否修改优先级逻辑 | 不修改，保持 CLI 返回值优先，仅增加配置说明 | 2026-05-29 |
| 2 | 流式占位符格式 | 使用 `- / -` 表示"暂时没有数据" | 2026-05-29 |

## 范围变更记录

无
