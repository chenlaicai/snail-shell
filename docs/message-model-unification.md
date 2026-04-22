# 统一消息数据模型设计

## 文档目标

本文档定义 Snail Shell 后续重构要采用的统一消息数据模型。

这份模型要同时服务于：

- 前端实时渲染
- 系统编排层
- 后端持久化层

目标不是继续维护多套近似但不完全一致的事件/消息语义，而是把整个系统收敛为一套统一的消息语言。

本文档明确不考虑前向兼容包袱。凡与本文档冲突的旧语义、旧事件名、旧分层方式，后续实现都应以本文档为准。

## 核心结论

整个系统只围绕一个统一对象运转：

- `message`

一条 `message` 的生命周期与内容，统一由四类 `message_part` 组成：

1. `start`
2. `delta`
3. `result`
4. `end`

也就是说：

- `start` 表示开始
- `delta` 表示过程
- `result` 表示正式结论
- `end` 表示终态

## 设计原则

### 1. 全链路只保留一套消息语言

前端、系统编排层、后端持久化层，不再分别维护独立的：

- 实时事件语言
- runtime adapter 语言
- storage part 语言

后续所有层都只使用统一的消息模型：

- `message`
- `message_part`
- `start / delta / result / end`

### 2. 过程与结论必须分离

agent 在生成中的所有观察、输出、工具行为、错误细节，都属于过程态。

agent 最终要对用户表达的正式结论，必须是独立的结论态。

因此：

- `delta` 只表示过程
- `result` 只表示正式结论

不能再让前端、系统、搜索层从过程态里去猜哪一段是最终回复。

### 3. 终态必须单独表达

终态不是正文，也不是过程的一部分。

因此：

- `end` 是唯一权威终态信号
- 不能仅因过程里出现过错误细节，就自动等价于终态失败

### 4. 过程错误与终态失败必须分离

过程中的工具错误、步骤错误、重试失败，都可能被 agent 后续补救。

所以：

- 过程错误只能落到 `delta`
- `end(error)` 只表示明确终态失败

### 5. 请求失败与消息失败不是一回事

需要严格区分：

- `end(error)`：一次消息生命周期正常完成，但结局是失败
- HTTP 500：请求本身失败，没有完成一次有效消息处理

两者都存在，而且都合理。

## Message

`message` 是系统中唯一的消息实体。

它表达：

- 某个 conversation 中的一条消息记录
- 消息的生产者与引用关系
- 但不直接承载正文与生命周期细节

建议结构：

```ts
type MessageRole = "user" | "assistant" | "system"

interface Message {
  id: number
  conversation_id: string
  from_snail: string | null
  to_snails: string[]
  role: MessageRole
  quoted_message_id: number | null
  context_cutoff_at: string
  created_at: string
}
```

这里不把生命周期状态上提到 `message` 行本身。原因是：

- Snail Shell 要采用 append-only 的消息过程模型
- 增量过程必须靠追加 `message_part`
- 不应依赖反复更新 `message` 行去表达生命周期推进

## MessagePart

`message_part` 是统一消息模型的核心。

后续只保留四种 kind：

```ts
type MessagePartKind = "start" | "delta" | "result" | "end"
```

### 系统内结构

系统内部必须使用强类型结构体，不允许在业务逻辑层传播 JSON 字符串再在各处反序列化。

统一结构：

```ts
interface MessagePartBase<TKind extends MessagePartKind, TPayload> {
  id: number
  message_id: number
  kind: TKind
  payload: TPayload
  created_at: string
}
```

也就是说：

- 系统内部使用 `kind + payload`
- `payload` 必须是强类型结构体
- 编排层、前端、adapter、view model 都不应围绕字符串 JSON 直接运转

### 持久化结构

数据库层保持单一 `message_part` 表，不再拆多张子表。

建议表结构：

```ts
interface PersistedMessagePartRow {
  id: number
  message_id: number
  kind: "start" | "delta" | "result" | "end"
  payload: string
  created_at: string
}
```

其中：

- `payload` 在数据库中允许存为字符串 / JSON 字符串
- 但在系统内部必须在数据访问边界一次性解析成强类型结构体
- 不允许在前端、编排层、渲染层、协议层到处对字符串做临时 `JSON.parse`

换句话说：

- **数据库里可以是字符串**
- **系统里必须是结构体**

## 四类 Part 的正式定义

### 1. StartPart

表示一条消息生命周期开始。

它不是正文，而是统一的开始信号。

```ts
type StartPayload = {
  role: "assistant" | "system" | "user"
  snail_name?: string | null
  runtime?: string | null
}

type StartPart = MessagePartBase<"start", StartPayload>
```

### 2. DeltaPart

`delta` 统一表示消息生命周期中的过程态。

这意味着：

- 文本流式输出是 delta
- tool/mcp/skill 调用动作是 delta
- tool/mcp/skill 调用结果是 delta
- 过程中的错误细节也是 delta

这里不再通过顶层 kind 区分“文本 / 工具 / 错误”，而是统一由 `delta` 内部 subtype 区分。

```ts
type TextDelta = {
  kind: "text"
  text: string
}

type ToolCallDelta = {
  kind: "tool_call"
  tool_name: string
  call_id?: string
  input: Record<string, unknown>
}

type ToolResultDelta = {
  kind: "tool_result"
  tool_name: string
  call_id?: string
  is_error: boolean
  output_text?: string | null
  error_text?: string | null
}

type McpCallDelta = {
  kind: "mcp_call"
  server_name: string
  tool_name: string
  call_id?: string
  input: Record<string, unknown>
}

type McpResultDelta = {
  kind: "mcp_result"
  server_name: string
  tool_name: string
  call_id?: string
  is_error: boolean
  output_text?: string | null
  error_text?: string | null
}

type SkillCallDelta = {
  kind: "skill_call"
  skill_name: string
  input?: Record<string, unknown>
}

type SkillResultDelta = {
  kind: "skill_result"
  skill_name: string
  is_error: boolean
  output_text?: string | null
  error_text?: string | null
}

type ErrorObservationDelta = {
  kind: "error_observation"
  source: "runtime" | "tool" | "mcp" | "system"
  error_text: string
}

type DeltaPayload =
  | TextDelta
  | ToolCallDelta
  | ToolResultDelta
  | McpCallDelta
  | McpResultDelta
  | SkillCallDelta
  | SkillResultDelta
  | ErrorObservationDelta

type DeltaPart = MessagePartBase<"delta", DeltaPayload>
```

这套设计的关键点是：

- 顶层统一
- 过程 subtype 严格
- 过程错误也是 `delta`
- 过程错误不等于终态失败

### 3. ResultPart

`result` 表示这条消息最终正式回复的结论态。

它是系统里唯一应该被当作“这条消息正式内容”的部分。

建议约束：

- `result` 最多一条
- `result` 可以没有
- 只要有 `result`，它就是正式引用、正式展示、正式摘要的权威来源

这里需要特别强调：

- `question` 是正式消息结构，不是临时 realtime 旁路事件
- `question_response` 也是正式消息结构
- 也就是说，提问型消息和提问回应，都必须以 `result` 的一种合法 payload 形式持久化

这条约束的原因很直接：

- 如果 `question` 只做实时转发，不落库，那么刷新后它就会丢失
- 历史接口、搜索、引用回复、后续补答都会失真
- 这与“`message_id` 是唯一生命周期锚点”的目标冲突

因此，`question` / `question_response` 必须与普通文本结论一样，成为统一消息模型里的正式结论态

```ts
type PlainTextResultPayload = {
  format: "plain_text"
  content: string
}

type StructuredTextResultPayload = {
  format: "structured_text"
  content: string
  mentions?: string[]
}

type QuestionResultPayload = {
  format: "question"
  title: string
  question: string
  reason?: string
  selection_mode: "single" | "multiple"
  options: Array<{
    key: string
    label: string
    description?: string
    allow_text_input?: boolean
    text_input_label?: string
    text_input_placeholder?: string
  }>
}

type QuestionResponseResultPayload = {
  format: "question_response"
  response_to: { title: string }
  selection_mode: "single" | "multiple"
  selected_options: Array<{
    key: string
    label: string
    extra_text?: string
  }>
  summary: string
}

type ResultPayload =
  | PlainTextResultPayload
  | StructuredTextResultPayload
  | QuestionResultPayload
  | QuestionResponseResultPayload

type ResultPart = MessagePartBase<"result", ResultPayload>
```

### 4. EndPart

`end` 表示消息生命周期终止。

它是唯一权威终态信号。

```ts
type EndPayload = {
  status: "success" | "error" | "cancelled" | "interrupted"
  error_text?: string | null
  ended_by?: "runtime" | "system" | "transport" | "timeout"
}

type EndPart = MessagePartBase<"end", EndPayload>
```

最关键的语义约束：

- `end(success)`：这条消息完整处理成功结束
- `end(error)`：这条消息明确终态失败
- 不能仅因出现过错误 `delta` 就写成 `end(error)`

## 系统内统一类型

后续系统内部应只使用这套统一联合类型：

```ts
type MessagePart = StartPart | DeltaPart | ResultPart | EndPart
```

这意味着后续代码中：

- adapter 层
- 编排层
- 前端 view model
- API 输出层

都应围绕这套统一类型展开，而不是围绕字符串 JSON 直接操作。

## 实时协议

实时协议不再保留独立于消息模型的一套领域事件语言。

统一后的实时协议建议为：

```ts
type RealtimeMessageEvent =
  | {
      type: "message_start"
      message_id: number
      snail_name: string
      role: "assistant"
    }
  | {
      type: "message_part"
      message_id: number
      snail_name: string
      part: MessagePart
    }
  | {
      type: "message_end"
      message_id: number
      snail_name: string
      status: "success" | "error" | "cancelled" | "interrupted"
      final_role?: "assistant" | "system"
    }
```

这里最重要的是：

- 上层不再长期保留独立于统一消息模型的过程事件语言
- 所有过程观察都必须在 adapter 层内被翻译为统一的 `message_part`

### 关于旁路刷新通知

统一模型下不应再存在“消息已落库，请前端额外刷新”这类旁路消息通知。

后续重构目标应明确为：

- 删除所有旁路消息通知
- 任何新消息，无论来自 assistant、system 还是其他内部模块，都必须走统一的：
  - `message_start`
  - `message_part`
  - `message_end`

也就是说，最终模型中只允许存在统一消息生命周期，不允许再保留额外的消息同步旁路。

## Runtime Adapter 的职责边界

runtime adapter 依然存在，但职责变得更窄：

### Adapter 不负责

- 创建新的长期领域概念
- 让系统上层再理解一套独立 runtime 事件语言
- 通过拍脑袋推断业务终态

### Adapter 只负责

把第三方 runtime 原始协议翻译为统一消息模型可接受的东西：

1. `message_start`
2. `message_part(start / delta / result / end)`
3. `message_end`

所有消息来源都必须满足这条约束。

这包括：

- assistant runtime 产生的消息
- system notice
- workflow notice
- boss mention notice
- 未来的其他系统生成消息

不允许再保留“直接落库一条 message，再额外发一个刷新通知”的旁路模型。

## 终态语义原则

### 过程错误

第三方 runtime 中的以下内容，都只属于过程错误观测：

- 工具调用失败
- 步骤失败
- 可恢复错误信息
- 模型中途遇到的错误但又继续补救

统一后都只能落入：

- `delta(kind = error_observation)`
  或某个调用结果型 delta 中的 `is_error = true`

但它们都不能直接等价于 `end(error)`。

### 明确终态失败

只有当 runtime 原始协议能明确告诉我们“这条消息最终失败”时，才允许落：

- `end(error)`

例如当前已知：

- Claude Code: `result` 且 `is_error = true`
- Codex: `turn.failed`

如果某个 runtime 只暴露过程错误，而没有明确终态失败信号，就不能靠推断把它升级成 `end(error)`。

### 请求失败

如果发生：

- 进程退出失败
- spawn 失败
- transport 失败
- 协议解析失败
- 后处理异常

则这是请求级失败，不是正常完成的一条消息生命周期。

这类可以返回 HTTP 500。

## 系统内终态判定规则

### `end(success)`

条件：

1. runtime 调用成功返回
2. 后处理成功
3. 没有 runtime 明确给出终态失败语义

即使中途出现过多个错误 `delta`，只要 agent 最终给出有效结论，终态仍然应为 success。

### `end(error)`

条件：

1. runtime 明确给出终态失败语义
   例如 Claude `is_error`、Codex `turn.failed`
2. 或系统在消息后处理阶段明确失败，并选择将这条消息保留为失败消息

### HTTP 500

条件：

1. 请求本身失败
2. 没有完成一次有效消息处理

## 场景化消息流转样例

下面所有样例都按统一后的四段式模型表达。

### 场景 1：普通文本成功回复

#### 实时流

```json
{ "type": "message_start", "message_id": 101, "snail_name": "Owner Snail", "role": "assistant" }
{ "type": "message_part", "message_id": 101, "snail_name": "Owner Snail", "part": { "kind": "delta", "payload": { "kind": "text", "text": "先分析一下问题" } } }
{ "type": "message_part", "message_id": 101, "snail_name": "Owner Snail", "part": { "kind": "result", "payload": { "format": "plain_text", "content": "这是最终答复" } } }
{ "type": "message_end", "message_id": 101, "snail_name": "Owner Snail", "status": "success", "final_role": "assistant" }
```

#### 持久化结果

```json
{
  "message": { "id": 101, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "delta", "payload": { "kind": "text", "text": "先分析一下问题" } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "这是最终答复" } },
    { "kind": "end", "payload": { "status": "success" } }
  ]
}
```

### 场景 2：工具调用成功后给出回复

```json
{
  "message": { "id": 102, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "delta", "payload": { "kind": "text", "text": "我先检查文件" } },
    { "kind": "delta", "payload": { "kind": "tool_call", "tool_name": "Read", "input": { "file_path": "src/app.ts" } } },
    { "kind": "delta", "payload": { "kind": "tool_result", "tool_name": "Read", "is_error": false, "output_text": "...file content..." } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "问题出在这里，建议这样修改" } },
    { "kind": "end", "payload": { "status": "success" } }
  ]
}
```

### 场景 3：工具失败，但 agent 成功补救

#### 正确语义

- 有错误 `delta`
- 最终仍为 `end(success)`

```json
{
  "message": { "id": 103, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "delta", "payload": { "kind": "tool_call", "tool_name": "Read", "input": { "file_path": "missing.ts" } } },
    { "kind": "delta", "payload": { "kind": "tool_result", "tool_name": "Read", "is_error": true, "error_text": "missing.ts 不存在" } },
    { "kind": "delta", "payload": { "kind": "tool_call", "tool_name": "Search", "input": { "query": "missing.ts" } } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "我已改用搜索定位到目标文件，问题如下" } },
    { "kind": "end", "payload": { "status": "success" } }
  ]
}
```

### 场景 4：正常 error-only 结束，HTTP 200

#### 正确语义

- agent 正常完成
- 没有 `result`
- 最终 `end(error)`
- HTTP 200

```json
{
  "message": { "id": 104, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "delta", "payload": { "kind": "error_observation", "source": "runtime", "error_text": "当前权限不足，无法继续执行" } },
    { "kind": "end", "payload": { "status": "error", "error_text": "当前权限不足，无法继续执行", "ended_by": "runtime" } }
  ]
}
```

### 场景 5：question 消息

#### 正确语义

- `question` 不是旁路事件
- 它是一条正式 assistant message
- 必须有 `result(format = "question")`
- 刷新后仍然必须存在

```json
{
  "message": { "id": 105, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    {
      "kind": "result",
      "payload": {
        "format": "question",
        "title": "需要你的确认",
        "question": "请选择一个方案",
        "selection_mode": "single",
        "options": [
          { "key": "a", "label": "方案 A" },
          { "key": "b", "label": "方案 B" }
        ]
      }
    },
    { "kind": "end", "payload": { "status": "success", "ended_by": "runtime" } }
  ]
}
```

### 场景 6：question_response 消息

#### 正确语义

- 用户对 question 的回答，仍然是一条正式消息
- 它不是 question 的附属临时状态
- 它应作为一条新的 `result(format = "question_response")` 消息记录沉淀

```json
{
  "message": { "id": 106, "role": "user", "from_snail": "Boss Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "user", "snail_name": "Boss Snail" } },
    {
      "kind": "result",
      "payload": {
        "format": "question_response",
        "response_to": { "title": "需要你的确认" },
        "selection_mode": "single",
        "selected_options": [
          { "key": "a", "label": "方案 A" }
        ],
        "summary": "选择了方案 A"
      }
    },
    { "kind": "end", "payload": { "status": "success", "ended_by": "system" } }
  ]
}
```

### 场景 7：后处理失败

#### 正确语义

- runtime 返回成功
- 但系统后处理失败
- 无 `result`
- `end(error)`

```json
{
  "message": { "id": 107, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "delta", "payload": { "kind": "text", "text": "请继续处理 @Product Snail" } },
    { "kind": "end", "payload": { "status": "error", "error_text": "synthetic mention extraction failure", "ended_by": "system" } }
  ]
}
```

### 场景 6：transport / process failure，HTTP 500

#### 正确语义

- 请求级失败
- 不是正常完成的一条消息生命周期
- 返回 HTTP 500

如果系统已经创建了 `message`，也应该补一个系统可读的 `end(error|interrupted)`；如果还没来得及创建，则可以只有 HTTP 500。

```json
{
  "message": { "id": 108, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "end", "payload": { "status": "interrupted", "error_text": "runtime process exited unexpectedly", "ended_by": "transport" } }
  ]
}
```

### 场景 9：system notice

system notice 仍然是一条 `message`，而且必须走与 assistant message 同一套生命周期模型。

也就是说：

- system message 不是特殊旁路
- 不是“直接写库然后再额外发一个刷新通知”
- 它也必须有自己的 `start / result / end`

```json
{
  "message": { "id": 109, "role": "system", "from_snail": null },
  "parts": [
    { "kind": "result", "payload": { "format": "plain_text", "content": "已达到非 boss snail 协作轮次上限，转由 Owner Snail 收口。" } },
    { "kind": "end", "payload": { "status": "success", "ended_by": "system" } }
  ]
}
```

## 对前端的直接约束

前端只消费统一消息模型的实时展开：

1. `message_start`
2. `message_part`
3. `message_end`

前端判断规则必须固定为：

1. 是否结束：只看 `end`
2. 是否失败：只看 `end.status === "error"`
3. 过程怎么展示：读 `delta`
4. 最终结论怎么展示：只读 `result`
5. 过程错误不能覆盖最终成功态

## 对搜索与摘要的直接约束

自然语言语义层只应包含：

- `result`
- 必要时可选择部分人类可读 `delta`

但：

- `start`
- `end`

属于生命周期状态信息，不应污染正文摘要和全文检索。

## 后续实现改造清单

基于本文档，后续代码重构应完成以下目标：

1. 把 runtime adapter 输出统一成 `message_start / message_part / message_end`
2. 去掉长期暴露给系统上层的独立 runtime 事件词汇
3. 协作层只处理统一消息模型
4. 系统内部统一使用强类型 `payload` 结构体
5. 只有数据访问边界负责 `payload` 的序列化与反序列化
6. 前端 live / persisted 共用同一个 view model
7. 测试按本文档场景重写，而不是继续沿用旧事件层思维

## 最终结论

Snail Shell 后续要收敛的不是“UI 的 turn 和 message 合并”，而是：

整个系统只剩一个统一消息模型：

- `message`
- `message_part(kind + payload)`

其中 `message_part` 的正式四段式为：

- `start`
- `delta`
- `result`
- `end`

实时协议、系统编排、持久化存储、前端渲染，都只是这套统一模型在不同层次上的投影。
