---
id: F20260624ax7k
title: streaming-ui-display-fixes
from_ids: [F2026062204]
tags: [web, streaming, ux, bugfix]
modules: [web]
doc_kind: spec
---

# F20260624ax7k [web] 流式 UI 展示问题修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

基于 F2026062204 的实现，当前流式 UI 存在三个问题：

1. **Text event 重复展示**：流式过程中，text events 同时出现在 EventStream 折叠区和最终答复框，导致同一份内容展示两次
2. **Event 展示不清晰**：EventStream 中的 events 缺少结构化格式，用户只看到一堆 bash 命令，无法快速识别 event 类型和关键信息
3. **Usage 信息未显示**：消息头部的 context usage 指示器永远不渲染，用户无法看到 token 使用情况

## 目标

1. EventStream 折叠区和最终答复框职责分离，消除内容重复
2. EventStream 中的 events 采用结构化格式：`[Type] 主要信息`，command 类型支持折叠详细信息
3. 修复 usage 字段名不匹配 bug，正确显示 context usage 指示器

## 非目标

- 不改变后端 event 生成和推送逻辑
- 不改变 MessageEvent / MessageContext 的领域模型
- 不改变 WebSocket 推送协议
- 不改变 `set_final_body` MCP 工具的行为

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当 text event 到达时 | text 内容仅在 EventStream 折叠区展示，不在最终答复框重复展示 |
| B2 | 当 `message.context` 存在时 | 最终答复框展示 context 内容（由 `set_final_body` 设置） |
| B3 | 当 `message.context` 和 `message.content` 都不存在时 | 最终答复框显示灰色提示 `（无文本输出）` |
| B4 | 当 tool_call event 到达时 | EventStream 显示 `[Tool] tool_name` 格式 |
| B5 | 当 tool_result event 到达时 | EventStream 显示 `[Done] tool_name` 或 `[Failed] tool_name` 格式 |
| B6 | 当 command event 到达时 | EventStream 显示 `[Cmd] 命令摘要` 格式，点击可展开完整命令 |
| B7 | 当 command_result event 到达时 | EventStream 显示 `[Cmd OK] 命令摘要` 或 `[Cmd Failed] 命令摘要` 格式 |
| B8 | 当 signal event 到达时 | EventStream 显示 `[Signal] signal_name: summary` 格式（runtime_usage 显示 token 用量） |
| B9 | 当 error event 到达时 | EventStream 显示 `[Error] 错误摘要` 格式，点击可展开完整错误 |
| B10 | 当 usage signal 到达时 | 消息头部正确显示 context usage 指示器（如 `45k/200k (22%)`） |

## 设计

### 问题分析

**问题 1：Text event 重复展示**

根因：最终答复框存在第三级兜底逻辑 `EventTextContent`，从 events 中提取所有 text event 拼接展示。当 `message.context` 不存在时（流式过程中或 agent 未调用 `set_final_body`），最终答复框会展示 `EventTextContent` 的内容，和 EventStream 中的 text events 重复。

数据流：
```
text event 到达
  ↓
EventStream 展示 text event ←── 重复 ──→ 最终答复框展示 EventTextContent
```

**问题 2：Event 展示不清晰**

根因：`EventItem` 组件虽然按 type 分支渲染，但缺少统一的类型标签和结构化格式。所有类型都是一行平铺，没有"主要信息 + 折叠详细信息"的层次。

**问题 3：Usage 信息未显示**

根因：字段名不匹配。

| 位置 | 字段名 | 说明 |
|------|--------|------|
| 后端 `RuntimeUsageDetail` | `context_usage_ratio` | 0-1 的比例值（如 0.22） |
| 前端 `extractContextUsage` | `d.context_usage` | **不存在的字段** |

前端读取 `d.context_usage` 得到 `undefined`，转换为 `Number(undefined) = 0`，导致 `if (contextWindow && contextUsage)` 条件不满足，usage 信息永远不显示。

### 设计方案

**变更点 1：移除最终答复框的 EventTextContent 兜底逻辑**

最终答复框的展示优先级从三级简化为两级：
1. `message.context`（最高优先）：由 `set_final_body` 或 `extractTerminalContext` 设置
2. `message.content`：直接展示
3. 移除 `EventTextContent` 兜底

当 `message.context` 和 `message.content` 都不存在时，最终答复框显示灰色提示文案 `（无文本输出）`，不是空白区域。

理由：
- message events 和 message context 是两个完全独立的东西
- EventStream 折叠区负责展示所有 events（包括 text events）
- 最终答复框只负责展示独立的最终答复（context）
- 两者互不干扰，不存在从 events 提取 text 来充当 context 的逻辑

**变更点 2：EventItem 结构化格式**

为每种 event type 添加统一的类型标签和结构化格式：

| type | 标签 | 主要信息 | 详细信息 |
|------|------|----------|----------|
| tool_call | `[Tool]` | tool_name | title（如有） |
| tool_result | `[Done]`/`[Failed]` | tool_name | 错误信息（如有） |
| command | `[Cmd]` | 命令摘要（前 60 字符） | 完整命令（折叠） |
| command_result | `[Cmd OK]`/`[Cmd Failed]` | 命令摘要 | exit code + 输出（折叠） |
| text | `[Text]` | 文本摘要（前 60 字符） | 完整文本（折叠） |
| signal | `[Signal]` | signal_name: summary | detail（折叠，runtime_usage 直接显示用量） |
| error | `[Error]` | 错误摘要 | 完整错误（折叠） |

视觉规范：
- 类型标签：等宽字体，背景色区分类型，固定宽度对齐
- 主要信息：普通字体，按 Unicode 字符截断到 60 字符，超出显示 `...`
- 折叠详情：缩进，灰色字体，点击展开/收起
- 折叠区域最大高度 300px，超出部分滚动
- 成功状态：绿色图标 ✓
- 失败状态：红色图标 ✗

Signal 统一格式：
- `[Signal] signal_name: summary` 格式，保持与 `[Type] 主要信息` 一致
- runtime_usage：`[Signal] runtime_usage: 45k/200k (22%)`
- 其他 signal：`[Signal] signal_name`

**变更点 3：修复 extractContextUsage 字段名**

修正 `extractContextUsage` 函数：
1. 读取 `context_usage_ratio`（正确的字段名）而不是 `context_usage`
2. 用 `context_window * context_usage_ratio` 计算实际使用的 token 数
3. 用 `context_usage_ratio * 100` 作为百分比

注意：原来的 `type === "signal" && signal === "runtime_usage"` 判断是正确的，不需要改。

### 交互流程

```
[text event 到达]
  ↓
EventStream 折叠区显示 [Text] 文本摘要
最终答复框不展示（等待 context）
  ↓
[tool_call event 到达]
  ↓
EventStream 折叠区显示 [Tool] tool_name
  ↓
[command event 到达]
  ↓
EventStream 折叠区显示 [Cmd] 命令摘要
用户点击展开 → 显示完整命令
  ↓
[usage signal 到达]
  ↓
消息头部显示 context usage 指示器：45k/200k (22%)
  ↓
[set_final_body 调用]
  ↓
最终答复框展示 context 内容
  ↓
[streaming 结束]
  ↓
EventStream 自动折叠
最终答复框保留 context 展示
```

### 设计澄清（架构师-2 审视后补充）

**Q1: 文本截断长度**
- 按 JS `String.prototype.slice()` 的 Unicode 字符计算，不按字节
- 截断后添加 `...` 标识

**Q2: 折叠交互边界情况**
- 命令输出过长时，展开区域设置 `max-height: 300px`，超出部分滚动
- command 和 command_result 是独立的 event，各自独立折叠

**Q3: Error 和 Signal 的区分**
- Signal：统一 `[Signal] signal_name: summary` 格式，runtime_usage 显示 `45k/200k (22%)`，其他 signal 显示 signal 名称
- Error：始终支持展开，因为错误信息对诊断有价值

**自动展开/折叠行为**（继承自 F2026062204，本次不改变）：
- streaming 期间 EventStream 自动展开
- streaming 结束后自动折叠
- 用户手动折叠后保持折叠

## 生效路径

- 代码：`src/web/components/ChatMessage.tsx` — 渲染逻辑、EventItem 格式、extractContextUsage 修复
- 无配置、提示词或工作流变更

## 设计约束摘要

- **边界**：仅修改前端 ChatMessage 组件的渲染逻辑，不涉及后端、WebSocket 协议、领域模型
- **关键决策**：最终答复框只展示 context，不从 events 提取 text；EventItem 采用 `[Type] 主要信息` 结构化格式；command 支持折叠详细信息；usage 字段名修正为 `context_usage_ratio`
- **语义不变量**："流式过程"（events）与"最终答复"（context）的语义区分不变；EventStream 展示所有 events（含 text），最终答复框只展示 context

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/web/components/ChatMessage.tsx` | 修改 | 移除 EventTextContent 兜底、EventItem 结构化格式、extractContextUsage 字段名修复 |

## 验证

- [ ] B1: 流式过程中，text event 仅在 EventStream 折叠区展示，最终答复框不重复展示
- [ ] B2: 最终答复框只展示 `message.context`，无 context 时展示 `message.content`
- [ ] B3: `message.context` 和 `message.content` 都不存在时，显示灰色提示 `（无文本输出）`
- [ ] B4: tool_call 事件显示 `[Tool] tool_name` 格式
- [ ] B5: tool_result 事件显示 `[Done] tool_name` 或 `[Failed] tool_name` 格式
- [ ] B6: command 事件显示 `[Cmd] 命令摘要` 格式，支持点击展开
- [ ] B7: command_result 事件显示 `[Cmd OK] 命令摘要` 或 `[Cmd Failed] 命令摘要` 格式
- [ ] B8: signal 事件显示 `[Signal] signal_name: summary` 格式（runtime_usage 显示 token 用量）
- [ ] B9: error 事件显示 `[Error] 错误摘要` 格式，支持点击展开
- [ ] B10: 消息头部正确显示 context usage 指示器（如 `45k/200k (22%)`）
- [ ] streaming 期间 EventStream 自动展开，完成后自动折叠
- [ ] 用户手动折叠 EventStream 后，streaming 结束保持折叠状态
- [ ] 折叠区域超过 300px 时显示滚动条

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 最终答复框是否从 events 提取 text | 不提取——message events 和 message context 是两个独立的东西，职责分离 | 提取——用户在无 context 时也能看到 text 内容 | 不提取，移除 EventTextContent 兜底 | 职责分离原则；EventStream 已展示所有 events（含 text），最终答复框只展示 context | 架构师-1 | 2026-06-24 |
| D2 | EventItem 是否添加类型标签 | 添加——`[Type] 主要信息` 格式，结构清晰，快速识别 | 不添加——保持当前简洁格式 | 添加类型标签 | 用户反馈"流式过程中的event只展示了一大堆的bash，完全看不出来具体是啥"，需要结构化展示 | 架构师-1 | 2026-06-24 |
| D3 | command 类型是否支持折叠 | 支持——默认显示命令摘要，点击展开完整命令和输出 | 不支持——保持全量展示 | 支持折叠 | 保持界面简洁，避免长命令占用过多空间；用户可按需查看完整信息 | 架构师-1 | 2026-06-24 |
| D4 | usage 字段名修复方式 | 修正字段名 `context_usage_ratio`，用 `context_window * context_usage_ratio` 计算 | 保持原有字段名，修改后端输出 | 修正前端字段名 | 后端 `RuntimeUsageDetail` 结构已稳定，前端应适配后端 | 架构师-1 | 2026-06-24 |
| D5 | 空状态展示方式 | 显示灰色提示 `（无文本输出）`，不是空白区域 | 空白区域，不占空间 | 灰色提示 | 用户需要知道"没有内容"而不是"加载失败"；空白会造成困惑 | 架构师-1, 架构师-2 | 2026-06-24 |
| D6 | Signal 格式一致性 | 统一 `[Signal] signal_name: summary` 格式，runtime_usage 也遵循 | runtime_usage 特例直接显示内容 | 统一格式 | 保持 `[Type] 主要信息` 格式的一致性，避免特例化 | 架构师-1, 架构师-2 | 2026-06-24 |
