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

### F20260626xywd（回归）

提交 `1546c5f7` 在优化 tool_call 展示时，又改回了过滤 text event 的状态，导致问题复现。

## 设计方案

### 方案一：恢复 F2026062304 的方案

**优点**：
- 已验证可行
- 流式过程中实时展示文本内容

**缺点**：
- EventStream 展示所有事件，包括 text，可能导致信息冗余
- text 事件在 EventStream 和最终答复区重复展示

### 方案二：流式过程中在最终答复区展示 text 事件

**思路**：
- 保持 EventStream 过滤 text 事件
- 在最终答复区，当 `context` 和 `content` 都为空时，从 events 中提取 text 事件拼接展示

**优点**：
- 避免信息重复展示
- 流式过程中文本内容在最终答复区实时更新

**缺点**：
- 需要修改最终答复区的逻辑

### 方案三：流式过程中使用独立的文本展示区

**思路**：
- 保持 EventStream 过滤 text 事件
- 添加一个独立的流式文本展示区，在流式过程中展示 text 事件内容
- 消息完成后，切换到最终答复区展示 context

**优点**：
- 流式过程和最终答复的展示完全分离
- 避免信息重复和状态混乱

**缺点**：
- 需要添加新的 UI 组件
- 增加代码复杂度

## 推荐方案

**方案二**：流式过程中在最终答复区展示 text 事件

### 理由

1. **最小改动**：只需修改最终答复区的逻辑，不需要添加新组件
2. **用户体验好**：文本内容始终在最终答复区展示，位置固定
3. **避免重复**：text 事件不在 EventStream 中展示，避免信息冗余

### 实现细节

```javascript
// 最终答复区逻辑修改
{hasContext ? (
  <RichTextRenderer content={message.context!.context} />
) : message.content ? (
  <RichTextRenderer content={message.content} />
) : isStreaming ? (
  // 流式过程中，从 events 提取 text 事件拼接展示
  <EventTextContent events={message.events} />
) : (
  <span className="text-text-muted italic">（无文本输出）</span>
)}
```

需要添加 `EventTextContent` 组件：

```javascript
function EventTextContent({ events }: { events: MessageEvent[] }) {
  const text = useMemo(() => {
    return events
      .filter((e) => e.payload?.type === "text" && e.payload && "text" in e.payload)
      .map((e) => (e.payload as unknown as { text: string }).text)
      .join("");
  }, [events]);

  if (!text) return <span className="text-text-muted italic">（无文本输出）</span>;
  return <RichTextRenderer content={text} />;
}
```

## 核心业务行为

1. **当消息处于 streaming 状态时**：最终答复区应实时展示 text 事件内容
2. **当消息完成且有 context 时**：最终答复区应展示 context.context
3. **当消息完成且无 context 但有 content 时**：最终答复区应展示 content
4. **当消息完成且无 context 和 content 时**：最终答复区应展示"（无文本输出）"

## 影响范围

- `src/web/components/ChatMessage.tsx`：修改最终答复区逻辑，添加 EventTextContent 组件

## 测试场景

1. 流式过程中，text 事件应实时展示在最终答复区
2. 消息完成后，应切换到 context 或 content 展示
3. 中断消息时，应展示已有的 text 事件内容
4. 无 text 事件时，应展示"（无文本输出）"
