---
name: message-payload
description: 将需要结构化呈现的内容封装为 Snail Shell 消息内容块。用于突出总结、带 mention 的文本、问题卡片、问题回答和引用卡片。它是内容格式化工具，不是通信投递系统——执行命令只生成 JSON payload，不代表已送达、已通知或已呼叫到任何人。payload 仍要作为自己的消息内容返回；实际路由和投递由 Snail Shell 系统执行。
---

# Message Payload Protocol

## Purpose

你只负责先形成语义上正确的内容，再通过统一的 `message-payload` 机制把它封装成 Snail Shell 可识别的消息内容块。

`message-payload` 是内容结构化规范工具。它不会替你发送消息、通知他人或建立通信连接。使用命令生成 payload 后，必须把生成的 payload 作为自己的消息内容返回；不要只把它留在工具输出中。不要自己手写 JSON 结构，不要混用旧格式。

## Communication Boundary

`message-payload` 与消息投递的职责边界：

1. `message-payload` **只负责格式化**：将你的自然语言语义封装为结构化的 JSON payload。
2. `message-payload` **不负责投递**：payload 中声明的 mentions 是否会被实际路由、目标角色是否收到消息、对方是否会响应——这些完全由 Snail Shell 系统在消息返回后执行，`message-payload` 对此不提供任何保证。
3. **不要把"已生成 message-payload payload"等同于"已联系到对方"、"已通知对方"或"对方已收到消息"**。生成 payload 只是准备好了格式，不代表通信已经发生。

[HARD] 你是内容格式化工具的使用者，不是通信成功的判断者。不要因为你调用了 `message-payload` 就认为协作已经完成或对方已经收到通知。

## When To Use

以下场景必须使用 message-payload：

1. 需要其他 角色 继续处理、复检、回应或收口时（mention 场景）
2. 向用户提问时
3. 需要结构化展示内容时（表格、引用卡片等）
4. 回答用户问题时

以下场景不需要使用 message-payload：

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
2. 如果需要其他 角色 继续处理、复检、回应或收口，这就是 mention 场景，必须在 `--mentions` 参数中声明对应角色的唯一 name。
3. 再选择合适的 `message-payload` 子命令。
4. 将命令生成的 payload 作为自己的消息内容返回。

如果只是普通过程说明或无需结构化呈现的回复，可以直接输出自然语言；不要为了使用 skill 而把所有发言都包装成 payload。

## 消息解析机制

系统从 AI 返回的内容中提取 mentions 的流程：

1. **结构化 mentions 优先**：系统首先检查 AI 返回的内容是否包含结构化的 mentions 字段（即 `blocks[0].mentions`）。如果有，直接使用这些 mentions。

2. **LLM fallback**：如果结构化 mentions 为空，且文本中包含 `@` 符号，系统会使用 LLM 从文本中提取 mentions。但这个过程可能不够可靠。

3. **关键点**：系统只认结构化 mentions 字段，而不是文本中的 `@` 符号。因此，必须使用 `--mentions` 参数声明 mentions，而不是在文本中写 `@角色名`。

## 获取正确的角色名称

`--mentions` 参数中的角色名称必须与系统中注册的角色名称完全匹配。获取正确名称的方式：

1. 从系统提示词的 `当前参与角色` 部分获取
2. 从系统提示词的当前角色信息部分获取
3. 使用 conversation-history skill 查询历史消息中的 mentions

示例：如果系统提示词显示 `当前参与角色: 研发者, 检视者`，那么正确的名称是 `'研发者'` 和 `'检视者'`。

## Commands

统一命令路径：`node .meta/skills/message-payload/scripts/message-payload.js`

### 文本回复

从 stdin 读取普通文本：

```bash
echo 'hello' | node .meta/skills/message-payload/scripts/message-payload.js text
```

使用 `--text` 参数：

```bash
node .meta/skills/message-payload/scripts/message-payload.js text --text 'hello'
```

带 mention 的文本回复：

```bash
node .meta/skills/message-payload/scripts/message-payload.js text --text '已提交检视意见，请处理。' --mentions '研发者'
```

同时 mention 多个角色：

```bash
node .meta/skills/message-payload/scripts/message-payload.js text --text '已提交检视意见' --mentions '研发者' '检视者'
```

正文包含反引号、引号、`$()` 或多行 Markdown 时，优先用单引号 heredoc 或 stdin 传入，避免 shell 先执行命令替换。

### 用户问题卡片

```bash
node .meta/skills/message-payload/scripts/message-payload.js question \
  --title '需要确认' \
  --question '请选择一个方案' \
  --reason '需要确认方向后再继续' \
  --options '[{"key":"a","label":"方案A","description":"快速实现"},{"key":"b","label":"方案B","description":"完整重构"}]'
```

### 用户问题回答

```bash
node .meta/skills/message-payload/scripts/message-payload.js question-response \
  --title '需要确认' \
  --options '[{"key":"a","label":"方案A"}]' \
  --summary '选择了方案A'
```

可选参数 `--selection-mode`：`"single"`（默认）或 `"multiple"`，用于多选场景。

### Markdown 块

从 stdin 读取：

```bash
echo '# 标题' | node .meta/skills/message-payload/scripts/message-payload.js markdown
```

使用 `--text` 参数：

```bash
node .meta/skills/message-payload/scripts/message-payload.js markdown --text '# 标题'
```

### Table 块

```bash
node .meta/skills/message-payload/scripts/message-payload.js table \
  --title '对比表' \
  --columns '["特性","方案A","方案B"]' \
  --rows '[["复杂度","低","高"],["风险","低","中"]]'
```

### Artifact Card

`--artifact-id` 和 `--artifact-type` 为可选参数：

```bash
node .meta/skills/message-payload/scripts/message-payload.js artifact-card \
  --title '需求文档' \
  --summary 'PRD v1.0' \
  --artifact-id 'doc-123' \
  --artifact-type 'document'
```

### Reference Card

`--ref-type` 合法值：`artifact`、`conversation`、`stage`、`workspace`、`external`（其他值回退到 `message`）：

```bash
node .meta/skills/message-payload/scripts/message-payload.js reference-card \
  --title '相关 PR' \
  --ref-type 'message' \
  --ref-id '123' \
  --summary '之前的讨论'
```

### 通用 Blocks

从 stdin 读取原始 JSON 并原样输出，用于需要完全自定义 payload 结构的场景：

```bash
echo '{"format":"blocks","blocks":[{"type":"text","text":"自定义内容"}]}' | node .meta/skills/message-payload/scripts/message-payload.js blocks
```

## 完整示例：如何把命令输出作为消息内容返回

**场景**：需要让研发者继续处理某个问题。

**步骤 1**：从系统提示词中获取正确的角色名称
- 假设系统提示词显示 `当前参与角色: 研发者, 检视者`
- 正确的名称是 `'研发者'`

**步骤 2**：调用 message-payload 命令生成 payload
```bash
node .meta/skills/message-payload/scripts/message-payload.js text --text '请继续处理这个问题。' --mentions '研发者'
```

**步骤 3**：把命令输出作为自己的消息内容返回
- 命令输出是一个 JSON 对象，格式如：
```json
{
  "format": "blocks",
  "blocks": [
    {
      "type": "text",
      "text": "请继续处理这个问题。",
      "mentions": ["研发者"]
    }
  ],
  "fallback_text": "请继续处理这个问题。"
}
```
- 把这个 JSON 对象作为自己的消息内容返回，系统会自动解析并投递给研发者

## Hard Rules

1. 需要结构化内容时，不要直接输出手写 JSON，应使用本 skill 生成 payload。
2. 不要输出旧的 `plain_text / structured_text / question / question_response` 正式格式。
3. 需要 mention 时，只在 `--mentions` 参数中声明；不要只在正文里写 `@角色名`，否则结构化内容的路由语义不够明确。
4. 需要向用户提问时，先确定问题语义，再使用 `message-payload question`。
5. 用户对问题卡片的回答，应作为 `question_response` 处理。
6. 使用命令生成 payload 后，不要只停留在工具结果；必须把 payload 返回到自己的消息内容中，系统才会把它作为消息内容块处理。把 payload 返回到消息内容中不等于对方已经收到——实际投递由系统在消息返回后执行。
7. `--mentions` 参数中的角色名称必须与系统中注册的角色名称完全匹配，不能使用缩写、别名或大小写不同的名称。
8. 不要因为调用了 message-payload 就认为已成功通知或联系到目标角色。message-payload 只负责格式化，不负责投递。
