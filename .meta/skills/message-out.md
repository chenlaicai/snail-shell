---
name: message-out
title: Message Out Protocol
type: rule-skill
scope:
  stage_types: [init, discuss, coding, check, publish]
  snails: [owner, product_agent, design_agent, implementation_agent, acceptance_agent]
activation:
  inject_into: system
  condition: always
---

# Message Out Protocol

## Purpose

你只负责先形成语义上正确的结论，再通过统一的 `message-out` 机制把它封装成正式消息。

系统中只有这一处定义正式输出协议。不要自己手写 JSON 结构，不要混用旧格式，不要输出演示草稿再补正式结果。

## Output Boundary

正式输出只允许以下四种意图：

1. 普通文本回复
2. 带 mention 的文本回复
3. 用户问题卡片
4. 用户问题回答

它们最终统一映射到系统消息模型：

1. `plain_text`
2. `structured_text`
3. `question`
4. `question_response`

## Working Rule

内部工作方式固定为：

1. 先想清楚你要表达的自然语言语义
2. 再选择合适的 `message-out` 子命令
3. 只输出该命令生成的正式 payload

这只是内部生成顺序，不是对外双阶段输出。最终对外只能出现一条正式结构化消息。

## Commands

统一脚本路径：`.meta/scripts/message-out`

### 1. 文本回复

用于普通文本和带 mention 的文本回复。

命令：

```bash
.meta/scripts/message-out text
```

输入 payload：

```json
{
  "format": "plain_text",
  "content": "已完成需求澄清。"
}
```

如果需要 mentions：

```json
{
  "format": "structured_text",
  "content": "请 @Design Snail 继续补齐交互方案。",
  "mentions": ["Design Snail"]
}
```

### 2. 用户问题卡片

命令：

```bash
.meta/scripts/message-out question
```

输入 payload：

```json
{
  "format": "question",
  "title": "需要你的确认",
  "question": "这次协议重构是否同时删除旧 skill 文件？",
  "reason": "这会影响 prompt 注入与回归范围。",
  "selection_mode": "single",
  "options": [
    { "key": "delete", "label": "直接删除" },
    { "key": "phase_out", "label": "分阶段下线" }
  ]
}
```

### 3. 用户问题回答

命令：

```bash
.meta/scripts/message-out question-response
```

输入 payload：

```json
{
  "format": "question_response",
  "response_to": { "title": "需要你的确认" },
  "selection_mode": "single",
  "selected_options": [
    { "key": "delete", "label": "直接删除" }
  ],
  "summary": "选择直接删除旧 skill 文件。"
}
```

## Hard Rules

1. 不要直接输出手写 JSON。
2. 不要输出旧的 `{ content, mentions }` 包装对象作为正式协议。
3. 不要输出数组形式的多段结构化消息。
4. 不要把 question JSON 再包进文本字段。
5. 需要 mention 时，只在 `structured_text` 中通过 `mentions` 明确声明。
6. 需要向用户提问时，先决定问题语义，再使用 `message-out question` 输出。
7. 用户对问题卡片的回答，应作为 `question_response` 处理，而不是普通文本猜测。
