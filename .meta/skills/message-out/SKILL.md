---
name: message-out
description: 将需要结构化呈现的内容封装为 Snail Shell 消息内容块。用于突出总结、带 mention 的文本、问题卡片、问题回答和引用卡片。它不是发言或发送工具；使用命令生成 payload 后，仍要把该 payload 作为自己的消息内容返回。
---

# Message Out Protocol

## Purpose

你只负责先形成语义上正确的内容，再通过统一的 `message-out` 机制把它封装成 Snail Shell 可识别的消息内容块。

`message-out` 是内容结构化规范工具，不是发言工具，也不会替你发送消息。使用命令生成 payload 后，必须把生成的 payload 作为自己的消息内容返回；不要只把它留在工具输出中。不要自己手写 JSON 结构，不要混用旧格式。

## Output Boundary

结构化消息内容当前优先支持以下几种意图：

1. 需要结构化包装的文本
2. 带 mention 的文本回复
3. 用户问题卡片
4. 用户问题回答
5. markdown 内容块
6. 表格块
7. artifact 引用卡片
8. reference 引用卡片

它们统一映射到系统消息模型中的 `content_block`：

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
3. 将命令生成的 payload 作为自己的消息内容返回。

如果只是普通过程说明或无需结构化呈现的回复，可以直接输出自然语言；不要为了使用 skill 而把所有发言都包装成 payload。

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

1. 需要结构化内容时，不要直接输出手写 JSON，应使用本 skill 生成 payload。
2. 不要输出旧的 `plain_text / structured_text / question / question_response` 正式格式。
3. 需要 mention 时，只在 `blocks[type = "text"].mentions` 中声明。
4. 需要向用户提问时，先确定问题语义，再使用 `message-out question`。
5. 用户对问题卡片的回答，应作为 `question_response` 处理。
6. 使用命令生成 payload 后，不要只停留在工具结果；必须把 payload 返回到自己的消息内容中，系统才会把它作为消息内容块处理。
