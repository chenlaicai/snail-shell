---
id: F2026062204
title: final-answer-from-context
from_ids:
  - F2026061601
tags:
  - web
  - message-renderer
  - conversation
modules:
  - web
doc_kind: spec
---

# F2026062204 [refactor] 最终答复从后端 context 获取

## 背景

F2026061601 设计了消息渲染器"过程 vs 结论分离"方案，但实现时 `extractMessageContent` 函数仍然从流式事件中提取最终答复，导致：
1. 流式过程中的 `text_event` 和最终答复重复显示
2. 最终答复来源不明确（可能来自多个 text_event）

## 改动概览

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `MessageRenderer.tsx` | 重构 | `extractMessageContent` 接收 `context` 参数，优先使用 `context.context` 作为最终答复 |
| `MessageRenderer.tsx` | 重构 | `text_event` 从 `finalBlocks` 移到 `processBlocks` |

## 核心设计决策

### 1. 最终答复来源：后端 context 权威

**决策**：`extractMessageContent` 优先使用 `msg.context.context` 作为 `finalBlocks`，不再从流式事件中提取。

**派生逻辑**：
```typescript
export function extractMessageContent(msg: {
  events?: Array<Record<string, unknown>>;
  content?: string;
  context?: { kind: string; context: string } | null;
  status?: string;
}): MessageContent {
  // 1. 如果有 content 字段（用户消息），直接使用
  // 2. 构建 processBlocks（所有流式事件，包括 text_event）
  // 3. 优先使用 context.context 作为 finalBlocks
  // 4. 如果没有 context，fallback 到原有逻辑（兼容旧数据）
}
```

**一致性约束**：
- 后端 `extractTerminalContext` 已经在消息完成时设置 `context.context`
- `context.kind` 为 `final_text` 或 `event_summary`
- 前端只需读取，不再自行提取

**好处**：
- 最终答复来源明确：后端持久化的结论
- 避免流式过程和最终答复重复
- 前端逻辑简化，只需渲染不需要提取

### 2. text_event 归入流式过程

**决策**：`text_event` 从 `finalBlocks` 移到 `processBlocks`。

**原因**：
- 流式过程中的文本块是中间产物，不是最终结论
- 最终答复应该只来自后端 context

**效果**：
- 流式过程折叠区包含所有中间事件（工具调用、文本块等）
- 最终答复区域只显示后端持久化的结论

## 测试要点

- [ ] 消息完成后，最终答复只显示后端 context.content
- [ ] 流式过程中的 text_event 显示在折叠区
- [ ] 没有 context 的消息（旧数据）fallback 到原有逻辑
- [ ] 用户消息（有 content 字段）正常显示

## 范围变更记录

### 2026-06-22 初始实现

**变更内容**：
- 修改 `extractMessageContent` 函数签名，添加 `context` 参数
- 将 `text_event` 从 `finalBlocks` 移到 `processBlocks`
- 优先使用 `context.context` 作为 `finalBlocks`

**变更原因**：
- F2026061601 设计方案要求"最终答复只保留 context.context"
- 当前实现仍从流式事件提取，导致重复显示

**影响范围**：
- `MessageRenderer.tsx`：核心逻辑修改
- `ConversationView.tsx`：调用方式更新
