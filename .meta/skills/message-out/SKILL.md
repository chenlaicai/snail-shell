---
name: message-out
description: 将语义上正确的结论封装为 Snail Shell 正式消息。用于所有最终正式回复、带 mention 的回复、问题卡片与问题回答。不要手写等价 JSON 协议。
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

1. 先想清楚你要表达的自然语言语义。
2. 再选择合适的 `message-out` 子命令。
3. 只输出该命令生成的正式 payload。

最终对外只能出现一条正式结构化消息。

## Commands

统一命令路径：`node dist/src/bin/message-out.js`

### 文本回复

```bash
node dist/src/bin/message-out.js text
```

### 用户问题卡片

```bash
node dist/src/bin/message-out.js question
```

### 用户问题回答

```bash
node dist/src/bin/message-out.js question-response
```

## Hard Rules

1. 不要直接输出手写 JSON。
2. 不要输出旧的 `{ content, mentions }` 包装对象作为正式协议。
3. 需要 mention 时，只在 `structured_text` 中通过 `mentions` 声明。
4. 需要向用户提问时，先确定问题语义，再使用 `message-out question`。
5. 用户对问题卡片的回答，应作为 `question_response` 处理。
