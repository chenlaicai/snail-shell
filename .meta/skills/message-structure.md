---
name: message-structure
title: Message Structure Protocol
type: rule-skill
scope:
  stage_types: [init, discuss, coding, check, publish]
  snails: [owner, product_agent, design_agent, implementation_agent, acceptance_agent]
activation:
  inject_into: system
  condition: always
---

# Message Structure Protocol

## Purpose

定义 Snail 如何返回结构化消息，确保系统能够准确识别 mention、quote 等结构化内容。

## Message Parts 结构

消息由多个 parts 组成，每个 part 有不同的类型：

### 1. text part - 普通文本
```json
{ "part_type": "text", "text_value": "这是普通文本内容" }
```

### 2. mention part - 呼叫其他 Snail
```json
{ "part_type": "mention", "text_value": "@Product Snail", "ref_value": "product_agent" }
```

**重要规则**：
- `text_value` 是展示文本，格式为 `@<Snail展示名>`
- `ref_value` 是 snail 的系统标识符（name）
- 只有在**明确需要呼叫、指派或请求某个 Snail 参与**时才使用 mention part
- **自我介绍、描述、引用时不要使用 mention part**，直接用 text part

### 3. result part - 结论性内容
```json
{ "part_type": "result", "text_value": "这是结论性内容" }
```

### 4. quote part - 引用之前的消息
```json
{ "part_type": "quote", "ref_value": "123", "json_value": "{\"message_id\":123,...}" }
```

## 如何返回结构化消息

当你需要在回复中 mention 其他 Snail 时，必须返回结构化的 parts 数组：

### 示例 1：单个 mention
```json
[
  { "part_type": "text", "text_value": "需求分析完成，请 " },
  { "part_type": "mention", "text_value": "@Design Snail", "ref_value": "design_agent" },
  { "part_type": "text", "text_value": " 继续设计方案。" }
]
```

### 示例 2：多个 mention
```json
[
  { "part_type": "text", "text_value": "请 " },
  { "part_type": "mention", "text_value": "@Product Snail", "ref_value": "product_agent" },
  { "part_type": "text", "text_value": " 和 " },
  { "part_type": "mention", "text_value": "@Design Snail", "ref_value": "design_agent" },
  { "part_type": "text", "text_value": " 一起讨论需求。" }
]
```

### 示例 3：纯文本回复（无 mention）
```json
[
  { "part_type": "text", "text_value": "我是 Owner Snail，负责推动项目目标明确。当前项目处于初始化阶段。" }
]
```

**注意**：示例 3 中虽然提到了 "Owner Snail"，但这是自我介绍，不是呼叫，所以不使用 mention part。

## Snail 标识符映射

当前参与的 Snails 及其标识符：
- Owner Snail → `owner`
- Product Snail → `product_agent`
- Design Snail → `design_agent`
- Implementation Snail → `implementation_agent`
- Acceptance Snail → `acceptance_agent`
- 老大/Boss → `boss`

## 什么时候使用 mention

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

## 输出格式

**关键要求**：当你需要返回结构化消息时，必须直接输出 JSON 数组，**不要使用 markdown 代码块包裹**。

### 正确示例（直接输出 JSON）：
[
  { "part_type": "text", "text_value": "好的，让我呼叫 Product Snail。" },
  { "part_type": "mention", "text_value": "@Product Snail", "ref_value": "product_agent" },
  { "part_type": "text", "text_value": " 请你来打个招呼。" }
]

### 错误示例（不要这样做）：
```json
[
  { "part_type": "text", "text_value": "..." }
]
```

**再次强调**：不要使用 ```json 代码块，直接输出 JSON 数组。

## 兼容性说明

如果你不确定如何返回结构化消息，可以在纯文本中使用 `@<Snail展示名>` 格式，系统会尝试自动解析。但**强烈建议**直接返回结构化 parts 数组，以确保准确性。
