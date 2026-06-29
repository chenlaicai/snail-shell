---
id: F20260629yafr
title: streaming-text-display
tags: [bugfix, web]
modules: [web]
doc_kind: spec
---

# F20260629yafr 流式过程文本内容展示修复

## 背景

用户反馈流式过程中看不到文本内容，只能看到工具调用等事件，直到消息完成才能看到最终答复。

## 问题分析

### 根因

1. **EventStream 过滤 text 事件**：`ChatMessage.tsx` 第 261 行过滤掉了 text 事件
   ```javascript
   const filtered = events.filter((e) => e.payload?.type !== "text");
   ```

2. **最终答复区依赖 context**：最终答复区优先展示 `message.context.context`，其次 `message.content`，但流式过程中这些还没有值

3. **context 设置时机**：`message_status_changed` 事件才会设置 `message.context`，这个事件只在消息完成时才会发送

### 数据流

```
流式过程中：
text event → message.events（被过滤）→ 不显示
context → null → 不显示
content → undefined → 不显示

消息完成时：
message_status_changed → message.context → 显示
```

## 历史修复

### F2026062304（已合入）

提交 `fa76bc38` 修复了这个问题：
1. EventStream 移除 text event 过滤
2. 添加 `EventTextContent` 组件，从 events 中提取 text 事件拼接为内容

### F20260625ad94（回归根因）

提交 `97dff6d1` 在优化 UI 渲染性能时，**以"减少 EventStream 渲染量"为由重新引入 text event 过滤**，违反了 F2026062304 的设计决策。

提交信息第 4 点明确写着："EventStream 过滤 text events，减少 EventStream 渲染量"

**教训**：性能优化不能以牺牲功能为代价。F20260625ad94 的审查者和作者都没有意识到这个改动会导致流式文本内容不可见的回归。

### F20260626xywd（无关）

提交 `1546c5f7` 优化 tool_call 展示，没有改变 text event 过滤逻辑。

## 设计方案

### 数据流隔离分析

**关键事实**：EventStream 和最终答复区使用**不同的数据源**，互不影响。

```
EventStream (line 258-298)
  └─ 数据源：message.events
  └─ 当前过滤了 text event ❌

最终答复区 (line 148-171)
  └─ 数据源优先级：
     1. message.context?.context （来自 MessageContext 表）
     2. message.content
     3. EventTextContent（仅当 context 和 content 都为空，且 isStreaming/interrupted/failed 时）
  └─ 不依赖 message.events（除了 EventTextContent fallback）
```

**结论**：去掉 EventStream 的 text event 过滤**不会影响最终答复区**，因为最终答复区优先使用 `message.context`，而 `message.context` 来自 MessageContext 表（通过 `extractTerminalContext` 或 `set_final_body` MCP 工具写入），与 `message.events` 无关。

### 方案一：去掉 EventStream 中的 text event 过滤（推荐）

**思路**：
- 去掉 EventStream 中的 `events.filter((e) => e.payload?.type !== "text")` 过滤
- 让流式过程中展示所有事件（包括 text、tool_call、command 等）
- 最终答复区保持不变，只展示 msg context 表

**优点**：
- 流式过程中实时展示 text 内容（用户明确要求）
- 最终答复区只展示 context 表（用户明确要求）
- 改动最小，只需删除一行过滤代码
- 数据流隔离，不影响最终答复区

**缺点**：
- text 事件在 EventStream 和最终答复区可能重复展示（但用户接受）

### ~~方案二：流式过程中在最终答复区展示 text 事件~~（已否决）

**否决原因**：
用户明确要求"最终答复区域还是只显示msg context表！！！！！不要显示msg event！！！！！"，此方案违反用户要求。

### ~~方案三：流式过程中使用独立的文本展示区~~（已否决）

**否决原因**：
用户明确要求去掉 EventStream 中的 text event 过滤，不需要额外添加新组件。

## 最终方案：方案一

### 硬约束（用户明确警告，必须严格执行）

> **用户原话**：
> "不要去动最终答复！最终答复区域还是只显示 msg context 表！！！！！不要显示 msg event！！！！！我严重警告你们，你们给我严格记录到特性文档中！！！！"

**约束解读**：
1. **流式过程**：去掉 text event 过滤，展示所有事件（包括 text）
2. **最终答复区**：只展示 msg context 表，**禁止展示 msg event**
3. **数据源隔离**：两个区域使用不同数据源，互不影响

**违反此约束的后果**：用户明确表示"严重警告"，违反将导致用户信任丧失。

### 用户明确指令（必须严格执行）

1. 流式过程过滤了 text event 这是回归问题，你们要修复，去掉这个过滤
2. 但是不要去动最终答复！最终答复区域还是只显示 msg context 表！！！！！不要显示 msg event！！！！！
3. 严重警告：严格记录到特性文档中

## 核心业务行为

### EventStream（流式过程折叠区）

1. **当消息处于 streaming 状态时**：EventStream 应展示所有事件（包括 text、tool_call、command 等）
2. **当消息处于 streaming 状态时**：EventStream 应实时更新，展示最新的事件

### 最终答复区（硬约束）

3. **当消息处于 streaming 状态时**：最终答复区应展示 context 表（如果有），**禁止展示 msg event**
4. **当消息完成且有 context 时**：最终答复区应展示 context.context
5. **当消息完成且无 context 但有 content 时**：最终答复区应展示 content
6. **当消息完成且无 context 和 content 时**：最终答复区应展示"（无文本输出）"

**硬约束**：最终答复区只展示 msg context 表，不展示 msg event。违反此约束将导致用户信任丧失。

## 教训

### F20260625ad94 违反设计决策的教训

**问题**：F20260625ad94 在优化 UI 渲染性能时，以"减少 EventStream 渲染量"为由重新引入 text event 过滤，违反了 F2026062304 的设计决策。

**根因**：
1. **审查者失职**：没有识别到这个改动会导致流式文本内容不可见的回归
2. **设计决策未持久化**：F2026062304 的设计决策没有被记录为硬约束
3. **性能优化优先于功能**：以性能为由牺牲了核心功能

**改进措施**：
1. **设计决策必须记录为硬约束**：用户明确警告必须记录到特性文档
2. **回归测试必须覆盖**：流式文本内容展示必须作为回归测试场景
3. **性能优化不能牺牲功能**：任何性能优化必须确保核心功能不受影响

## 影响范围

- `src/web/components/ChatMessage.tsx`：去掉 EventStream 中的 text event 过滤

## 测试场景

### EventStream 测试

1. 流式过程中，text 事件应实时展示在 EventStream 折叠区
2. 流式过程中，tool_call、command 等事件应正常展示
3. 中断消息时，EventStream 应展示所有事件（包括 text）

### 最终答复区测试（硬约束）

4. **流式过程中，最终答复区应展示 context 表（如果有），禁止展示 msg event**
5. **消息完成后，最终答复区应展示 context.context**
6. **消息完成且无 context 但有 content 时，最终答复区应展示 content**
7. **消息完成且无 context 和 content 时，最终答复区应展示"（无文本输出）"**

### 回归测试

8. **验证 F20260625ad94 的回归已修复**：流式过程中 text 事件应可见
9. **验证最终答复区不受影响**：去掉 EventStream 过滤后，最终答复区仍只展示 context 表
