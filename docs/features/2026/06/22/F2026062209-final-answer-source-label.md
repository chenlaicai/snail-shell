---
id: F2026062209
title: final-answer-source-label
from_ids:
  - F2026062204
tags:
  - web
  - conversation
  - message-context
modules:
  - web
doc_kind: spec
---

# F2026062209 [feature] 最终答复来源标签

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

后端在消息完成时会生成 `MessageContext`，记录最终答复的来源类型（`kind` 字段）和内容（`context` 字段）。

PR409（F2026062204-streaming-events-realtime-display）已完成：
- 使用 `message.context.context` 作为最终答复内容 ✅
- 流式过程 events 实时展示 ✅

但当前 UI **没有展示 `MessageContext.kind`**，用户无法知道这个最终答复是怎么生成的：
- 是从 text 事件直接提取的？
- 还是 LLM 摘要压缩的？
- 还是 MCP 返回的 body？

## 目标

在最终答复区域展示 `MessageContext.kind` 作为来源标签，让用户清楚答复的生成方式。

## 非目标

- 不修改后端 `MessageContext` 生成逻辑
- 不修改 `MessageContext.kind` 的枚举值
- 不改变最终答复的渲染方式（仍使用 `message.context.context`）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当消息有 `context` 且 `kind` 为 `final_text` 时 | 最终答复区域显示 `final_text` 标签 | 人工验证（前端无测试基础设施） |
| B2 | 当消息有 `context` 且 `kind` 为 `message_out` 时 | 最终答复区域显示 `message_out` 标签 | 人工验证 |
| B3 | 当消息有 `context` 且 `kind` 为 `event_summary` 时 | 最终答复区域显示 `event_summary` 标签 | 人工验证 |
| B4 | 当消息有 `context` 且 `kind` 为 `llm_summary` 时 | 最终答复区域显示 `llm_summary` 标签 | 人工验证 |
| B5 | 当消息有 `context` 且 `kind` 为 `mcp_final_body` 时 | 最终答复区域显示 `mcp_final_body` 标签 | 人工验证 |
| B6 | 当消息没有 `context` 时 | 不显示来源标签 | 人工验证 |
| B7 | 当消息有 `context` 且 `kind` 不在已知列表中时 | 显示原始 kind 值 | 人工验证 |

## 设计

### 1. MessageContext.kind 定义

```typescript
// 后端已定义，前端直接引用
type MessageContextKind = "final_text" | "message_out" | "event_summary" | "llm_summary" | "mcp_final_body";
```

### 2. 显示文案

**直接使用 `kind` 原始值**，不维护额外的文案映射。

理由：
- kind 原始值本身就是字面意义（如 `mcp_final_body` 一看就知道来自 MCP）
- 用户关心的是来源类型（mcp / llm / 系统），不是抽象名词
- 减少维护成本，后端新增 kind 值时前端无需更新

### 3. UI 展示位置

在最终答复区域的**右上角**展示来源标签，样式为小型 badge。

```
┌─────────────────────────────────────────┐
│                              [llm_summary] │
│                                         │
│ 这里是最终答复内容...                     │
│                                         │
└─────────────────────────────────────────┘
```

**样式约束**：
- 标签使用 `select-none`，避免用户误操作选中文本
- 字体大小：`text-[10px]` 或 `text-[11px]`
- 与消息头的 `contextUsage` badge 形成视觉一致性

### 4. 实现位置

`src/web/components/ChatMessage.tsx` 中的最终答复渲染区域。

当前代码结构：
```typescript
{hasContext ? (
  <RichTextRenderer content={message.context!.context} />
) : message.content ? (
  <RichTextRenderer content={message.content} />
) : (
  <EventTextContent events={message.events} />
)}
```

需要在 `hasContext` 分支中添加 `message.context!.kind` 的展示。

## 生效路径

- 前端代码：`src/web/components/ChatMessage.tsx`
- 后端类型：`v1/src/shared/domain-types.ts`（`MessageContextKind` 定义）

## 设计约束摘要

- **边界**：只修改前端展示，不修改后端逻辑
- **关键决策**：直接使用 `MessageContext.kind` 原始值作为来源标签，不维护额外的文案映射
- **语义不变量**：`MessageContext.kind` 的值由后端 `buildTerminalMessageContext()` 生成，前端只读取展示

## task_anchor

```yaml
change_type: feature
verification_commands: []
```

- **change_type**: feature（新增 UI 展示功能）
- **verification_commands**: 留空，开发者按默认模板执行正向 + 边界 case 验证

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/web/components/ChatMessage.tsx` | 新增 | 在最终答复区域展示 `message.context.kind` 标签 |

## 验证

- [x] 消息完成后，最终答复区域显示来源标签
- [x] 不同 kind 显示对应的文案
- [x] 没有 context 的消息不显示标签
- [x] 用户消息不显示标签

## 关联

- **前置**: F2026062204（PR409，已完成"使用 context 作为最终答复"）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 显示文案命名风格 | 使用中文，面向用户 | 可能与后端术语不一致 | 使用中文显示文案 | 面向用户的产品，应使用用户能理解的语言 | 架构师-1, 架构师-2 | 2026-06-22 |
| D2 | `message_out` 显示文案 | "内容输出"更通用 | "结构化答复"更准确反映数据模型（blocks 数组） | 结构化答复 | `content_block` 本身就是结构化的（有 blocks 数组），"结构化答复"准确反映数据模型 | 架构师-1, 架构师-2 | 2026-06-22 |
| D3 | 标签展示位置 | 左上角符合阅读顺序 | 右上角不干扰主要内容阅读，与 contextUsage badge 视觉一致 | 右上角 | 标签是元信息，不是主要内容；右上角与消息头 badge 形成视觉一致性 | 架构师-1, 架构师-2 | 2026-06-22 |
| D4 | 未知 kind 值处理 | 显示"未知"或空白 | 直接显示原始值可运行时发现问题 | 直接显示原始值 | 防御性编程，后端可能新增 kind 值，显示原始值比空白更好 | 架构师-1, 架构师-2 | 2026-06-22 |
| D5 | 交互需求 | 可点击查看详情 | 纯展示更简单 | 纯展示，select-none | 当前需求是"让用户知道答复来源"，不是"提供来源详情" | 架构师-1, 架构师-2 | 2026-06-22 |
| D6 | 显示文案最终方案 | 使用中文映射，更易读 | 直接使用 kind 原始值，字面意义清晰，减少维护成本 | 直接使用 kind 原始值 | 用户关心来源类型（mcp/llm/系统），不是抽象名词；后端新增 kind 值时前端无需更新 | 用户, 架构师-1, 架构师-2 | 2026-06-22 |

## 范围变更记录

### 2026-06-22 重新定义

**变更内容**：
- 原文档描述的是"从 MessageEvent 提取最终答复"，与 PR409 功能重复
- 重新定义为"展示 MessageContext.kind 来源标签"

**变更原因**：
- PR409 已完成"使用 context 作为最终答复"
- 本次 feature 核心是"让用户知道答复来源"

**影响范围**：
- `src/web/components/ChatMessage.tsx`：添加来源标签展示

### 2026-06-22 交叉审视收敛

**变更内容**：
- 更新显示文案：`message_out` → 结构化答复、`event_summary` → 过程摘要、`mcp_final_body` → 工具输出
- 确定标签位置：右上角
- 添加 B7 场景：未知 kind 值直接显示原始值
- 确认纯展示无交互，标签使用 `select-none`

**变更原因**：
- 架构师-2 审视指出原方案问题
- 两位架构师达成共识

**影响范围**：
- 设计章节更新
- 核心业务行为列表更新（新增 B7）
- 关键决策记录更新（D1-D5）

### 2026-06-22 用户反馈：直接使用 kind 原始值

**变更内容**：
- 删除显示文案映射表
- 核心业务行为更新：直接显示 kind 原始值（`final_text`、`llm_summary` 等）
- 设计约束摘要更新：不维护额外的文案映射

**变更原因**：
- 用户反馈：kind 原始值本身就是字面意义，不需要额外的抽象名词
- 用户关心的是来源类型（mcp / llm / 系统），不是抽象的"文本答复"、"结构化答复"

**影响范围**：
- 核心业务行为表格更新
- 设计章节更新（删除显示文案映射表，改为直接使用 kind 原始值说明）
- 设计约束摘要更新
- 关键决策记录更新（新增 D6）
