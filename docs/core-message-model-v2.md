# Snail Shell 核心消息数据模型

## 文档定位

本文档定义 Snail Shell 的核心消息数据模型。

后续凡是涉及以下内容的设计、实现、测试、评审与重构，都必须以本文档为准：

1. 数据库存储
2. TypeScript 类型
3. runtime adapter
4. 编排层消息流转
5. WebSocket 实时事件
6. HTTP 接口返回
7. 前端渲染
8. 搜索、摘要、预览、引用回复
9. 消息相关测试样例

本文档的 runtime 事实基线只有一份：

1. `docs/runtime-cli-response-baselines.md`

如果本文档与 runtime baseline 冲突，必须修改本文档，不得改写 runtime baseline。

## 裁决优先级

当不同信息源对消息模型给出不同说法时，裁决优先级固定如下：

1. `docs/runtime-cli-response-baselines.md` 中记录的 runtime 事实
2. 本文档
3. 与本文档一致的 TypeScript 类型、schema、测试
4. 其他系统文档
5. 历史设计稿、旧注释、临时讨论结论

`docs/core-message-model.md` 描述旧四段式模型，只作为当前实现背景保留，不再作为新消息模型规范入口。

---

## 术语约定

1. `必须`
   表示强制要求，不允许偏离。
2. `禁止`
   表示明确不允许出现的做法。
3. `可以`
   表示在不违反其他强制约束的前提下允许存在。
4. `消息`
   表示 conversation 中的一条正式消息实体。
5. `事件`
   表示附着在某条消息上的、严格有序的流式内容单元。
6. `内容事件`
   表示消息中对话可见的内容单元，如文本、工具调用、工具结果、命令、命令结果。
7. `信号事件`
   表示消息流中的控制信号，如开始、runtime 阶段信号、完成信号、错误信号。

---

## 核心原则

### 1. 系统只保留一个 Snail Shell 领域消息实体

整个系统只允许一个 Snail Shell 领域消息实体：

1. `message`

禁止长期维护平行主模型，例如：

1. `trace`
2. `turn`
3. `runtime_chunk`
4. `ui_message`
5. 其他与 `message` 并行、长期存在的消息主模型

### 2. 一条消息由统一事件流组成

一条消息的实际内容与状态推进，必须通过统一事件流表达：

1. `MessageEvent[]`

`MessageEvent[]` 必须严格保序。

### 3. 内容与信号进入同一模型

以下内容都必须进入同一条消息的 `MessageEvent[]`：

1. 文本
2. 工具调用
3. 工具结果
4. 命令执行
5. 命令结果
6. 开始信号
7. runtime 阶段信号
8. 完成信号
9. 错误信号

禁止把信号事件放到消息外部的长期旁路模型中。

### 4. 不存在独立正文层

系统消息模型中不存在独立的“正式正文层”。

消息本体就是完整的 `MessageEvent[]`。

文本事件是消息内容的一部分，但不享有高于其他内容事件的结构特权。

### 5. 终态不依赖正文推断

消息是否完成、失败、中断、取消，必须通过：

1. 信号事件
2. `message.status`

共同定义。

禁止通过最后一段文本、空输出、文本格式来猜终态。

### 6. runtime 原始事实不可改写

Claude、OpenCode、Codex 的原始响应结构不同。

Snail Shell 必须保留 runtime 差异，并在统一模型中显式映射为 `MessageEvent`，禁止：

1. 构造 runtime 未提供的结构事实
2. 把普通文本硬升级成 runtime 原生 result
3. 为了贴合旧模型而强制抽取独立正文层

### 7. `MessageEvent` 是唯一事件语言

流程层、存储层、接口层、前端层，都必须围绕同一套 `MessageEvent` 语义工作。

数据库表名可以与类型名不同，但字段语义必须与 `MessageEvent` 同构。

禁止出现：

1. 流程层一套事件语言
2. 持久化层另一套事件语言
3. 前端再定义第三套长期事件语言

---

## 领域边界

### Message 与 runtime 原始事件

Snail Shell 的 `Message` 表示系统内的一条会话消息，不等同于任何 runtime 的原始 message、turn、step、item 或 thread。

约束如下：

1. 一次 Snail Shell assistant reply 必须形成一条 Snail Shell `Message`。
2. 同一次 runtime invocation 内的多个 runtime message id 可以进入同一条 Snail Shell `Message`。
3. runtime 原始 id 只能作为 `MessageEvent.source` 的溯源字段保存。
4. 禁止把 runtime message id 与 Snail Shell `message.id` 设计成一一对应关系。

### MessageEvent 与 runtime 原始事件

`MessageEvent` 是产品语义事件，不是完整 runtime 原始事件。

每个 `MessageEvent` 必须保存足够的 `source` 信息，以支持审计、调试、迁移和重新映射。

业务层默认消费归一化后的 `MessageEvent.payload`，不得依赖 `source.raw_event` 驱动产品逻辑。

---

## 核心模型

### Message

`message` 是系统中唯一的消息实体。

它只负责表达：

1. 消息属于哪个 conversation
2. 消息是谁发出的
3. 消息投递给了谁
4. 引用关系
5. 上下文截断点
6. 消息运行时来源
7. 消息聚合状态

规范结构：

```ts
type MessageRole = "user" | "assistant" | "system"

type MessageRuntime = "claude" | "opencode" | "codex" | "system" | "unknown"

type MessageStatus = "streaming" | "completed" | "failed" | "interrupted" | "cancelled"

interface Message {
  id: number
  conversation_id: string
  from_snail: string | null
  to_snails: string[]
  role: MessageRole
  quoted_message_id: number | null
  context_cutoff_at: string
  runtime: MessageRuntime | null
  status: MessageStatus
  created_at: string
  updated_at: string
}
```

约束：

1. `message` 不直接承载正文字符串。
2. `message` 不直接承载 runtime 原始流式内容。
3. `message` 的内容只能通过 `MessageEvent[]` 表达。

### MessageEvent

`MessageEvent` 是消息流的唯一事件模型。

规范结构：

```ts
type MessageEventCategory = "content" | "signal"

type MessageEventKind =
  | "start"
  | "text"
  | "tool_call"
  | "tool_result"
  | "command"
  | "command_result"
  | "signal"
  | "error"

interface MessageEventSource {
  runtime_name: "claude" | "opencode" | "codex" | "system" | "unknown" | null
  runtime_event_type: string | null
  runtime_message_id: string | null
  runtime_item_id: string | null
  runtime_call_id: string | null
  raw_event: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

interface MessageEventBase<TKind extends MessageEventKind, TPayload> {
  id: number
  message_id: number
  seq: number
  category: MessageEventCategory
  kind: TKind
  payload: TPayload
  source: MessageEventSource
  created_at: string
}
```

约束：

1. `seq` 必须严格递增。
2. `seq` 只在单条消息内部有序。
3. `MessageEvent` 一旦写入，不再更新。
4. 任何状态推进都必须通过追加新事件实现，禁止原地修改历史事件。
5. `category` 是事件分类字段，不等同于 UI class 或 CSS class。

---

## 事件类型定义

### StartEvent

```ts
type StartEventPayload = {
  role: "user" | "assistant" | "system"
  snail_name: string | null
  runtime: "claude" | "opencode" | "codex" | "system" | "unknown" | null
}
```

约束：

1. `category = "signal"`
2. `kind = "start"`
3. 每条消息最多一个
4. 若存在，必须是第一条事件

### TextEvent

```ts
type TextEventPayload = {
  text: string
}
```

约束：

1. `category = "content"`
2. `kind = "text"`
3. 一条消息可以有零个、一个或多个 `text` 事件

### ToolCallEvent

```ts
type ToolCallEventPayload = {
  tool_name: string
  call_id: string
  input: Record<string, unknown> | null
  title: string | null
}
```

约束：

1. `category = "content"`
2. `kind = "tool_call"`
3. `ToolCallEvent` 只记录调用事实，不记录后续状态变化

### ToolResultEvent

```ts
type ToolResultEventPayload = {
  tool_name: string
  call_id: string
  is_error: boolean
  output_text: string | null
  error_text: string | null
  metadata: Record<string, unknown> | null
}
```

约束：

1. `category = "content"`
2. `kind = "tool_result"`
3. `ToolResultEvent` 与 `ToolCallEvent` 通过 `call_id` 关联
4. `ToolResultEvent` 自身表达结果，不回写 `ToolCallEvent`

### CommandEvent

```ts
type CommandEventPayload = {
  command_id: string
  command: string
}
```

约束：

1. `category = "content"`
2. `kind = "command"`
3. `CommandEvent` 只记录命令开始事实，不记录后续状态变化

### CommandResultEvent

```ts
type CommandResultEventPayload = {
  command_id: string
  command: string
  output_text: string | null
  exit_code: number | null
  is_error: boolean
  metadata: Record<string, unknown> | null
}
```

约束：

1. `category = "content"`
2. `kind = "command_result"`
3. `CommandResultEvent` 表达命令结果，不回写 `CommandEvent`

### SignalEvent

```ts
type SignalEventPayload = {
  type:
    | "step_start"
    | "step_finish"
    | "turn_started"
    | "turn_completed"
    | "message_completed"
    | "message_failed"
    | "message_interrupted"
    | "message_cancelled"
  reason: string | null
  detail: Record<string, unknown> | null
}
```

约束：

1. `category = "signal"`
2. `kind = "signal"`
3. `SignalEvent` 只表达信号，不表达正文内容
4. `step_start`、`step_finish`、`turn_started`、`turn_completed` 只是 runtime 映射时允许出现的 `type` 取值，不构成 Snail Shell 的平行顶层领域对象

### ErrorEvent

```ts
type ErrorEventPayload = {
  source: "runtime" | "tool" | "command" | "system" | "transport"
  message: string
  detail: Record<string, unknown> | null
}
```

约束：

1. `category = "signal"`
2. `kind = "error"`
3. `ErrorEvent` 只表达错误信号或错误观测

### 统一联合类型

```ts
type StartMessageEvent = MessageEventBase<"start", StartEventPayload>
type TextMessageEvent = MessageEventBase<"text", TextEventPayload>
type ToolCallMessageEvent = MessageEventBase<"tool_call", ToolCallEventPayload>
type ToolResultMessageEvent = MessageEventBase<"tool_result", ToolResultEventPayload>
type CommandMessageEvent = MessageEventBase<"command", CommandEventPayload>
type CommandResultMessageEvent = MessageEventBase<"command_result", CommandResultEventPayload>
type SignalMessageEvent = MessageEventBase<"signal", SignalEventPayload>
type ErrorMessageEvent = MessageEventBase<"error", ErrorEventPayload>

type MessageEvent =
  | StartMessageEvent
  | TextMessageEvent
  | ToolCallMessageEvent
  | ToolResultMessageEvent
  | CommandMessageEvent
  | CommandResultMessageEvent
  | SignalMessageEvent
  | ErrorMessageEvent
```

---

## 全生命周期流转

### 总流程

任意一条 assistant 流式消息的统一流程必须如下：

1. runtime adapter 接收底层 agent 原始事件
2. 编排层判断是否应创建新的 `message`
3. 创建 `message`，初始 `status = "streaming"`
4. 追加 `start` 事件
5. 将底层 runtime 原始事件逐条映射为 `MessageEvent`
6. 按 `seq` 顺序追加 `MessageEvent`
7. 当出现终局信号时，追加 terminal `MessageEvent`
8. 在同一事务内更新 `message.status`
9. 先广播 terminal `MessageEvent`，再广播 `message_status_changed`
10. 消息进入终态后，禁止再追加新事件

### 阶段 1：消息创建前

消息尚未创建时，系统只持有 runtime 原始事件。

开启新消息的时机固定如下：

1. Claude：首次出现 assistant message content
2. OpenCode：首次出现 runtime `step_start`
3. Codex：首次出现 runtime `turn.started`

### 阶段 2：消息创建

创建消息时，系统必须同时完成：

1. 创建 `message`
2. 写入 `runtime`
3. 写入 `status = "streaming"`
4. 追加第一条 `StartMessageEvent`

### 阶段 3：流式追加

在 `streaming` 阶段：

1. runtime adapter 每收到一条底层事件，都必须按 provider-specific 规则映射为 0 到 N 条 `MessageEvent`
2. 编排层必须按顺序追加这些 `MessageEvent`
3. WebSocket 必须按相同顺序向前端广播这些 `MessageEvent`
4. 前端必须按相同顺序渲染这条消息

### 阶段 4：终局聚合

终局聚合必须通过新事件和 `message.status` 完成，禁止通过更新旧事件完成。

终局提交顺序固定如下：

1. 追加 terminal `MessageEvent`
2. 更新 `message.status`
3. 广播 `message_event_appended`
4. 广播 `message_status_changed`

持久化层必须在同一事务内完成 terminal `MessageEvent` 追加和 `message.status` 更新。

典型终局信号固定如下：

1. Claude：terminal `result`
2. OpenCode：runtime `step_finish(reason = "stop")`
3. Codex：runtime `turn.completed`
4. 失败场景：`message_failed`
5. 中断场景：`message_interrupted`
6. 取消场景：`message_cancelled`

### 阶段 5：终态后的消费

消息进入终态后：

1. 前端按完整 `MessageEvent[]` 渲染历史消息
2. 搜索与预览从内容事件派生文本
3. 引用、回放、审计都以完整事件流为准

---

## 生命周期状态定义

### streaming

满足以下条件时，消息状态必须为 `streaming`：

1. `message` 已创建
2. 已开始接收 `MessageEvent`
3. 尚未收到终局完成、失败、中断、取消信号

### completed

满足以下条件时，消息状态必须为 `completed`：

1. 已收到 `message_completed` 信号
2. 编排层已确认该消息不再继续追加事件

### failed

满足以下条件时，消息状态必须为 `failed`：

1. 已收到 `message_failed` 信号
2. 该失败被认定为消息终局

### interrupted

满足以下条件时，消息状态必须为 `interrupted`：

1. 已收到 `message_interrupted` 信号
2. 消息已创建但未完成

### cancelled

满足以下条件时，消息状态必须为 `cancelled`：

1. 已收到 `message_cancelled` 信号
2. 后续不再追加事件

---

## 顺序约束

1. `start` 若存在，必须是第一条事件
2. 所有事件必须有严格递增 `seq`
3. 事件一旦写入，禁止更新
4. 消息进入终态后，禁止再追加事件
5. `ToolCallEvent` 与 `ToolResultEvent` 的关联只能通过 `call_id` 表达，禁止回写旧事件
6. `CommandEvent` 与 `CommandResultEvent` 的关联只能通过 `command_id` 表达；当 runtime 没有原始 command id 时，adapter 必须生成同一条消息内唯一的 `command_id`

---

## 非 assistant 消息生命周期

### user 消息

用户普通消息必须形成一条 `Message(role = "user")`。

最小事件序列固定如下：

1. `StartMessageEvent`
2. 一个或多个 `TextMessageEvent`
3. `SignalMessageEvent(type = "message_completed")`

`message.status` 必须为 `completed`。

### system 消息

系统通知、workflow notice、强制收口通知必须形成一条 `Message(role = "system")`。

最小事件序列固定如下：

1. `StartMessageEvent`
2. 一个或多个内容事件
3. `SignalMessageEvent(type = "message_completed")`

`message.status` 必须为 `completed`，除非系统通知生成过程本身失败。

### 历史导入消息

历史导入消息必须补齐完整事件流。

如果只能获得纯文本，则必须导入为：

1. `StartMessageEvent`
2. `TextMessageEvent`
3. `SignalMessageEvent(type = "message_completed")`

禁止只创建 `message` 行而不创建 `MessageEvent`。

---

## 底层 runtime 响应到消息模型的映射

本节定义 Claude、OpenCode、Codex 三类已确认 runtime 的真实响应数据，如何映射到 Snail Shell 的统一消息模型。

### 映射总原则

1. 输入是 runtime baseline 中的真实原始事件
2. 输出是 Snail Shell 统一 `MessageEvent`
3. 映射必须保序
4. 一条原始 runtime 事件可以映射为 0、1 或多条 `MessageEvent`
5. 禁止为了贴合旧模型而构造 runtime 未提供的独立正文层

### Claude 映射表

| runtime 原始事件 | 进入消息条件 | 映射出的 MessageEvent | message.status 变化 | 备注 |
| --- | --- | --- | --- | --- |
| `type = system, subtype = init` | 否 | 无 | 无 | 仅作为 runtime 初始化信息，不进入消息流 |
| `type = assistant`, `content[].type = tool_use` | 是 | `tool_call` | 若消息未创建则先创建 `message` 和 `start`，状态置为 `streaming` | `tool_name = name`，`call_id = id`，`input = input` |
| `type = user`, `content[].type = tool_result` | 是 | `tool_result` | 无 | `call_id = tool_use_id`，`output_text = content`，`is_error = is_error` |
| `type = assistant`, `content[].type = text` | 是 | `text` | 无 | 文本按原顺序追加 |
| `type = result` 且 `result.result` 与上一条 `text` 完全一致 | 是 | `signal(message_completed)` | `completed` | 舍弃重复文本值，不新增 `text` |
| `type = result` 且 `result.result` 与上一条 `text` 不同 | 是 | 先追加 `text`，再追加 `signal(message_completed)` | `completed` | 文本值来自 `result.result` |

#### Claude 样例

```text
assistant.tool_use -> MessageEvent(tool_call)
user.tool_result -> MessageEvent(tool_result)
assistant.text("snail-shell") -> MessageEvent(text)
result.result("snail-shell") -> MessageEvent(signal: message_completed)
```

### OpenCode 映射表

| runtime 原始事件 | 进入消息条件 | 映射出的 MessageEvent | message.status 变化 | 备注 |
| --- | --- | --- | --- | --- |
| `type = step_start` | 是 | `signal(step_start)` | 若消息未创建则先创建 `message` 和 `start`，状态置为 `streaming` | `reason = null` |
| `type = tool_use` | 是 | 先追加 `tool_call`，再追加 `tool_result` | 无 | 同一条原始事件内已包含 input/output，必须拆成两个不可变事件；`call_id = part.callID` |
| `type = text` | 是 | `text` | 无 | 文本按原样追加 |
| `type = step_finish`, `reason != stop` | 是 | `signal(step_finish)` | 无 | `reason` 原样进入 payload |
| `type = step_finish`, `reason = stop` | 是 | `signal(step_finish)`，再追加 `signal(message_completed)` | `completed` | OpenCode 没有原生 terminal result |

#### OpenCode 样例

```text
step_start -> MessageEvent(signal: step_start)
tool_use(completed) -> MessageEvent(tool_call) + MessageEvent(tool_result)
step_finish(reason=tool-calls) -> MessageEvent(signal: step_finish)
step_start -> MessageEvent(signal: step_start)
text("done") -> MessageEvent(text)
step_finish(reason=stop) -> MessageEvent(signal: step_finish) + MessageEvent(signal: message_completed)
```

### Codex 映射表

| runtime 原始事件 | 进入消息条件 | 映射出的 MessageEvent | message.status 变化 | 备注 |
| --- | --- | --- | --- | --- |
| `type = thread.started` | 否 | 无 | 无 | 线程级信号，不进入消息流 |
| `type = turn.started` | 是 | `signal(turn_started)` | 若消息未创建则先创建 `message` 和 `start`，状态置为 `streaming` | turn 是消息开始锚点 |
| `item.completed`, `item.type = agent_message` | 是 | `text` | 无 | 文本按原样追加 |
| `item.started`, `item.type = command_execution` | 是 | `command` | 无 | 只记录命令开始事实；`command_id = item.id` |
| `item.completed`, `item.type = command_execution` | 是 | `command_result` | 无 | 结果单独成事件；`command_id = item.id` |
| `type = turn.completed` | 是 | `signal(turn_completed)`，再追加 `signal(message_completed)` | `completed` | Codex 没有单独 native final result |

#### Codex 样例

```text
turn.started -> MessageEvent(signal: turn_started)
item.completed(agent_message) -> MessageEvent(text)
item.started(command_execution) -> MessageEvent(command)
item.completed(command_execution) -> MessageEvent(command_result)
item.completed(agent_message) -> MessageEvent(text)
turn.completed -> MessageEvent(signal: turn_completed) + MessageEvent(signal: message_completed)
```

---

## 持久化约束

### 表结构要求

数据库必须至少有两类结构：

1. `message`
2. `message_event`

其中：

1. `message` 的字段必须与本文定义的 `Message` 同构
2. `message_event` 的字段必须与本文定义的 `MessageEvent` 同构

### JSON 存储要求

数据库中可以将以下字段以 JSON 字符串存储：

1. `payload`
2. `source`

但只允许在数据访问边界做序列化与反序列化。业务层、编排层、前端层、协议层必须使用结构化对象，禁止传播未解析 JSON 字符串。

---

## 实时事件约束

WebSocket 与其他 realtime 接口必须围绕统一 `MessageEvent` 推进。

允许的实时事件类型固定如下：

1. `message_started`
2. `message_event_appended`
3. `message_status_changed`

示例：

```json
{ "type": "message_started", "message_id": 301, "status": "streaming" }
{ "type": "message_event_appended", "message_id": 301, "event": { "seq": 1, "category": "signal", "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail", "runtime": "opencode" } } }
{ "type": "message_event_appended", "message_id": 301, "event": { "seq": 2, "category": "signal", "kind": "signal", "payload": { "type": "step_start", "reason": null, "detail": null } } }
{ "type": "message_event_appended", "message_id": 301, "event": { "seq": 3, "category": "content", "kind": "tool_call", "payload": { "tool_name": "bash", "call_id": "call_1", "input": { "command": "pwd" }, "title": "Prints directory" } } }
{ "type": "message_event_appended", "message_id": 301, "event": { "seq": 4, "category": "signal", "kind": "signal", "payload": { "type": "message_completed", "reason": null, "detail": null } } }
{ "type": "message_status_changed", "message_id": 301, "status": "completed" }
```

---

## 消费约束

### 前端

前端必须遵循以下规则：

1. 一条消息按 `MessageEvent[]` 顺序渲染
2. `category = "content"` 的事件进入主内容渲染
3. `category = "signal"` 的事件进入信号层渲染
4. `message.status` 决定消息是否结束、失败、中断、取消
5. 禁止把某一类文本事件提升为唯一正式正文来源

### 搜索、摘要、预览

搜索、摘要、预览必须从内容事件派生，而不是依赖独立正文层。

### 搜索索引

搜索索引必须聚合所有可检索内容：

1. `text`
2. `tool_result.output_text`
3. `command_result.output_text`
4. 终态失败时的 `error.message`

大型工具输出和命令输出可以截断入索引，但不得完全丢弃可检索摘要。

### 列表预览

列表预览必须使用首选与兜底策略：

1. 首选第一条非空 `text`
2. 兜底使用失败消息的 `error.message`
3. 再兜底使用工具或命令结果的短摘要

列表预览禁止直接塞入大型工具输出全文。

### 摘要输入

摘要输入必须包含：

1. 所有 `text`
2. 工具与命令结果的短摘要
3. 终态失败原因

摘要输入禁止默认包含大型工具输出全文，除非摘要任务明确需要。

默认禁止把以下内容当作正文主体：

1. `start`
2. `signal`
3. `error` 的结构字段名

---

## 最小场景样例

本节样例为阅读压缩样例，省略了 `MessageEvent.id`、`message_id`、`source`、`created_at` 字段。

完整持久化记录必须包含 `MessageEventBase` 定义的全部字段。

### OpenCode 成功响应

```json
{
  "message": {
    "id": 401,
    "conversation_id": "conv-1",
    "role": "assistant",
    "from_snail": "Owner Snail",
    "to_snails": [],
    "quoted_message_id": null,
    "context_cutoff_at": "2026-04-27T00:00:00Z",
    "runtime": "opencode",
    "status": "completed",
    "created_at": "2026-04-27T00:00:00Z",
    "updated_at": "2026-04-27T00:00:03Z"
  },
  "events": [
    { "seq": 1, "category": "signal", "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail", "runtime": "opencode" } },
    { "seq": 2, "category": "signal", "kind": "signal", "payload": { "type": "step_start", "reason": null, "detail": null } },
    { "seq": 3, "category": "content", "kind": "tool_call", "payload": { "tool_name": "bash", "call_id": "call_1", "input": { "command": "pwd" }, "title": "Prints directory and package name" } },
    { "seq": 4, "category": "content", "kind": "tool_result", "payload": { "tool_name": "bash", "call_id": "call_1", "is_error": false, "output_text": "/Users/orca/ai/snail-shell\nsnail-shell\n", "error_text": null, "metadata": { "exit": 0 } } },
    { "seq": 5, "category": "signal", "kind": "signal", "payload": { "type": "step_finish", "reason": "tool-calls", "detail": null } },
    { "seq": 6, "category": "signal", "kind": "signal", "payload": { "type": "step_start", "reason": null, "detail": null } },
    { "seq": 7, "category": "content", "kind": "text", "payload": { "text": "snail-shell" } },
    { "seq": 8, "category": "signal", "kind": "signal", "payload": { "type": "step_finish", "reason": "stop", "detail": null } },
    { "seq": 9, "category": "signal", "kind": "signal", "payload": { "type": "message_completed", "reason": null, "detail": null } }
  ]
}
```

### Codex 成功响应

```json
{
  "message": {
    "id": 402,
    "conversation_id": "conv-1",
    "role": "assistant",
    "from_snail": "Owner Snail",
    "to_snails": [],
    "quoted_message_id": null,
    "context_cutoff_at": "2026-04-27T00:00:00Z",
    "runtime": "codex",
    "status": "completed",
    "created_at": "2026-04-27T00:00:00Z",
    "updated_at": "2026-04-27T00:00:03Z"
  },
  "events": [
    { "seq": 1, "category": "signal", "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail", "runtime": "codex" } },
    { "seq": 2, "category": "signal", "kind": "signal", "payload": { "type": "turn_started", "reason": null, "detail": null } },
    { "seq": 3, "category": "content", "kind": "text", "payload": { "text": "先在当前仓库里确认工作目录，再从 `package.json` 读取包名。" } },
    { "seq": 4, "category": "content", "kind": "command", "payload": { "command_id": "item_1", "command": "/bin/zsh -lc pwd" } },
    { "seq": 5, "category": "content", "kind": "command_result", "payload": { "command_id": "item_1", "command": "/bin/zsh -lc pwd", "output_text": "/Users/orca/ai/snail-shell\n", "exit_code": 0, "is_error": false, "metadata": null } },
    { "seq": 6, "category": "content", "kind": "text", "payload": { "text": "snail-shell" } },
    { "seq": 7, "category": "signal", "kind": "signal", "payload": { "type": "turn_completed", "reason": null, "detail": null } },
    { "seq": 8, "category": "signal", "kind": "signal", "payload": { "type": "message_completed", "reason": null, "detail": null } }
  ]
}
```

### Claude 成功响应

```json
{
  "message": {
    "id": 403,
    "conversation_id": "conv-1",
    "role": "assistant",
    "from_snail": "Owner Snail",
    "to_snails": [],
    "quoted_message_id": null,
    "context_cutoff_at": "2026-04-27T00:00:00Z",
    "runtime": "claude",
    "status": "completed",
    "created_at": "2026-04-27T00:00:00Z",
    "updated_at": "2026-04-27T00:00:03Z"
  },
  "events": [
    { "seq": 1, "category": "signal", "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail", "runtime": "claude" } },
    { "seq": 2, "category": "content", "kind": "tool_call", "payload": { "tool_name": "Bash", "call_id": "call_1", "input": { "command": "pwd" }, "title": null } },
    { "seq": 3, "category": "content", "kind": "tool_result", "payload": { "tool_name": "Bash", "call_id": "call_1", "is_error": false, "output_text": "/Users/orca/ai/snail-shell", "error_text": null, "metadata": null } },
    { "seq": 4, "category": "content", "kind": "text", "payload": { "text": "snail-shell" } },
    { "seq": 5, "category": "signal", "kind": "signal", "payload": { "type": "message_completed", "reason": null, "detail": { "runtime_event_type": "result", "stop_reason": "end_turn" } } }
  ]
}
```

---

## 合规要求

任何消息相关改动要被视为合规，必须同时满足以下条件：

1. 数据结构符合本文档定义
2. 生命周期流转符合本文档定义
3. runtime 映射符合本文档定义
4. 实时事件符合本文档定义
5. 前端与搜索消费规则符合本文档定义
6. 不得通过兼容补丁重新引入独立正文层或平行事件语言
