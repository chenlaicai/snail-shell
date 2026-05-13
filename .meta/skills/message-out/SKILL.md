---
name: message-out
description: 将需要结构化呈现的内容封装为 Snail Shell 消息内容块。用于突出总结、带 mention 的文本、问题卡片、问题回答和引用卡片。它不是发言或发送工具；使用命令生成 payload 后，仍要把该 payload 作为自己的消息内容返回。
---

# Message Out Protocol

## Purpose

你只负责先形成语义上正确的内容，再通过统一的 `message-out` 机制把它封装成 Snail Shell 可识别的消息内容块。

`message-out` 是内容结构化规范工具，不是发言工具，也不会替你发送消息。使用命令生成 payload 后，必须把生成的 payload 作为自己的消息内容返回；不要只把它留在工具输出中。不要自己手写 JSON 结构，不要混用旧格式。

## When To Use

以下场景必须使用 message-out：

1. 需要其他 Snail 继续处理、复检、回应或收口时（mention 场景）
2. 向用户提问时
3. 需要结构化展示内容时（表格、引用卡片等）
4. 回答用户问题时

以下场景不需要使用 message-out：

1. 普通过程说明或无需结构化呈现的回复
2. 直接与用户对话的普通文本

## Output Boundary

结构化消息内容当前支持以下几种意图：

1. 文本回复（可带 mention）
2. 用户问题卡片
3. 用户问题回答
4. markdown 内容块
5. 表格块
6. artifact 引用卡片
7. reference 引用卡片

## Working Rule

1. 先想清楚你要表达的自然语言语义。
2. 如果需要其他 Snail 继续处理、复检、回应或收口，这就是 mention 场景，必须在 `--mentions` 参数中声明对应 Snail 的唯一 name。
3. 再选择合适的 `message-out` 子命令。
4. 将命令生成的 payload 作为自己的消息内容返回。

如果只是普通过程说明或无需结构化呈现的回复，可以直接输出自然语言；不要为了使用 skill 而把所有发言都包装成 payload。

## Commands

统一命令路径：`node .meta/skills/message-out/message-out.js`

### 文本回复

从 stdin 读取普通文本：

```bash
echo 'hello' | node .meta/skills/message-out/message-out.js text
```

使用 `--text` 参数：

```bash
node .meta/skills/message-out/message-out.js text --text 'hello'
```

带 mention 的文本回复：

```bash
node .meta/skills/message-out/message-out.js text --text '已提交检视意见，请处理。' --mentions 'Implementation Snail'
```

同时 mention 多个 Snail：

```bash
node .meta/skills/message-out/message-out.js text --text '已提交检视意见' --mentions 'Implementation Snail' 'Acceptance Snail'
```

正文包含反引号、引号、`$()` 或多行 Markdown 时，优先用单引号 heredoc 或 stdin 传入，避免 shell 先执行命令替换。

### 用户问题卡片

```bash
node .meta/skills/message-out/message-out.js question \
  --title '需要确认' \
  --question '请选择一个方案' \
  --reason '需要确认方向后再继续' \
  --options '[{"key":"a","label":"方案A","description":"快速实现"},{"key":"b","label":"方案B","description":"完整重构"}]'
```

### 用户问题回答

```bash
node .meta/skills/message-out/message-out.js question-response \
  --title '需要确认' \
  --options '[{"key":"a","label":"方案A"}]' \
  --summary '选择了方案A'
```

### Markdown 块

从 stdin 读取：

```bash
echo '# 标题' | node .meta/skills/message-out/message-out.js markdown
```

使用 `--text` 参数：

```bash
node .meta/skills/message-out/message-out.js markdown --text '# 标题'
```

### Table 块

```bash
node .meta/skills/message-out/message-out.js table \
  --title '对比表' \
  --columns '["特性","方案A","方案B"]' \
  --rows '[["复杂度","低","高"],["风险","低","中"]]'
```

### Artifact Card

```bash
node .meta/skills/message-out/message-out.js artifact-card \
  --title '需求文档' \
  --summary 'PRD v1.0' \
  --artifact-id 'doc-123' \
  --artifact-type 'document'
```

### Reference Card

```bash
node .meta/skills/message-out/message-out.js reference-card \
  --title '相关 PR' \
  --ref-type 'message' \
  --ref-id '123' \
  --summary '之前的讨论'
```

## Hard Rules

1. 需要结构化内容时，不要直接输出手写 JSON，应使用本 skill 生成 payload。
2. 不要输出旧的 `plain_text / structured_text / question / question_response` 正式格式。
3. 需要 mention 时，只在 `--mentions` 参数中声明；不要只在正文里写 `@Snail Name`，否则结构化内容的路由语义不够明确。
4. 需要向用户提问时，先确定问题语义，再使用 `message-out question`。
5. 用户对问题卡片的回答，应作为 `question_response` 处理。
6. 使用命令生成 payload 后，不要只停留在工具结果；必须把 payload 返回到自己的消息内容中，系统才会把它作为消息内容块处理。
