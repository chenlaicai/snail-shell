---
id: F2026062204
title: streaming-events-realtime-display
from_ids: []
tags: [web, streaming, ux]
modules: [web]
doc_kind: spec
---

# F2026062204 [web] 流式过程 events 实时展示

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 ChatMessage 组件在 `isStreaming`（status === "streaming"）期间，只通过 `EventTextContent` 展示 text 类型的 events，而 `EventStream`（展示 tool_call、tool_result 等中间过程）被 `!isStreaming && hasEvents && hasContext` 条件门控，仅在消息完成后才渲染。

这导致用户在流式过程中看到的现象：一个消息框卡住不动（仅有 text 内容逐步加载和闪烁光标），所有 tool_call、tool_result 等中间过程完全不可见。用户期望类似 Claude Code CLI / OpenCode 的体验——每一条 event 实时展示出来。

同时发现 `extractContextUsage()` 存在类型不匹配 bug：检查 `event.payload?.type === "runtime_usage"`，但实际 payload 结构为 `{ type: "signal", signal: "runtime_usage", ... }`，导致 context usage 指示器永远不会渲染。

## 目标

流式过程中，每一条 event（tool_call、tool_result、text 等）实时展示在消息区域，用户可以看到 Agent 的完整工作过程。消息完成后，流式过程折叠，最终答复突出展示。

## 非目标

- 不改变后端 event 生成和推送逻辑（当前 WebSocket 推送已正常工作）
- 不改变 MessageEvent / MessageContext 的领域模型
- 不改变"流式过程"与"最终答复"的语义区分
- 不改变消息完成后 EventStream 的折叠展示方式

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当 Agent 消息有非 text events 时（streaming / completed / failed / interrupted） | 流式过程区域展示非 text events；streaming 时自动展开，其他状态默认折叠 |
| B1a | 当 streaming 期间过滤后无非 text events 时 | EventStream 展开但不显示 "0 events" 摘要行，展开区域留空 |
| B1b | 当 event 为 signal 或 error 类型时 | EventItem 正确渲染（signal 显示信号名，error 显示错误信息），不静默丢失 |
| B2 | 当 Agent 消息从 streaming 变为 completed 时 | 流式过程区域自动折叠为摘要行（N events · X tool calls），最终答复区域展示 context |
| B3 | 当 streaming 过程中有 text event 到达时 | text 内容仅在最终答复区域实时累积展示，不在流式过程区域重复展示 |
| B4 | 当消息已完成且用户点击折叠行时 | 展开/折叠流式过程 events 列表，只展示非 text events（tool_call、tool_result、signal、error） |
| B5 | 当 event payload 中包含 runtime_usage signal 时 | 消息头部正确显示 context usage 指示器 |

## 设计

### 问题分析

**根因 1：EventStream 渲染条件门控**

`ChatMessage.tsx:94` 的渲染条件：
```tsx
{!isStreaming && hasEvents && hasContext && (
  <EventStream events={message.events} />
)}
```

`!isStreaming` 确保了 streaming 期间 EventStream 完全不渲染。即使改为去掉 `!isStreaming`，还需要考虑：
- `hasContext` 在 streaming 期间为 false（context 在 complete 后才设置），所以条件本身就阻止了 streaming 期间的渲染
- EventStream 默认折叠（`useState(false)`），streaming 期间需要自动展开

**根因 2：extractContextUsage 类型不匹配**

`ChatMessage.tsx:15` 检查 `event.payload?.type === "runtime_usage"`，但 `collaboration.ts:524` 的 `mapAgentEvent()` 将 signal 类型事件映射为 `{ type: "signal", signal: agentEvent.payload.signal_type, ...data }`。因此 runtime_usage 事件的 payload 结构为 `{ type: "signal", signal: "runtime_usage", ... }`，`type === "runtime_usage"` 永远不匹配。

### 设计方案

**变更点 1：ChatMessage 渲染逻辑调整**

将 EventStream 的渲染条件从"仅完成后展示"改为"有 events 就展示"：

```
条件: hasEvents
```

有 events 就渲染 EventStream，无论消息状态（streaming / completed / failed / interrupted）。理由：失败/中断时用户更需要看到中间过程来诊断问题。

**变更点 2：EventStream 改为 controlled expanded 状态**

当前 EventStream 内部用 `useState(false)` 管理展开状态。改为由父组件通过 `expanded` prop 控制：

- 新增 `expanded: boolean` prop（替换内部 state）
- 新增 `onToggle: () => void` prop（处理用户点击折叠/展开）
- 父组件逻辑：`expanded={isStreaming || expandedByUser}`，streaming 时强制展开，完成后由用户手动控制
- 好处：streaming → completed 切换时自动折叠，无需 `key` 强制重挂载

**变更点 2a：EventStream 过滤 text 类型 events**

EventStream 的 events 列表过滤掉 `type === "text"` 的事件，只展示 tool_call、tool_result、signal、error 等中间过程事件。理由：
- text 内容已在最终答复区域实时展示，无需重复
- EventStream 的职责是展示"中间过程"，text 是"内容"不是"过程"
- 避免用户在两个区域看到重叠信息

streaming 期间过滤后无非 text events 时，EventStream 展开但不显示 "0 events" 摘要行，展开区域留空。

**变更点 2b：EventItem 补充 signal/error 渲染**

当前 EventItem 缺少 `type === "signal"` 和 `type === "error"` 的渲染分支，这两种 events 会静默丢失（返回 null）。需要补充：
- signal：显示信号名称（如 runtime_usage、step_start 等）
- error：显示错误信息

**变更点 3：streaming 期间最终答复区域行为不变**

最终答复区域的逻辑不变：
- streaming 期间：通过 `EventTextContent` 展示累积的 text 内容 + 闪烁光标
- 完成后：通过 `RichTextRenderer` 展示 context

**变更点 4：修复 extractContextUsage**

类型判断修正：`type === "runtime_usage"` → `type === "signal" && event.payload.signal === "runtime_usage"`

数据路径不变（已确认正确）：`event.payload.detail.context_window` 和 `event.payload.detail` 中的 token 数据。runtime_usage signal 由 `runtime-usage.ts:20-26` 生成，结构为 `{ type: "signal", signal: "runtime_usage", reason: string, detail: RuntimeUsageDetail }`。

### 交互流程

```
[streaming 开始]
  ↓
消息框出现，EventStream 自动展开（空列表）
  ↓
tool_call event 到达 → EventStream 实时显示 tool_call 条目
  ↓
tool_result event 到达 → EventStream 实时显示 tool_result 条目
  ↓
text event 到达 → 仅最终答复区域累积 text（EventStream 不展示 text）
  ↓
[streaming 结束，message_status_changed 到达]
  ↓
EventStream 自动折叠为摘要行
最终答复区域切换为 RichTextRenderer(context)
```

## 生效路径

- 代码：`src/web/components/ChatMessage.tsx` — 渲染逻辑和 extractContextUsage 修复
- 无配置、提示词或工作流变更

## 设计约束摘要

- **边界**：仅修改前端 ChatMessage 组件的渲染逻辑，不涉及后端、WebSocket 协议、领域模型
- **关键决策**：streaming 期间 EventStream 自动展开，完成后自动折叠——这是与 CLI 体验对齐的核心交互；expanded 由父组件 controlled 管理；失败/中断时也展示 EventStream；用户手动折叠后保持折叠（尊重操作）；EventItem 补充 signal/error 渲染
- **语义不变量**："流式过程"（events）与"最终答复"（context）的语义区分不变；streaming 期间 text 内容仅在最终答复区域累积展示，EventStream 只展示中间过程事件（tool_call、tool_result、signal、error）

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/web/components/ChatMessage.tsx` | 修改 | EventStream 渲染条件、展开状态控制、extractContextUsage 类型修复 |

## 验证

- [x] streaming 期间，tool_call / tool_result / signal / error 等非 text event 实时出现在 EventStream 区域 — 代码验证：EventStream 渲染条件 `hasEvents`（line 96），EventItem 包含 tool_call/tool_result/signal/error 分支
- [x] streaming 期间，text 内容仅在最终答复区域累积展示（EventStream 中不出现 text 条目） — 代码验证：EventStream 过滤 `type !== "text"`（line 154），最终答复区域通过 EventTextContent 展示 text
- [x] streaming 期间仅有 text events 时，EventStream 展开但不显示 "0 events" 摘要行 — 代码验证：`filteredEvents.length > 0` 条件控制摘要按钮渲染（line 165）
- [x] signal 和 error 类型 events 在 EventStream 中正确渲染（不返回 null） — 代码验证：EventItem 包含 `type === "signal"`（line 255）和 `type === "error"`（line 267）分支
- [x] 消息完成后，EventStream 自动折叠为摘要行 — 代码验证：`expandedByUser` 初始 `null`，`isStreaming` 变 false 后 `expanded` 为 false
- [x] 消息完成后，最终答复区域展示 context 内容 — 代码验证：`hasContext ? <RichTextRenderer>` 优先级最高（line 112）
- [x] 点击折叠行可展开查看完整 event 历史 — 代码验证：`onToggle` 切换 `expandedByUser`（line 100），`expanded` 控制展开（line 181）
- [x] context usage 指示器在 runtime_usage signal 到达后正确渲染 — 代码验证：`extractContextUsage` 匹配 `type === "signal" && payload.signal === "runtime_usage"`（line 16）
- [x] streaming 期间用户手动折叠 EventStream，streaming 结束后 EventStream 保持折叠状态 — 代码验证：`expandedByUser` 三态，用户操作后值为 `false`，streaming 结束后 `expanded = false`（line 99）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | streaming 期间如何展示 events | 直接复用 EventStream 组件，仅修改渲染条件和展开状态——改动最小，复用已有 UI | EventStream 是为完成后折叠场景设计的，streaming 期间可能需要不同的 UI（如进度指示、自动滚动） | 复用 EventStream + controlled expanded | 最小改动原则；EventStream 的 EventItem 已支持所有 event 类型，UI 够用；后续如需优化 streaming 体验可单独迭代 | 架构师-1 | 2026-06-22 |
| D2 | streaming 期间 text 内容在哪些区域展示 | text 仅在最终答复区域展示，EventStream 过滤 text events——职责清晰，避免重复 | text 同时在两处展示，用户可以看到完整文本累积过程 | EventStream 过滤 text events | streaming 期间用户关心的是中间过程（tool_call 等），text 在最终答复区域实时累积已足够；避免两处重叠信息造成困惑 | 架构师-1, 架构师-2 | 2026-06-22 |
| D3 | 完成后 EventStream 的展开状态 | 默认折叠 + 保留展开按钮，用户可按需查看 event 历史 | 用户可能想默认看到完整过程 | 默认折叠 + 展开按钮 | 用户明确"流式过程和最终答复的区分不变"，完成后最终答复是主体，流式过程是辅助诊断信息 | 架构师-1, 架构师-2 | 2026-06-22 |
| D4 | 失败/中断时是否展示 EventStream | 展示——用户需要看到中间过程来诊断问题 | 失败/中断是边界场景，优先级低 | 条件简化为 `hasEvents`，有 events 就展示 | 失败/中断时诊断价值更高，不展示会丢失关键信息 | 架构师-1, 架构师-2 | 2026-06-22 |
| D5 | expanded 状态管理方式 | controlled 模式（父组件通过 expanded prop 控制）——语义清晰，streaming→completed 自动折叠 | 内部 state + defaultExpanded 更简单，但无法响应状态切换 | controlled expanded + onToggle | streaming→completed 切换时需要自动折叠，内部 state 无法响应；key 强制重挂载会丢失用户手动操作状态 | 架构师-1, 架构师-2 | 2026-06-22 |
| D6 | EventStream summary 数字含义 | 显示过滤后的数量（非 text events 数量）——描述的是区域实际展示内容 | 显示原始总数更准确 | 过滤后数量 | summary 的职责是告诉用户"这里有什么"，过滤后的数量与实际展示一致 | 架构师-1, 架构师-2 | 2026-06-22 |
| D7 | streaming 期间无非 text events 时 EventStream 行为 | 展开但留空（不显示 "0 events"）——避免视觉跳动和无意义摘要 | 隐藏 EventStream 直到有非 text event 到达 | 展开留空 | 隐藏会导致有内容时突然出现区域；"0 events" 体验差；留空最简洁 | 架构师-1, 架构师-2 | 2026-06-22 |
| D8 | EventItem 是否补充 signal/error 渲染 | 补充——否则 signal/error events 静默丢失 | 暂不处理，优先级低 | 补充 signal 和 error 渲染分支 | signal/error 是有效的中间过程事件，静默丢失会丢失诊断信息 | 架构师-1, 架构师-2 | 2026-06-22 |
| D9 | 用户 streaming 期间手动折叠后结束行为 | 保持折叠（尊重用户操作） | streaming 结束时强制展开再折叠 | 保持折叠 | 用户主动折叠说明不想看中间过程，强制展开是干扰 | 架构师-1, 架构师-2 | 2026-06-22 |
| D10 | 高频 event 场景是否需要性能优化 | 暂不优化，先验证实际性能 | 需要提前优化（React.memo、虚拟化） | 暂不优化 | 当前 event 频率未知，过度优化可能引入不必要的复杂度；必要时再迭代 | 架构师-1, 架构师-2 | 2026-06-22 |
| D11 | hasEvents 条件下去掉 hasContext 后 final reply 区域行为 | 保持当前逻辑不变——hasContext 时 RichTextRenderer，否则 EventTextContent 提取 text | 需要额外处理无 context 时隐藏 final reply 区域 | 保持不变 | EventStream 展示过程，final reply 展示文本，职责分离正确；failed/interrupted 无 text 时显示 "No content" 是可接受的边界行为 | 架构师-1, 架构师-2 | 2026-06-22 |
