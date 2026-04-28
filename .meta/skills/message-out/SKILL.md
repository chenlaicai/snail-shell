---
name: message-out
description: 将语义上正确的结论封装为 Snail Shell 正式消息。用于所有最终正式回复、带 mention 的回复、问题卡片与问题回答。不要手写等价 JSON 协议。
---

# Message Out Protocol

## Purpose

你只负责先形成语义上正确的结论，再通过统一的 `message-out` 机制把它封装成正式消息。

系统中只有这一处定义正式输出协议。不要自己手写 JSON 结构，不要混用旧格式，不要输出演示草稿再补正式结果。

## Output Boundary

正式输出当前优先支持以下几种意图：

1. 普通文本回复
2. 带 mention 的文本回复
3. 用户问题卡片
4. 用户问题回答
5. markdown 内容块
6. 表格块
7. artifact 引用卡片
8. reference 引用卡片

它们最终统一映射到系统消息模型：

1. `result(format = "blocks")`
2. 文本回复进入 `blocks[type = "text"]`
3. 问题卡片进入 `blocks[type = "question"]`
4. 问题回答进入 `blocks[type = "question_response"]`
5. markdown 进入 `blocks[type = "markdown"]`
6. 表格进入 `blocks[type = "table"]`
7. artifact 引用进入 `blocks[type = "artifact_card"]`
8. reference 引用进入 `blocks[type = "reference_card"]`

## Working Rule

1. 先想清楚你要表达的自然语言语义。
2. 再选择合适的 `message-out` 子命令。
3. 只输出该命令生成的正式 payload。

最终对外只能出现一条正式结构化消息。

## Commands

统一命令路径：`node .meta/skills/message-out/message-out.js`

### 文本回复

```bash
node .meta/skills/message-out/message-out.js text
```

`text` 和 `markdown` 命令支持从 stdin 直接读取普通文本。正文包含反引号、引号、`$()` 或多行 Markdown 时，优先用单引号 heredoc 或文件/stdin 传入，不要把正文放进双引号 shell 参数，避免 shell 先执行命令替换。

### 用户问题卡片

```bash
node .meta/skills/message-out/message-out.js question
```

### 用户问题回答

```bash
node .meta/skills/message-out/message-out.js question-response
```

### Markdown 块

```bash
node .meta/skills/message-out/message-out.js markdown
```

### Table 块

```bash
node .meta/skills/message-out/message-out.js table
```

### Artifact Card

```bash
node .meta/skills/message-out/message-out.js artifact-card
```

### Reference Card

```bash
node .meta/skills/message-out/message-out.js reference-card
```

## Hard Rules

1. 不要直接输出手写 JSON。
2. 不要输出旧的 `plain_text / structured_text / question / question_response` 正式格式。
3. 需要 mention 时，只在 `blocks[type = "text"].mentions` 中声明。
4. 需要向用户提问时，先确定问题语义，再使用 `message-out question`。
5. 用户对问题卡片的回答，应作为 `question_response` 处理。
