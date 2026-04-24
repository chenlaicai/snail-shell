# Snail Shell 核心消息数据模型

## 文档定位

本文档是 Snail Shell 消息数据模型的唯一核心规范。

后续凡是涉及以下内容的设计、实现、测试、评审与重构，都必须以本文档为准：

- 数据库存储
- TypeScript 类型
- runtime adapter
- 编排层消息流转
- WebSocket 实时事件
- HTTP 接口返回
- 前端渲染
- 搜索、摘要、预览、引用回复
- 消息相关测试样例

如果仓库内其他文档、代码注释、历史设计稿与本文档冲突，一律视为过时内容，并以本文档为准进行修正。

## 术语约定

本文档中的规范术语采用以下固定含义：

1. `必须`
   表示强制要求，不允许偏离。
2. `禁止`
   表示明确不允许出现的做法。
3. `可以`
   表示在不违反其他强制约束的前提下允许存在。
4. `固定`
   表示当前版本已拍板，不允许在实现层自行扩展或改写。
5. `正式`
   表示可持久化、可引用、可搜索、可摘要、可回放的权威语义。

除本节定义外，其他自然语言描述不得覆盖这些术语的约束强度。

## 裁决优先级

当不同信息源对消息模型给出不同说法时，裁决优先级固定如下：

1. 本文档
2. `src/persistence/types.ts` 与 `src/persistence/schema.ts` 中与本文档一致的实现锚点
3. 针对本文档场景集编写的测试
4. 其他系统文档
5. 历史设计稿、旧注释、临时讨论结论

如果低优先级内容与高优先级内容冲突，必须修改低优先级内容，不得反向稀释高优先级约束。

## 变更守则

本模型只有一条变更守则：

1. 只允许在用户明确授权的情况下才允许变更。

补充约束：

1. 未获用户明确授权时，禁止修改消息模型定义、消息生命周期语义、场景数据、覆盖率矩阵、禁止事项、违规示例与相关实现。
2. 获得用户明确授权后，仍必须保持变更结果继续服从本文档的其余全部约束；若授权内容本身要求修改规范，则必须先更新本文档，再更新实现与测试。

## 立规原因

Snail Shell 的外层主链是：

`Project -> Stage -> Conversation -> Artifact`

但在真正运行时，系统能否稳定协作，取决于 conversation 内部的消息痕迹是否稳定、统一、可追溯。

消息模型之所以是核心，不是因为系统是聊天系统，而是因为它同时承担了以下职责：

1. 承接用户输入与 agent 输出
2. 承接多 snail 协作中的路由与引用关系
3. 承接 runtime 流式过程信息
4. 承接正式回复、正式提问、正式回答
5. 承接系统通知与工作流通知
6. 作为搜索、摘要、预览、回放、审计的基础数据来源

过去多轮重构中反复暴露的问题，本质上都来自消息语义不够统一：

1. 不同层维护了不同的消息语言
2. 过程态和结论态混在一起
3. 过程错误与终态失败混在一起
4. 实时事件与持久化结构不一致
5. question / question_response 容易被做成旁路协议，而不是正式消息
6. 某些调用方试图从过程输出里猜最终结论

因此，本文档不是说明文档，而是约束文档。后续所有消息相关改动都必须服从本文档。

## 目标

本文档约束下的消息模型必须同时满足以下目标：

1. 全链路只保留一套消息语言
2. 一条消息只能围绕一个稳定的 `message_id` 演进
3. 生命周期开始、过程、正式结论、终态必须分离表达
4. 所有层消费同一份结构化模型，而不是各自猜测
5. 数据库允许以 JSON 字符串持久化，但系统内部必须使用强类型结构体
6. question 与 question_response 必须成为正式持久化消息
7. system notice 必须走与 assistant message 相同的统一消息生命周期
8. 后续新增能力只能在这套模型内扩展，不能另起一套平行模型

## 核心原则

### 1. 系统只围绕一个消息实体运转

整个系统只允许一个统一消息实体：

- `message`

一条消息的生命周期与内容，只允许通过统一的 `message_part` 追加表达。

### 2. 消息内容必须通过四段式 part 表达

一条消息的生命周期只允许由以下四类 `message_part.kind` 组成：

1. `start`
2. `delta`
3. `result`
4. `end`

这四类的职责固定如下：

1. `start`：开始信号
2. `delta`：过程态
3. `result`：正式结论态
4. `end`：终态信号

禁止新增第五类顶层 part kind。

### 3. 过程与结论必须分离

消息处理中出现的流式文本、工具调用、工具结果、错误观测、补救过程，都属于过程态，只能进入 `delta`。

真正面向用户、面向摘要、面向引用、面向正式历史记录的内容，只能进入 `result`。

### 4. 终态必须单独表达

消息是否完成、是否失败、是否中断，禁止通过正文推断，禁止通过过程片段猜测。

终态只能由 `end` 表达。

### 5. 过程错误不等于终态失败

工具失败、MCP 调用失败、skill 失败、runtime 过程中的可恢复错误，都只属于过程观测。

它们可以进入：

- `delta(kind = "error_observation")`
- `tool_result.is_error = true`
- `mcp_result.is_error = true`
- `skill_result.is_error = true`

但这些都不得自动升级为 `end(error)`。

### 6. 请求失败与消息失败不是一回事

必须严格区分：

1. `end(error)`
   表示这条消息的生命周期完整结束了，只是终局为失败

2. HTTP 500 / transport failure
   表示请求本身失败，可能连一条完整消息生命周期都没有形成

### 7. 数据库存储与系统内结构必须分层

数据库中允许把 `message_part.payload` 以 JSON 字符串保存。

但只允许在数据访问边界进行序列化与反序列化。业务层、编排层、前端 view model、协议层必须使用结构化 payload，禁止分散传播未解析 JSON 字符串。

### 8. 正式消息不能旁路持久化

所有正式消息都必须以 `message + message_part` 落库。

这包括：

1. assistant 回复
2. user 普通消息
3. user 的 question_response
4. system notice
5. workflow notice
6. 强制收口通知
7. 未来其他系统生成消息

禁止存在“实时上发了，但不落正式 message”的旁路协议。

## 核心模型

### Message

`message` 是系统中唯一的消息实体。

它负责表达：

1. 某条消息属于哪个 conversation
2. 消息是谁发出的
3. 消息投递给了谁
4. 它引用了哪条历史消息
5. 它的上下文截断点是什么

它不直接承载正文和生命周期细节。

规范结构：

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

### MessagePart

`message_part` 是统一消息模型的核心。

顶层类型固定为：

```ts
type MessagePartKind = "start" | "delta" | "result" | "end"

interface MessagePartBase<TKind extends MessagePartKind, TPayload> {
  id: number
  message_id: number
  kind: TKind
  payload: TPayload
  created_at: string
}
```

### StartPart

`start` 表示一条消息生命周期开始。

`start` 不是正文，也不得替代 `result`。

```ts
type StartPartPayload = {
  role: "user" | "assistant" | "system"
  snail_name?: string | null
  runtime?: string | null
}
```

### DeltaPart

`delta` 统一表示消息生命周期中的过程态。

所有流式文本、工具调用、调用结果、过程错误，都必须收敛为 `delta` 的 subtype。

```ts
type DeltaPartPayload =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; tool_name: string; call_id?: string; input: Record<string, unknown> }
  | { kind: "tool_result"; tool_name: string; call_id?: string; is_error: boolean; output_text?: string | null; error_text?: string | null }
  | { kind: "mcp_call"; server_name: string; tool_name: string; call_id?: string; input: Record<string, unknown> }
  | { kind: "mcp_result"; server_name: string; tool_name: string; call_id?: string; is_error: boolean; output_text?: string | null; error_text?: string | null }
  | { kind: "skill_call"; skill_name: string; input?: Record<string, unknown> }
  | { kind: "skill_result"; skill_name: string; is_error: boolean; output_text?: string | null; error_text?: string | null }
  | { kind: "error_observation"; source: "runtime" | "tool" | "mcp" | "system"; error_text: string }
```

### ResultPart

`result` 是这条消息唯一的正式结论态。

只要存在 `result`，它就必须被视为：

1. 正式展示内容
2. 正式引用内容
3. 正式摘要内容
4. 正式预览内容的优先来源

约束如下：

1. 一条消息最多一个 `result`
2. 一条消息可以没有 `result`
3. question 与 question_response 必须作为 `result` 的合法形式存在

```ts
type ResultPartPayload =
  | { format: "plain_text"; content: string; display_content?: string }
  | { format: "structured_text"; content: string; display_content?: string; mentions?: string[] }
  | {
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
  | {
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
```

### EndPart

`end` 是一条消息唯一权威的终态信号。

```ts
type EndPartPayload = {
  status: "success" | "error" | "cancelled" | "interrupted"
  error_text?: string | null
  ended_by?: "runtime" | "system" | "transport" | "timeout"
}
```

## 持久化模型

数据库层规范结构：

```ts
interface PersistedMessagePartRow {
  id: number
  message_id: number
  kind: "start" | "delta" | "result" | "end"
  payload: string
  created_at: string
}
```

对应的核心存储规则如下：

1. `message` 表存消息归属、生产者、引用关系、上下文边界
2. `message_part` 表存消息生命周期与内容细节
3. `message_dispatch` 表存消息级路由消费记录
4. `message_search` 只索引可用于自然语言检索的文本内容，不把生命周期状态当正文

数据库里可以是字符串，系统里必须是结构体。

## 规范断言

本节给出不允许歧义解释的核心断言。后续实现、接口、测试、评审必须逐条满足。

1. 系统中只允许一个统一消息实体：`message`
2. 一条消息的生命周期只允许通过 `message_part` 追加推进
3. `message_part.kind` 只允许 `start / delta / result / end`
4. `start` 只表示开始，不表示正文
5. `delta` 只表示过程，不表示正式结论
6. `result` 只表示正式结论，不表示过程补丁
7. `end` 只表示终态，不表示正文补充
8. question 必须以 `result(format = "question")` 存在
9. question_response 必须以新的 `message` 加 `result(format = "question_response")` 存在
10. system notice 必须走完整统一生命周期
11. 过程错误不得直接等价于终态失败
12. 请求级失败不得伪装成成功完成的消息生命周期

## 生命周期语义

### 正常成功

当一条消息完成一次有效处理，并形成正式结论，终态必须为：

- `end(success)`

即使过程中出现过错误 `delta`，只要最终完成补救并给出有效结论，终态仍必须是成功。

### 正常失败

当一条消息生命周期完整结束，但结局明确是失败，终态必须为：

- `end(error)`

适用条件包括：

1. runtime 明确给出终态失败语义
2. 系统后处理明确失败，并决定保留这条失败消息

### 中断与取消

当消息被中断、超时、传输层断开，且系统仍然保留该消息生命周期时，必须使用：

1. `end(interrupted)`
2. `end(cancelled)`

### 请求级失败

当失败发生在请求层，导致系统没有完成一条有效消息生命周期时，必须按请求级失败处理，可直接返回 HTTP 500。

典型情况包括：

1. runtime 进程未成功启动
2. transport 建立失败
3. 协议解析在消息创建前就失败
4. 请求处理本身异常中断

如果系统已经创建了消息，则必须补齐一个可读的 `end(error|interrupted)`；如果消息尚未创建，则可以只有 HTTP 500。

## 各层职责边界

### 持久化层

负责：

1. 存取 `message`、`message_part`、`message_dispatch`
2. 在边界上完成 payload 序列化与反序列化
3. 提供结构化类型给上层消费

禁止：

1. 推断消息终态
2. 从 delta 猜正式结论
3. 把字符串 JSON 语义泄漏给业务层

### Runtime Adapter

负责：

1. 把第三方 runtime 原始事件翻译为统一消息生命周期
2. 输出 `message_start`、`message_part`、`message_end`
3. 把过程信息收敛为 `delta`

禁止：

1. 发明新的长期领域概念
2. 在系统上层保留一套独立 runtime 事件语言
3. 仅凭过程错误就推断 `end(error)`

### 编排层

负责：

1. 创建消息生命周期锚点
2. 维护 message 与 dispatch、summary、artifact 之间的关系
3. 在统一模型上处理引用、转发、协作与收口

禁止：

1. 再定义一套和消息模型平行的 turn/event 模型
2. 绕过正式消息落库去发旁路消息

### API / WebSocket 层

负责：

1. 对外输出统一消息结构
2. 对实时流统一输出 `message_start`、`message_part`、`message_end`

禁止：

1. 把内部统一模型拆碎成另一套长期维护的外部领域模型
2. 用额外刷新通知来弥补消息模型缺失

### 前端渲染层

负责：

1. 按统一模型渲染消息生命周期
2. 用 `delta` 渲染过程态
3. 用 `result` 渲染正式结论
4. 用 `end` 判断终态

禁止：

1. 从 delta 猜测哪一段是最终回复
2. 仅因出现错误 delta 就判定整条消息失败
3. 把 question 当作临时 UI 状态而不是正式消息记录

### 搜索 / 摘要 / 预览层

负责：

1. 优先使用 `result` 作为正式语义来源
2. 在必要时选择性吸纳人类可读的 `delta`
3. 在没有 `result` 时，谨慎退化使用可读错误或过程文本

禁止：

1. 把 `start`、`end` 当作自然语言正文
2. 把过程态与正式结论态混为一谈

## 场景数据

本节定义核心场景的示例数据、全流程流转样例和覆盖率矩阵。

本节不是示意章节，而是正式场景集定义。

### 场景清单

当前核心场景集固定为 10 类：

1. 用户普通文本消息
2. assistant 普通文本成功回复
3. assistant 经工具调用成功回复
4. assistant 遇到过程错误后补救成功
5. assistant 明确终态失败
6. question 正式提问消息
7. question_response 正式回答消息
8. system notice 正式系统消息
9. 后处理失败但消息保留
10. transport / request 级失败

### 场景 1：用户普通文本消息

#### 输入意图

用户发送一条普通文本，请求系统继续处理。

#### 持久化结果

```json
{
  "message": {
    "id": 201,
    "conversation_id": "conv-1",
    "from_snail": null,
    "to_snails": ["Owner Snail"],
    "role": "user",
    "quoted_message_id": null,
    "context_cutoff_at": "2026-04-24 10:00:00",
    "created_at": "2026-04-24 10:00:00"
  },
  "parts": [
    { "kind": "start", "payload": { "role": "user" } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "请梳理一下消息模型" } },
    { "kind": "end", "payload": { "status": "success", "ended_by": "system" } }
  ]
}
```

#### 流转说明

1. API 创建 user message
2. 写入 `start`
3. 写入 `result(plain_text)`
4. 写入 `end(success)`
5. 根据 `to_snails` 写入 dispatch

### 场景 2：assistant 普通文本成功回复

#### 实时流

```json
{ "type": "message_start", "message_id": 202, "snail_name": "Owner Snail", "role": "assistant" }
{ "type": "message_part", "message_id": 202, "snail_name": "Owner Snail", "part": { "kind": "delta", "payload": { "kind": "text", "text": "我先整理一下当前约束" } } }
{ "type": "message_part", "message_id": 202, "snail_name": "Owner Snail", "part": { "kind": "result", "payload": { "format": "plain_text", "content": "这是最终答复" } } }
{ "type": "message_end", "message_id": 202, "snail_name": "Owner Snail", "status": "success", "final_role": "assistant" }
```

#### 持久化结果

```json
{
  "message": { "id": 202, "role": "assistant", "from_snail": "Owner Snail", "to_snails": [] },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail", "runtime": "codex" } },
    { "kind": "delta", "payload": { "kind": "text", "text": "我先整理一下当前约束" } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "这是最终答复" } },
    { "kind": "end", "payload": { "status": "success", "ended_by": "runtime" } }
  ]
}
```

#### 流转说明

1. 编排层创建 assistant message
2. 写入 `start`
3. runtime 流式输出文本，持续写入 `delta(text)`
4. 形成正式结论，写入 `result`
5. 生命周期完成，写入 `end(success)`

### 场景 3：assistant 经工具调用成功回复

```json
{
  "message": { "id": 203, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "delta", "payload": { "kind": "text", "text": "我先检查文件" } },
    { "kind": "delta", "payload": { "kind": "tool_call", "tool_name": "Read", "call_id": "call-1", "input": { "file_path": "src/app.ts" } } },
    { "kind": "delta", "payload": { "kind": "tool_result", "tool_name": "Read", "call_id": "call-1", "is_error": false, "output_text": "...file content..." } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "问题出在这里，建议这样修改" } },
    { "kind": "end", "payload": { "status": "success" } }
  ]
}
```

#### 流转说明

1. 先建立生命周期
2. 工具调用与结果都只是过程态，进入 `delta`
3. 最终正式结论只进入 `result`
4. 完成后写入 `end(success)`

### 场景 4：assistant 遇到过程错误后补救成功

```json
{
  "message": { "id": 204, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "delta", "payload": { "kind": "tool_call", "tool_name": "Read", "input": { "file_path": "missing.ts" } } },
    { "kind": "delta", "payload": { "kind": "tool_result", "tool_name": "Read", "is_error": true, "error_text": "missing.ts 不存在" } },
    { "kind": "delta", "payload": { "kind": "tool_call", "tool_name": "Search", "input": { "query": "missing.ts" } } },
    { "kind": "delta", "payload": { "kind": "tool_result", "tool_name": "Search", "is_error": false, "output_text": "src/core/missing.ts" } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "我已改用搜索定位到目标文件，问题如下" } },
    { "kind": "end", "payload": { "status": "success" } }
  ]
}
```

#### 流转说明

1. 过程出现错误观测
2. 错误只保留在 `delta`
3. agent 完成补救后给出正式结论
4. 终态必须仍为 `end(success)`

### 场景 5：assistant 明确终态失败

```json
{
  "message": { "id": 205, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "delta", "payload": { "kind": "error_observation", "source": "runtime", "error_text": "当前权限不足，无法继续执行" } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "当前权限不足，无法继续执行", "display_content": "当前权限不足，无法继续执行" } },
    { "kind": "end", "payload": { "status": "error", "error_text": "当前权限不足，无法继续执行", "ended_by": "runtime" } }
  ]
}
```

#### 流转说明

1. runtime 明确告诉系统这条消息终态失败
2. 系统可以保留错误说明作为最终可读 result
3. 必须以 `end(error)` 结束，而不是 HTTP 500

### 场景 6：question 正式提问消息

```json
{
  "message": { "id": 206, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    {
      "kind": "result",
      "payload": {
        "format": "question",
        "title": "需要你的确认",
        "question": "请选择一个方案",
        "reason": "两种方案实现成本不同",
        "selection_mode": "single",
        "options": [
          { "key": "a", "label": "方案 A", "description": "快速推进" },
          { "key": "b", "label": "方案 B", "description": "更稳妥" }
        ]
      }
    },
    { "kind": "end", "payload": { "status": "success", "ended_by": "runtime" } }
  ]
}
```

#### 流转说明

1. question 是正式 assistant message
2. question 不是旁路事件，不是 UI 临时态
3. question 必须以 `result(format = "question")` 持久化

### 场景 7：question_response 正式回答消息

```json
{
  "message": { "id": 207, "role": "user", "from_snail": null, "quoted_message_id": 206 },
  "parts": [
    { "kind": "start", "payload": { "role": "user" } },
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

#### 流转说明

1. 用户回答不是 question 上的附属字段
2. 它必须是一条新的正式 message
3. 其正式内容必须通过 `result(question_response)` 表达

### 场景 8：system notice 正式系统消息

```json
{
  "message": { "id": 208, "role": "system", "from_snail": null },
  "parts": [
    { "kind": "start", "payload": { "role": "system" } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "已达到非 boss snail 协作轮次上限，转由 Owner Snail 收口。" } },
    { "kind": "end", "payload": { "status": "success", "ended_by": "system" } }
  ]
}
```

#### 流转说明

1. system notice 也是正式 message
2. system notice 必须走统一生命周期
3. 禁止“直接写库后额外发刷新通知”

### 场景 9：后处理失败但消息保留

```json
{
  "message": { "id": 209, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "delta", "payload": { "kind": "text", "text": "请继续处理 @Product Snail" } },
    { "kind": "result", "payload": { "format": "plain_text", "content": "请继续处理 @Product Snail" } },
    { "kind": "end", "payload": { "status": "error", "error_text": "synthetic mention extraction failure", "ended_by": "system" } }
  ]
}
```

#### 流转说明

1. runtime 已完成回复
2. 系统后处理失败
3. 该失败属于消息生命周期内部失败
4. 因为消息已经保留，所以终态必须为 `end(error)`，而不是把这条消息整体抹掉

### 场景 10：transport / request 级失败

#### 未创建消息的情况

```json
{
  "http_status": 500,
  "error": "runtime process exited unexpectedly before message creation"
}
```

#### 已创建消息的情况

```json
{
  "message": { "id": 210, "role": "assistant", "from_snail": "Owner Snail" },
  "parts": [
    { "kind": "start", "payload": { "role": "assistant", "snail_name": "Owner Snail" } },
    { "kind": "end", "payload": { "status": "interrupted", "error_text": "runtime process exited unexpectedly", "ended_by": "transport" } }
  ]
}
```

#### 流转说明

1. 这是请求级失败，不是正常完成的一条消息生命周期
2. 若消息尚未创建，可只有 HTTP 500
3. 若消息已创建，必须补齐一个可读终态

### 全流程流转总图

任意正式消息的统一流转骨架固定为：

1. 创建 `message`
2. 追加 `start`
3. 按需追加多个 `delta`
4. 按需追加一个 `result`
5. 追加一个 `end`
6. 如果需要路由协作，再通过 `message_dispatch` 记录消费关系
7. 预览、摘要、搜索、引用统一从正式消息结构读取

### 流转顺序约束

除请求级失败外，一条正式消息的 part 顺序必须满足以下约束：

1. `start` 最多一个，且若存在则必须先于所有其他 part
2. `delta` 可以有零个或多个，且只能出现在 `start` 之后、`end` 之前
3. `result` 最多一个，且若存在则必须出现在 `end` 之前
4. `end` 最多一个，且若存在则必须是最后一个 part
5. `end` 一旦写入，该消息生命周期即视为结束，不得再追加新的 part

任何违反上述顺序约束的实现都视为不符合规范。

### 场景覆盖率矩阵

下表定义当前核心消息模型必须覆盖的能力维度。

| 场景 | start | delta.text | tool/mcp/skill | result | question | question_response | end.success | end.error | end.interrupted | persisted | realtime | dispatch relevance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 用户普通文本消息 | 必须 | 否 | 否 | 必须 | 否 | 否 | 必须 | 否 | 否 | 必须 | 否 | 必须 |
| assistant 普通文本成功回复 | 必须 | 必须 | 否 | 必须 | 否 | 否 | 必须 | 否 | 否 | 必须 | 必须 | 可以有 |
| assistant 工具调用成功回复 | 必须 | 必须 | 必须 | 必须 | 否 | 否 | 必须 | 否 | 否 | 必须 | 必须 | 可以有 |
| 过程错误后补救成功 | 必须 | 可以有 | 必须 | 必须 | 否 | 否 | 必须 | 否 | 否 | 必须 | 必须 | 可以有 |
| 明确终态失败 | 必须 | 可以有 | 可以有 | 可以有 | 否 | 否 | 否 | 必须 | 否 | 必须 | 必须 | 可以有 |
| question 正式提问 | 必须 | 可以有 | 可以有 | 必须 | 必须 | 否 | 必须 | 否 | 否 | 必须 | 必须 | 可以有 |
| question_response 正式回答 | 必须 | 否 | 否 | 必须 | 否 | 必须 | 必须 | 否 | 否 | 必须 | 否 | 必须 |
| system notice | 必须 | 否 | 否 | 必须 | 否 | 否 | 必须 | 否 | 否 | 必须 | 必须 | 可以有 |
| 后处理失败但消息保留 | 必须 | 必须 | 可以有 | 可以有 | 否 | 否 | 否 | 必须 | 否 | 必须 | 必须 | 可以有 |
| transport / request 级失败 | 可以无 | 否 | 否 | 否 | 否 | 否 | 否 | 可以有 | 必须 | 条件成立时必须 | 条件成立时必须 | 否 |

### 覆盖率要求

后续实现与测试必须满足以下覆盖要求：

1. 上表 10 类场景必须全部有测试或等价验证
2. 每类场景必须至少覆盖持久化结果断言
3. 涉及实时流的场景必须覆盖实时事件顺序断言
4. 涉及 question / question_response 的场景必须覆盖刷新后仍可读取
5. 涉及失败语义的场景必须明确区分 `end(error)` 与 HTTP 500
6. 涉及过程错误补救的场景必须覆盖“有错误 delta 但最终 success”

## 消费约束

### 前端

前端只允许按以下规则消费消息：

1. 是否结束，只看 `end`
2. 是否失败，只看 `end.status`
3. 过程怎么展示，读 `delta`
4. 最终结论怎么展示，只读 `result`
5. question / question_response 都视为正式消息内容

### 搜索与摘要

搜索与摘要默认必须优先使用：

1. `result`
2. 在确有必要时可以吸纳人类可读 `delta`

默认不得把以下内容当作正文主体：

1. `start`
2. `end`

## 验证与合规要求

任何消息相关改动要被视为合规，必须同时满足以下条件：

1. 数据结构符合本文档定义
2. 生命周期语义符合本文档断言
3. 场景数据至少覆盖受影响场景
4. 该改动已获得用户的明确授权
5. 若用户明确授权变更，则必须先更新本文档再改实现
6. 不得通过“局部兼容”“临时旁路”“先这样跑起来”绕开本文档

## 违规示例

本节列出典型违规做法。以下示例不是边界讨论，而是明确不合规的反例。

### 违规示例 1：重新引入平行消息模型

违规做法：

1. 在 `message + message_part` 之外，再定义一套长期存在的 `turn`、`event_log`、`runtime_chunk`、`ui_message` 等平行主模型
2. 让上层业务同时理解两套生命周期语言

为什么违规：

1. 违反“全链路只保留一套消息语言”
2. 违反“系统中只允许一个统一消息实体：message”

正确做法：

1. 所有新增语义必须收敛进 `message` 或 `message_part`
2. 如属于过程态，进入 `delta`
3. 如属于正式结论态，进入 `result`

### 违规示例 2：把正文重新挂回 `message`

违规做法：

```ts
interface Message {
  id: number
  conversation_id: string
  role: "assistant"
  content: string
}
```

为什么违规：

1. 违反“Message 只作为消息实体锚点”
2. 违反“正文、过程态、终态不直接挂在 Message 行上”

正确做法：

1. 正式正文进入 `result`
2. 过程输出进入 `delta`
3. `message` 只保存归属、路由、引用、上下文边界

### 违规示例 3：仅因过程错误就写 `end(error)`

违规做法：

1. 工具调用失败一次，就立即把整条消息标记为 `end(error)`
2. 中途出现错误 observation，就直接把最终状态判成失败

为什么违规：

1. 违反“过程错误不等于终态失败”
2. 违反“有错误 delta 但最终 success”这一正式场景

正确做法：

1. 过程错误保留在 `delta`
2. 只有当终态明确失败时，才写 `end(error)`
3. 若 agent 补救成功，终态必须仍为 `end(success)`

### 违规示例 4：把 question 做成旁路 UI 状态

违规做法：

1. assistant 发起提问时只推送一个 realtime UI 事件
2. 刷新页面后 question 消失
3. question 不对应正式 message

为什么违规：

1. 违反“question 必须以 result(format = \"question\") 存在”
2. 破坏引用、搜索、摘要、补答的一致性

正确做法：

1. question 必须落为正式 assistant message
2. 其正式内容必须进入 `result(format = "question")`
3. 刷新后必须可从历史中重建

### 违规示例 5：把 question_response 写成 question 的附属字段

违规做法：

1. 直接在原 question 记录上追加 `selected_option`
2. 不生成新的 user message
3. 只在前端本地状态里记录用户选择

为什么违规：

1. 违反“question_response 必须以新的 message 加 result(format = \"question_response\") 存在”
2. 破坏正式历史记录与引用关系

正确做法：

1. 用户回答必须形成一条新的正式 message
2. 正式内容必须进入 `result(question_response)`
3. 如有引用关系，通过 `quoted_message_id` 表达

### 违规示例 6：system notice 走旁路刷新而不走统一生命周期

违规做法：

1. 系统直接写一行数据库记录
2. 再额外发送一个“请前端刷新”的通知
3. 不生成统一的 `message_start / message_part / message_end`

为什么违规：

1. 违反“system notice 必须走完整统一生命周期”
2. 违反“禁止存在不落正式 message 的旁路协议”

正确做法：

1. system notice 也必须创建正式 message
2. 也必须遵守 `start / result / end` 生命周期
3. 实时流与持久化结构必须保持同构

### 违规示例 7：违反 part 顺序约束

违规做法：

1. 先写 `result`，再补 `start`
2. `end` 写入后继续追加 `delta`
3. 一条消息写入多个 `result`

为什么违规：

1. 违反 `start / delta / result / end` 的流转顺序约束
2. 会让前端、搜索、摘要、回放出现歧义

正确做法：

1. `start` 若存在必须最先
2. `result` 最多一个且必须在 `end` 之前
3. `end` 若存在必须最后，写入后不得再追加 part

### 违规示例 8：前端从 delta 猜最终回复

违规做法：

1. 前端把最后一段 `delta(text)` 当作正式回复
2. 仅因没有及时收到 `result` 就直接把过程文本固化成最终显示

为什么违规：

1. 违反“最终结论怎么展示，只读 result”
2. 会把过程态与正式结论态混淆

正确做法：

1. 前端过程展示读 `delta`
2. 最终结论展示读 `result`
3. 是否结束、是否失败只读 `end`

### 违规示例 9：搜索和摘要把 `start` / `end` 当正文

违规做法：

1. 把 `end(status=error)` 的结构字段直接拼进摘要正文
2. 把 `start` 的 role / runtime 信息当作可检索正文主体

为什么违规：

1. 违反“默认不得把 start / end 当作正文主体”
2. 会污染搜索和摘要语义

正确做法：

1. 搜索与摘要默认优先使用 `result`
2. 确有必要时再有限吸纳人类可读 `delta`
3. `start` / `end` 只作为生命周期结构信息处理

### 违规示例 10：用未解析 JSON 字符串在系统内传播 payload

违规做法：

1. store 层返回 `payload: string`
2. 上层在多个位置各自 `JSON.parse`
3. 前端、编排层、协议层都直接处理原始字符串

为什么违规：

1. 违反“数据库里可以是字符串，系统里必须是结构体”
2. 会造成类型分裂、重复解析和隐性不一致

正确做法：

1. 只允许在数据访问边界做序列化与反序列化
2. 边界之上统一使用结构化 payload
3. 所有业务语义在强类型层完成判断与消费

## 实现锚点

当前仓库中，与本文档直接对应的代码锚点如下：

1. `src/persistence/types.ts`
   核心类型定义锚点
2. `src/persistence/schema.ts`
   持久化结构锚点
3. `src/project/message-protocol.ts`
   消息生命周期推进锚点
4. `src/project/message-parts.ts`
   结果、预览、delta 提取锚点
5. `src/project/agent-message.ts`
   agent 输入消息拼装锚点

任何修改上述结构的变更，只有在用户明确授权的情况下才允许进行；一旦获批，必须同步检查本文档是否需要更新。

## 禁止事项

后续任何改动都不得：

1. 新增第五类顶层 `message_part.kind`
2. 在 `message` 行上重新挂 `content` 作为正式正文
3. 在上层长期维护一套平行的 runtime 消息语言
4. 用旁路刷新事件代替正式消息生命周期
5. 从 `delta` 猜测最终正式回复
6. 仅因出现错误 `delta` 就把消息判成 `end(error)`
7. 让 question / question_response 只存在于临时状态而不落库
8. 在系统内部传播未解析的 JSON 字符串 payload

## 与其他文档的关系

本文档与其他系统文档的关系如下：

1. `docs/domain-model.md`
   描述系统业务对象定位，Message 部分必须服从本文档
2. `docs/data-model-v1.md`
   描述数据模型草案，Message 部分必须服从本文档
3. `docs/schema-design-v1.md`
   描述 schema 设计，Message / message_part 结构必须服从本文档
4. `docs/meta/snail-shell-storage-model.md`
   描述存储哲学，消息存储部分必须服从本文档
5. `docs/message-model-unification.md`
   作为本主题的历史收敛稿，其内容已由本文档吸收

## 最终结论

Snail Shell 后续消息相关改动必须服从的，不是一组零散经验，而是一套明确、固定、可落库、可流式、可搜索、可测试的统一模型：

1. 整个系统只围绕一个 `message` 实体运转
2. 消息生命周期只通过 `message_part` 追加推进
3. 顶层 part 只允许 `start / delta / result / end`
4. `delta` 只表示过程
5. `result` 只表示正式结论
6. `end` 只表示终态

这是 Snail Shell 的核心数据模型之一，后续不得随意偏离或另起炉灶。
