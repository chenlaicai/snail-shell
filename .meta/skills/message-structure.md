---
name: message-structure
title: Message Structure Protocol
type: rule-skill
scope:
  stage_types: [init, discuss, coding, check, publish]
  snails: ["Owner Snail", "Product Snail", "Design Snail", "Implementation Snail", "Acceptance Snail"]
activation:
  inject_into: system
  condition: always
---

# Message Structure Protocol

## Purpose

定义 Snail 如何返回结构化消息，确保系统能够准确识别 mention 等结构化内容。

## 新的消息格式（简化版）

从现在开始，你只需要返回一个简单的对象或纯文本：

### 格式 1：带 mentions 的结构化对象（推荐）
```json
{
  "content": "需求分析完成，请 @Design Snail 继续设计方案。",
  "mentions": ["Design Snail"]
}
```

### 格式 2：纯文本（系统会自动解析 mentions）
```
需求分析完成，请 @Design Snail 继续设计方案。
```

**重要**：不要使用 markdown 代码块包裹 JSON，直接输出即可。

## Mentions 规则

### 什么时候使用 mention

**应该使用 mention 的场景**：
- 明确呼叫某个 Snail 参与讨论
- 指派任务给某个 Snail
- 请求某个 Snail 处理或确认
- 需要某个 Snail 的专业意见

**不应该使用 mention 的场景**：
- 自我介绍："我是 Owner Snail"
- 描述职责："Owner Snail 负责..."
- 历史回顾："之前 Product Snail 说过..."
- 一般性讨论："这个问题需要 Design Snail 的专业领域知识"

### Mentions 数组格式

在 `mentions` 数组中，使用完整的 Snail 名称：

```json
{
  "content": "请 @Product Snail 和 @Design Snail 一起讨论需求。",
  "mentions": ["Product Snail", "Design Snail"]
}
```

## Snail 标识符

当前参与的 Snails 及其标识符：
- Owner Snail → `"Owner Snail"`
- Product Snail → `"Product Snail"`
- Design Snail → `"Design Snail"`
- Implementation Snail → `"Implementation Snail"`
- Acceptance Snail → `"Acceptance Snail"`
- Boss Snail → `"Boss Snail"`

## 示例

### 示例 1：单个 mention（结构化格式）
```json
{
  "content": "需求分析完成，请 @Design Snail 继续设计方案。",
  "mentions": ["Design Snail"]
}
```

### 示例 2：多个 mentions（结构化格式）
```json
{
  "content": "请 @Product Snail 和 @Design Snail 一起讨论需求。",
  "mentions": ["Product Snail", "Design Snail"]
}
```

### 示例 3：纯文本回复（无 mention）
```
我是 Owner Snail，负责推动项目目标明确。当前项目处于初始化阶段。
```

### 示例 4：纯文本格式（系统自动解析）
```
需求分析完成，请 @Design Snail 继续设计方案。
```

## 兼容性说明

系统支持三种输入格式：
1. **结构化对象**（推荐）：`{ "content": "...", "mentions": [...] }`
2. **纯文本**：系统会自动尝试从文本中提取 `@Snail Name` 格式的 mentions
3. **结构化数组**（高级用法）：`[{ "content": "...", "mentions": [...] }, ...]`

**建议**：当你需要 mention 其他 Snail 时，使用格式 1（结构化对象），这样最准确可靠。
