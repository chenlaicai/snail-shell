# 持久化数据模型字段说明

本文档记录 `src/persistence/types.ts` 中核心持久化模型的字段语义。字段说明应与代码中的 `/** ... */` 注释保持一致；当新增字段、调整语义或发现字段名容易误导时，必须同步更新本文档和代码注释。

## 枚举类型

| 类型 | 说明 |
| --- | --- |
| `ProjectKind` | 项目类型，区分 Snail Shell 自身演进和外部产品交付。 |
| `ProjectStatus` | 项目状态，描述项目在全局生命周期中的进展。 |
| `FeatureStatus` | Feature 状态，描述单个需求从研发到归档的流转位置。 |
| `StageStatus` | Stage 状态，描述单个工作流阶段是否仍在推进。 |
| `ConversationKind` | Conversation 类型，描述当前会话承载的协作场景。 |
| `ConversationStatus` | Conversation 状态，描述当前会话是否仍接受协作消息。 |
| `MessageRole` | Message 角色，区分人工输入、agent 输出和系统通知。 |
| `MessageRuntime` | Message 运行时来源，记录生成该消息的 agent runtime 或系统通道。 |
| `MessageStatus` | Message 聚合状态，描述事件流是否仍可追加。 |
| `MessageEventCategory` | MessageEvent 分类，用于区分内容事件和生命周期/控制信号。 |
| `MessageEventKind` | MessageEvent 种类，定义消息事件流可承载的事件形态。 |
| `MessageSignalType` | Message signal 类型，描述消息或 turn 的生命周期推进原因。 |
| `MessageContextKind` | MessageContext 类型，描述终态消息上下文的来源和压缩方式。 |
| `MessageDispatchStatus` | MessageDispatch 状态，描述被投递消息对目标 snail 的消费进度。 |
| `ArtifactStatus` | Artifact 状态，描述正式产物从草稿到归档的生命周期。 |
| `ArtifactStorageType` | Artifact 存储方式，描述产物正文或引用落在哪种介质中。 |

## Project

Project 表示一个完整工作空间项目，是 Feature 和 Stage 的顶层归属。

| 字段 | 说明 |
| --- | --- |
| `id` | Project 唯一标识。 |
| `kind` | Project 类型，决定系统自举或产品交付语义。 |
| `name` | Project 名称。 |
| `summary` | Project 摘要，用于描述长期目标或背景。 |
| `status` | Project 当前状态。 |
| `created_at` | Project 创建时间。 |
| `updated_at` | Project 最近更新时间。 |

## Feature

Feature 表示一个可独立追踪的需求、修复或治理任务。

| 字段 | 说明 |
| --- | --- |
| `id` | Feature 唯一标识。 |
| `project_id` | 所属 Project ID。 |
| `title` | Feature 标题。 |
| `summary` | Feature 摘要。 |
| `status` | Feature 当前状态。 |
| `branch_name` | Feature 对应研发分支名。 |
| `worktree_path` | Feature 对应隔离 worktree 路径。 |
| `pr_url` | Feature 对应 PR 地址。 |
| `created_at` | Feature 创建时间。 |
| `updated_at` | Feature 最近更新时间。 |
| `closed_at` | Feature 关闭时间。 |

## Stage

Stage 表示 Feature 工作流中的一个阶段实例。

| 字段 | 说明 |
| --- | --- |
| `id` | Stage 唯一标识。 |
| `project_id` | 所属 Project ID。 |
| `feature_id` | 所属 Feature ID。 |
| `type` | Stage 类型，对应 `.meta/stages.json` 中的阶段定义。 |
| `sequence` | Stage 在当前 Feature 内的顺序号。 |
| `status` | Stage 当前状态。 |
| `formal_artifacts` | 当前 Stage 已登记的正式产物 ID 列表。 |
| `created_at` | Stage 创建时间。 |
| `updated_at` | Stage 最近更新时间。 |
| `entered_at` | Stage 进入时间。 |
| `left_at` | Stage 离开时间。 |

## RuntimeSessionBinding

RuntimeSessionBinding 记录某个 snail 在 conversation 中复用的外部会话。

| 字段 | 说明 |
| --- | --- |
| `sessionId` | 外部 agent runtime 的 session ID。 |

## Conversation

Conversation 表示某个 Stage 下的一条可追加消息的协作线程。

| 字段 | 说明 |
| --- | --- |
| `id` | Conversation 唯一标识。 |
| `project_id` | 所属 Project ID。 |
| `feature_id` | 所属 Feature ID。 |
| `stage_id` | 所属 Stage ID。 |
| `title` | Conversation 标题。 |
| `kind` | Conversation 类型，用于区分讨论、研发、检视等场景。 |
| `status` | Conversation 当前状态。 |
| `default_snail` | 没有显式 mention 时默认响应的 snail。 |
| `participating_snails` | 当前 Conversation 允许参与协作的 snail 列表。 |
| `summary` | Conversation 摘要，用于压缩历史上下文。 |
| `from_conversation_ids` | 来源 Conversation ID 列表，用于记录跨会话承接关系。 |
| `runtime_sessions` | 各 snail 当前绑定的外部 runtime session。 |
| `created_at` | Conversation 创建时间。 |
| `updated_at` | Conversation 最近更新时间。 |

## Message

Message 表示会话中的一条消息实体，正文通过 MessageEvent 承载。

| 字段 | 说明 |
| --- | --- |
| `id` | Message 唯一标识，也是上下文截断边界使用的单调递增基准。 |
| `conversation_id` | 所属 Conversation ID。 |
| `client_id` | 前端 optimistic 消息的客户端临时 ID，用于服务端确认后去重。 |
| `from_snail` | 消息发送方 snail；系统通知可为 null。 |
| `to_snails` | 消息投递目标 snail 列表，是消息级路由结果。 |
| `role` | 消息角色，用于区分用户、agent 和系统消息。 |
| `quoted_message_id` | 当前消息引用的历史消息 ID，仅用于 UI 展示和追溯。 |
| `context_cutoff_at` | 创建当前消息时，其可见上下文截止到的历史 message id。字段名保留历史上的 `_at` 后缀，但这里不能写入时间戳；消息投递和 agent 输入依赖稳定的消息 ID 边界，否则同秒消息或时钟差异会让上下文窗口包含错误消息。 |
| `runtime` | 生成该消息的 runtime；人工输入由 system 通道写入。 |
| `status` | 消息聚合状态，非 streaming 状态不允许继续追加事件。 |
| `created_at` | Message 创建时间。 |
| `updated_at` | Message 最近更新时间。 |

## MessageContext

MessageContext 缓存终态消息可用于后续上下文的文本表示。

| 字段 | 说明 |
| --- | --- |
| `message_id` | 对应 Message ID。 |
| `kind` | 上下文生成方式。 |
| `context` | 可注入 prompt 的上下文文本。 |
| `updated_at` | MessageContext 最近更新时间。 |

## MessageEventSource

MessageEventSource 描述事件从 runtime、工具或系统通道进入的原始来源。

| 字段 | 说明 |
| --- | --- |
| `runtime_name` | 产生该事件的 runtime 名称。 |
| `runtime_event_type` | runtime 原始事件类型。 |
| `runtime_message_id` | runtime 原始 message id。 |
| `runtime_item_id` | runtime 原始 item id。 |
| `runtime_call_id` | runtime 原始 tool call id。 |
| `raw_event` | runtime 原始事件体，保留用于排查兼容性问题。 |
| `metadata` | 额外来源元数据。 |

## Message Event Payloads

| 类型 | 字段 | 说明 |
| --- | --- | --- |
| `StartEventPayload` | `role` | 事件流所属消息角色。 |
| `StartEventPayload` | `snail_name` | 产生消息的 snail 名称；系统消息可为 null。 |
| `StartEventPayload` | `runtime` | 产生消息的 runtime。 |
| `TextEventPayload` | `text` | 文本内容。 |
| `TextEventPayload` | `mentions` | 文本中已解析出的有效 mention 列表。 |
| `ContentBlockEventPayload` | `blocks` | 结构化内容块列表。 |
| `ContentBlockEventPayload` | `fallback_text` | 无法渲染结构化块时的降级文本。 |
| `ToolCallEventPayload` | `tool_name` | 工具名称。 |
| `ToolCallEventPayload` | `call_id` | runtime 或协议内的调用 ID。 |
| `ToolCallEventPayload` | `input` | 工具输入；敏感内容是否记录由上游调用方控制。 |
| `ToolCallEventPayload` | `title` | 可展示的工具调用标题。 |
| `ToolResultEventPayload` | `tool_name` | 工具名称。 |
| `ToolResultEventPayload` | `call_id` | 对应 ToolCallEventPayload.call_id。 |
| `ToolResultEventPayload` | `is_error` | 工具调用是否失败。 |
| `ToolResultEventPayload` | `output_text` | 工具标准输出或摘要。 |
| `ToolResultEventPayload` | `error_text` | 工具错误文本。 |
| `ToolResultEventPayload` | `metadata` | 工具结果附加元数据。 |
| `CommandEventPayload` | `command_id` | 命令事件 ID。 |
| `CommandEventPayload` | `command` | 被执行的命令文本。 |
| `CommandResultEventPayload` | `command_id` | 对应 CommandEventPayload.command_id。 |
| `CommandResultEventPayload` | `command` | 被执行的命令文本。 |
| `CommandResultEventPayload` | `output_text` | 命令输出文本。 |
| `CommandResultEventPayload` | `exit_code` | 命令退出码。 |
| `CommandResultEventPayload` | `is_error` | 命令是否失败。 |
| `CommandResultEventPayload` | `metadata` | 命令结果附加元数据。 |
| `SignalEventPayload` | `type` | 消息或 turn 的生命周期信号类型。 |
| `SignalEventPayload` | `reason` | 信号原因文本。 |
| `SignalEventPayload` | `detail` | 信号结构化详情。 |
| `ErrorEventPayload` | `source` | 错误来源。 |
| `ErrorEventPayload` | `message` | 错误文本。 |
| `ErrorEventPayload` | `detail` | 错误结构化详情。 |

## MessageEvent

MessageEvent 是消息事件流中的一条事件，所有事件在单条消息内按 `seq` 严格递增。

| 字段 | 说明 |
| --- | --- |
| `id` | MessageEvent 唯一标识。 |
| `message_id` | 所属 Message ID。 |
| `seq` | 单条 Message 内的事件序号。 |
| `category` | 事件分类。 |
| `kind` | 事件种类。 |
| `payload` | 事件载荷。 |
| `source` | 事件来源。 |
| `created_at` | 事件创建时间。 |

## PersistedMessageEventRow

PersistedMessageEventRow 是 `message_event` 表的原始行，`payload` 与 `source` 尚未反序列化。

| 字段 | 说明 |
| --- | --- |
| `id` | MessageEvent 唯一标识。 |
| `message_id` | 所属 Message ID。 |
| `seq` | 单条 Message 内的事件序号。 |
| `category` | 事件分类。 |
| `kind` | 事件种类。 |
| `payload` | JSON 序列化后的事件载荷。 |
| `source` | JSON 序列化后的事件来源。 |
| `created_at` | 事件创建时间。 |

## MessageWithEvents

MessageWithEvents 是带完整事件流和终态上下文的消息读取视图。

| 字段 | 说明 |
| --- | --- |
| `events` | 当前消息包含的所有事件，按 seq 升序排列。 |
| `context` | 当前消息的终态上下文；streaming 或尚未生成时为 null。 |

## MessageDispatch

MessageDispatch 表示某条消息被投递给哪个 snail 消费。

| 字段 | 说明 |
| --- | --- |
| `id` | Dispatch 唯一标识。 |
| `conversation_id` | 所属 Conversation ID。 |
| `message_id` | 被投递的 Message ID。 |
| `to_snail` | 目标消费者 snail。 |
| `status` | 当前消费状态。 |
| `consumed_by_message_id` | 消费该 dispatch 后生成的回复 Message ID。 |
| `created_at` | Dispatch 创建时间。 |
| `consumed_at` | Dispatch 被消费或跳过的时间。 |

## DispatchInboxGroup

DispatchInboxGroup 是用于按目标 snail 和状态聚合 dispatch 的消费箱分组视图。

| 字段 | 说明 |
| --- | --- |
| `to_snail` | 该组 dispatch 的目标 snail。 |
| `status` | 该组 dispatch 的状态。 |
| `dispatch_ids` | 当前组内的 dispatch ID 列表。 |
| `message_ids` | 当前组内关联的 message ID 列表。 |
| `latest_dispatch_at` | 当前组内最近一条 dispatch 的创建时间。 |

## DispatchInboxPreviewItem

DispatchInboxPreviewItem 用于 UI 展示待处理消息摘要。

| 字段 | 说明 |
| --- | --- |
| `message_id` | 预览项对应的 Message ID。 |
| `from_snail` | 消息发送方 snail。 |
| `role` | 消息角色。 |
| `preview` | 消息预览文本。 |
| `created_at` | 消息创建时间。 |

## ConversationHistorySearchResult

ConversationHistorySearchResult 表示 Conversation 历史搜索结果。

| 字段 | 说明 |
| --- | --- |
| `message_id` | 命中的 Message ID。 |
| `role` | 命中消息角色。 |
| `from_snail` | 命中消息发送方 snail。 |
| `created_at` | 命中消息创建时间。 |
| `snippet` | FTS 生成的摘要片段。 |

## CreateMessageInput

CreateMessageInput 是创建 Message 时的输入结构。

| 字段 | 说明 |
| --- | --- |
| `conversationId` | 所属 Conversation ID。 |
| `clientId` | 前端 optimistic 消息的客户端临时 ID。 |
| `fromSnail` | 消息发送方 snail；系统通知可为 null。 |
| `toSnails` | 消息投递目标 snail 列表。 |
| `role` | 消息角色。 |
| `quotedMessageId` | 被引用的历史消息 ID，仅用于 UI 展示和追溯。 |
| `contextCutoffAt` | 创建当前消息时，其可见上下文截止到的历史 message id。该字段沿用数据库旧字段名，不表示时间；调用方应传入 `String(lastVisibleMessageId)`，空会话传入 `"0"`。 |
| `runtime` | 生成该消息的 runtime。 |
| `status` | 初始消息状态。 |

## CreateMessageDispatchInput

CreateMessageDispatchInput 是创建 MessageDispatch 时的输入结构。

| 字段 | 说明 |
| --- | --- |
| `conversationId` | 所属 Conversation ID。 |
| `messageId` | 被投递的 Message ID。 |
| `toSnail` | 目标消费者 snail。 |

## Artifact

Artifact 表示阶段中沉淀出的正式或过程产物。

| 字段 | 说明 |
| --- | --- |
| `id` | Artifact 唯一标识。 |
| `project_id` | 所属 Project ID。 |
| `feature_id` | 所属 Feature ID。 |
| `stage_id` | 所属 Stage ID。 |
| `conversation_id` | 所属 Conversation ID。 |
| `artifact_type` | Artifact 类型，对应 `.meta/artifacts.json`。 |
| `title` | Artifact 标题。 |
| `status` | Artifact 当前状态。 |
| `storage_type` | Artifact 正文存储方式。 |
| `file_path` | 文件型产物路径。 |
| `inline_content` | 内联型产物正文。 |
| `external_ref` | 外部引用型产物地址。 |
| `metadata` | Artifact 附加元数据。 |
| `created_at` | Artifact 创建时间。 |
| `updated_at` | Artifact 最近更新时间。 |

## CreateStageInput

CreateStageInput 是创建 Stage 时的输入结构。

| 字段 | 说明 |
| --- | --- |
| `id` | Stage ID。 |
| `projectId` | 所属 Project ID。 |
| `featureId` | 所属 Feature ID。 |
| `type` | Stage 类型。 |
| `sequence` | Stage 顺序号。 |
| `status` | Stage 初始状态。 |
| `formalArtifacts` | 初始正式产物 ID 列表。 |
| `enteredAt` | Stage 进入时间。 |

## CreateConversationInput

CreateConversationInput 是创建 Conversation 时的输入结构。

| 字段 | 说明 |
| --- | --- |
| `id` | Conversation ID。 |
| `projectId` | 所属 Project ID。 |
| `featureId` | 所属 Feature ID。 |
| `stageId` | 所属 Stage ID。 |
| `title` | Conversation 标题。 |
| `kind` | Conversation 类型。 |
| `defaultSnail` | 默认响应 snail。 |
| `participatingSnails` | 允许参与协作的 snail 列表。 |
| `summary` | 初始 Conversation 摘要。 |
| `fromConversationIds` | 来源 Conversation ID 列表。 |

## ArtifactContentOptions

ArtifactContentOptions 描述不同 `storage_type` 对应的正文输入。

| 字段 | 说明 |
| --- | --- |
| `filePath` | 文件型产物路径。 |
| `inlineContent` | 内联型产物正文。 |
| `externalRef` | 外部引用型产物地址。 |
| `metadata` | Artifact 附加元数据。 |

## CreateArtifactInput

CreateArtifactInput 是创建 Artifact 时的输入结构。

| 字段 | 说明 |
| --- | --- |
| `id` | Artifact ID。 |
| `projectId` | 所属 Project ID。 |
| `featureId` | 所属 Feature ID。 |
| `stageId` | 所属 Stage ID。 |
| `conversationId` | 所属 Conversation ID。 |
| `artifactType` | Artifact 类型。 |
| `title` | Artifact 标题。 |
| `status` | Artifact 初始状态。 |
| `storageType` | Artifact 存储方式。 |
| `options` | Artifact 内容选项。 |
