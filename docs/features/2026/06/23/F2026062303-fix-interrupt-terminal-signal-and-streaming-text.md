---
id: F2026062303
title: fix-interrupt-terminal-signal-and-streaming-text
from_ids: [F2026062204, F2026062201]
tags: [web, streaming, bugfix]
modules: [web, issue-collaboration]
doc_kind: spec
---

# F2026062303 [web] 修复中断终态信号缺失与流式过程 text event 被过滤

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

用户反馈两个问题：

1. **中断后显示 `[signal:runtime_usage]`**：用户点击 Stop 中断 agent 后，消息最终答复区显示的是 `[signal:runtime_usage]` 等原始 event dump 内容，而非语义化的中断提示。
2. **流式过程中看不到文本描述**：流式过程中 EventStream 区域只展示 tool_call、tool_result、signal 等事件，agent 的文本输出（text event）被完全过滤，用户看不到 agent 的实时思考过程。

根因分析：

- **问题一根因**：v2 的 `collaboration.ts` 中断路径（catch 块）没有发射 `message_interrupted` terminal signal event，只设了 message status。`extractTerminalContext()` 在找不到 text event 时回退到 `summarizeEvents()`，将所有原始 event dump 成文本，`runtime_usage` signal 作为中断前最后发射的 event 出现在最后一行。对比 v1 的 `finalizeMessageLifecycle`（`message-protocol.ts:106-134`），v1 会在终态时主动发射 terminal signal event 并写入事件流。
- **问题二根因**：F2026062204 的 D2 决策中，将"最终答复区不重复展示 text"的逻辑错误地应用到了 EventStream 流式过程区。`EventStream` 过滤了 `type === "text"` 的事件（line 170），导致流式过程中 agent 的文本输出不可见。流式过程和最终答复是两个独立的展示区域，不应混淆过滤策略。

## 目标

1. 中断后 message 事件流中应有 `message_interrupted` signal event 作为终态信号
2. 中断后的最终答复区展示语义化内容（中断提示或已有的 text 内容），而非原始 event dump
3. 流式过程中 EventStream 展示所有事件类型，包括 text event

## 非目标

- 不涉及 v1 代码（`v1/src/`）
- 不改变后端 event 生成和 WebSocket 推送逻辑
- 不改变 MessageEvent / MessageContext 的领域模型
- 不改变消息完成后 EventStream 的默认折叠行为

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当用户点击 Stop 中断 agent 时 | message 事件流中应该有 `message_interrupted` signal event 作为终态信号 |
| B2 | 当 agent 被中断且事件流中无 text event 时 | 最终答复区展示固定文案（如"用户中断了本次回复"），而非原始 event dump |
| B3 | 当 agent 被中断且事件流中已有 text event 时 | 最终答复区展示已有的 text 内容（通过 `extractTerminalContext` 的 text 回退逻辑） |
| B4 | 当 agent 被中断时 | EventStream 展示完整的事件历史（含 text event），用户可展开查看 |
| B5 | 当 agent 正在流式输出时（streaming 状态） | EventStream 展示所有事件类型，包括 text event |
| B6 | 当 message 完成后 | EventStream 默认折叠，用户可手动展开查看所有事件（含 text） |

## 设计

### 变更点 1：中断路径发射 `message_interrupted` signal event

v2 的 `collaboration.ts` catch 块中，调用 `completeMessage(agentMessage.id, status)` 即可——`completeMessage` 内部已自动追加 terminal signal event（`adapter.ts:58-71`），无需手动 `appendEvent`。参照 v1 的 `terminalSignalForStatus` 模式。

signal event 结构：
```
{ type: "signal", signal: "message_interrupted" }
```

不需要携带额外信息（token 等已在 `runtime_usage` signal 中存在）。

### 变更点 2：`extractTerminalContext` 兜底策略修正

当前 `summarizeEvents()` 将所有原始 event dump 成文本作为兜底。修正策略：

- `extractTerminalContext` 在 text event 和 `mcp_final_body` 都不存在时，返回固定文案（如"用户中断了本次回复"）作为 context
- 不再使用 `summarizeEvents()` dump 原始 event 给用户

`summarizeEvents()` 方法已删除（无调用点，属死代码）。

### 变更点 3：移除 EventStream 对 text event 的过滤

F2026062204 的 D2 决策（EventStream 过滤 text events）是本次 bug 的设计根因。修正：

- 移除 `EventStream` 中 `events.filter(e => e.payload?.type !== "text")` 的过滤逻辑
- EventStream 展示所有事件类型（text、tool_call、tool_result、signal、error）
- message 完成后 EventStream 默认折叠（已有逻辑不变），用户不会主动看到重复内容
- 用户主动展开时看到完整事件流反而有诊断价值

**与 F2026062204 D2 的关系**：本次修正推翻 F2026062204 的 D2 决策。原决策将"最终答复区不重复展示 text"的逻辑错误地应用到了流式过程区。流式过程和最终答复是两个独立区域，text event 应在流式过程中实时可见。

### 设计约束摘要

- **边界**：仅修改 v2 前端（`ChatMessage.tsx`）和 v2 协作层（`collaboration.ts`），不涉及 v1
- **关键决策**：中断路径的 terminal signal event 由 `completeMessage` 内部生成（无需手动 appendEvent）；`summarizeEvents` 已删除（无调用点）；EventStream 不再过滤 text event
- **语义不变量**：message 终态必须有对应的 terminal signal event（completed/failed/interrupted）；流式过程展示所有事件类型

## 生效路径

- 代码：`src/app/issue-collaboration/collaboration.ts` — 中断路径 terminal signal + extractTerminalContext 兜底
- 代码：`src/web/components/ChatMessage.tsx` — EventStream 过滤逻辑修正
- 无配置、提示词或工作流变更

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/app/issue-collaboration/collaboration.ts` | 修改 | catch 块通过 `completeMessage` 发射 terminal signal event；`extractTerminalContext` 兜底改为固定文案；删除死代码 `summarizeEvents()` |
| `src/web/components/ChatMessage.tsx` | 修改 | 移除 EventStream 对 text event 的过滤 |

## 验证

- [ ] 中断 agent 后，message 事件流中包含 `message_interrupted` signal event
- [ ] 中断 agent 后，最终答复区不显示原始 event dump（`[signal:runtime_usage]` 等）
- [ ] 中断 agent 后，最终答复区展示语义化内容（已有 text 或固定中断文案）
- [ ] 流式过程中 EventStream 展示 text event
- [ ] message 完成后 EventStream 默认折叠，展开后可看到所有事件（含 text）

## 关联

- **相关**: F2026062204（流式过程 events 实时展示 — 本次修正推翻其 D2 决策）
- **相关**: F2026062201（Stop 中断按钮 — 本次补充其缺失的 terminal signal 逻辑）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | EventStream 是否过滤 text event | 不过滤——流式过程应展示所有事件类型，text 是 agent 实时输出的一部分 | 过滤——text 已在最终答复区展示，重复会造成困惑 | 不过滤 | 流式过程和最终答复是两个独立展示区域，不应混淆过滤策略；完成后 EventStream 默认折叠，不会造成重复困扰 | 架构师-1, 架构师-2, 用户 | 2026-06-23 |
| D2 | 中断后的 context 兜底策略 | 固定文案——原始 event dump 对用户无意义，且 `runtime_usage` 出现在最后一行造成困惑 | 保留 dump 但过滤内部 signal——保留诊断信息 | 固定文案 | `summarizeEvents` 是诊断用途，不应作为面向用户的展示；已有的 text event 通过 `extractTerminalContext` 的 text 回退逻辑正常提取 | 架构师-1, 架构师-2 | 2026-06-23 |
| D3 | `message_interrupted` signal 是否携带额外信息 | 空 signal——token 信息已在 `runtime_usage` 中存在，不需要重复 | 携带中断时的 token 统计——便于前端展示 | 空 signal | 遵循最小设计原则，不引入不必要的复杂度 | 架构师-1, 架构师-2 | 2026-06-23 |
