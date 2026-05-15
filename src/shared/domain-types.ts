import type { SnailName, StageType } from "../meta/generated-types";

export type { SnailName, StageType };
export type { MessageArtifactCardBlock, MessageChartBlock, MessageContentBlock, MessageIconBlock, MessageImageBlock, MessageMarkdownBlock, MessageQuestionBlock, MessageQuestionResponseBlock, MessageReferenceCardBlock, MessageRichTextBlock, MessageTableBlock, MessageTextBlock, MessageToolCallCardBlock, QuestionOptionPayload, QuestionResponseSelectedOptionPayload } from "./message-types";
import type { MessageContentBlock } from "./message-types";

export type ProjectKind = "system_self" | "product_delivery";
export type ProjectStatus = "active" | "paused" | "completed" | "cancelled" | "archived";
export type FeatureStatus = "active" | "in_review" | "waiting_merge" | "completed" | "cancelled" | "archived";
export type StageStatus = "in_progress" | "completed" | "cancelled";
export type ConversationKind = "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";
export type ConversationOwnerType = "project_stage" | "knowledge_governance";
export type ConversationStatus = "active" | "paused" | "completed" | "archived";
export type MessageRole = "user" | "assistant" | "system";
export type MessageRuntime = "claude" | "opencode" | "codex" | "system" | "unknown";
export type MessageStatus = "streaming" | "completed" | "failed" | "interrupted" | "cancelled";
export type MessageEventCategory = "content" | "signal";
export type MessageEventKind = "start" | "text" | "content_block" | "tool_call" | "tool_result" | "command" | "command_result" | "signal" | "error";
export type MessageSignalType = "step_start" | "step_finish" | "turn_started" | "turn_completed" | "runtime_usage" | "message_completed" | "message_failed" | "message_interrupted" | "message_cancelled";
export type MessageContextKind = "final_text" | "message_out" | "event_summary" | "llm_summary";
export type MessageDispatchStatus = "pending" | "seen" | "consumed" | "skipped";

export interface Project {
  /** Project 唯一标识。 */
  id: string;
  /** Project 类型，决定系统自举或产品交付语义。 */
  kind: ProjectKind;
  /** Project 名称。 */
  name: string;
  /** Project 摘要，用于描述长期目标或背景。 */
  summary: string | null;
  /** Project 当前状态。 */
  status: ProjectStatus;
  /** Project 创建时间。 */
  created_at: string;
  /** Project 最近更新时间。 */
  updated_at: string;
}

/** 项目级 Stage 定义，描述一个 Stage 的配置。 */
export interface ProjectStageDefinition {
  /** 唯一标识。 */
  id: string;
  /** 所属项目 ID。 */
  project_id: string;
  /** Stage 标识符，如 development、review。 */
  key: string;
  /** 显示名称。 */
  title: string;
  /** 排序序号。 */
  sequence: number;
  /** 输入要求描述。 */
  input_description: string | null;
  /** 产出要求描述。 */
  output_description: string | null;
  /** 验收要点，JSON 字符串数组。 */
  acceptance_focus: string[];
  /** 创建时间。 */
  created_at: string;
  /** 最近更新时间。 */
  updated_at: string;
}

/** Stage 内角色定义。 */
export interface StageRoleDefinition {
  /** 唯一标识。 */
  id: string;
  /** 所属项目 ID。 */
  project_id: string;
  /** 所属 Stage 定义 ID。 */
  stage_definition_id: string;
  /** 角色显示名，用于 conversation/message 路由。 */
  name: string;
  /** 引用的 snail den template ID。 */
  snail_template_id: string | null;
  /** 是否为该 Stage 的主角色。 */
  is_primary: number;
  /** 角色描述。 */
  description: string;
  /** 角色能力期望，JSON 字符串数组。 */
  capability_expectations: string[];
  /** 该角色在本 Stage 的工作规则，JSON 字符串数组。 */
  working_rules: string[];
  /** 偏好产物类型，JSON 字符串数组。 */
  preferred_artifact_types: string[];
  /** 创建时间。 */
  created_at: string;
  /** 最近更新时间。 */
  updated_at: string;
}

export interface Feature {
  /** Feature 唯一标识。 */
  id: string;
  /** 所属 Project ID。 */
  project_id: string;
  /** Feature 标题。 */
  title: string;
  /** Feature 摘要。 */
  summary: string | null;
  /** Feature 当前状态。 */
  status: FeatureStatus;
  /** Feature 对应研发分支名。 */
  branch_name: string | null;
  /** Feature 对应隔离 worktree 路径。 */
  worktree_path: string | null;
  /** Feature 对应 PR 地址。 */
  pr_url: string | null;
  /** Feature 创建时间。 */
  created_at: string;
  /** Feature 最近更新时间。 */
  updated_at: string;
  /** Feature 关闭时间。 */
  closed_at: string | null;
}

export interface Stage {
  /** Stage 唯一标识。 */
  id: string;
  /** 所属 Project ID。 */
  project_id: string;
  /** 所属 Feature ID。 */
  feature_id: string;
  /** 关联的 Stage 定义 ID。 */
  stage_definition_id: string;
  /** Stage 类型，与 definition.key 一致。 */
  type: StageType;
  /** Stage 在当前 Feature 内的顺序号。 */
  sequence: number;
  /** Stage 当前状态。 */
  status: StageStatus;
  /** 输入产物 ID 列表，JSON 数组。 */
  input_artifacts: string[];
  /** 输出产物 ID 列表，JSON 数组。 */
  output_artifacts: string[];
  /** Stage 进入时间。 */
  entered_at: string | null;
  /** Stage 离开时间。 */
  left_at: string | null;
}

export interface RuntimeSessionBinding {
  /** 外部 agent runtime 的 session ID。 */
  sessionId: string;
}

export interface Conversation {
  /** Conversation 唯一标识。 */
  id: string;
  project_id: string | null;
  feature_id: string | null;
  stage_id: string | null;
  owner_type: ConversationOwnerType;
  owner_id: string | null;
  /** Conversation 标题。 */
  title: string;
  /** Conversation 类型，用于区分讨论、研发、检视等场景。 */
  kind: ConversationKind;
  /** Conversation 当前状态。 */
  status: ConversationStatus;
  /** 没有显式 mention 时默认响应的 snail。 */
  default_snail: SnailName;
  /** 当前 Conversation 允许参与协作的 snail 列表。 */
  participating_snails: SnailName[];
  /** Conversation 摘要，用于压缩历史上下文。 */
  summary: string | null;
  /** 来源 Conversation ID 列表，用于记录跨会话承接关系。 */
  from_conversation_ids: string[];
  /** 各 snail 当前绑定的外部 runtime session。 */
  runtime_sessions: Partial<Record<SnailName, RuntimeSessionBinding>>;
  /** Conversation 创建时间。 */
  created_at: string;
  /** Conversation 最近更新时间。 */
  updated_at: string;
}

export interface Message {
  /** Message 唯一标识，也是上下文截断边界使用的单调递增基准。 */
  id: number;
  /** 所属 Conversation ID。 */
  conversation_id: string;
  /** 前端 optimistic 消息的客户端临时 ID，用于服务端确认后去重。 */
  client_id: string | null;
  /** 消息发送方 snail；系统通知可为 null。 */
  from_snail: SnailName | null;
  /** 消息投递目标 snail 列表，是消息级路由结果。 */
  to_snails: SnailName[];
  /** 消息角色，用于区分用户、agent 和系统消息。 */
  role: MessageRole;
  /** 当前消息引用的历史消息 ID，仅用于 UI 展示和追溯。 */
  quoted_message_id: number | null;
  /**
   * 创建当前消息时，其可见上下文截止到的历史 message id。
   *
   * 字段名保留历史上的 `_at` 后缀，但这里不能写入时间戳；消息投递和 agent 输入依赖稳定的消息 ID 边界，
   * 否则同秒消息或时钟差异会让上下文窗口包含错误消息。
   */
  context_cutoff_at: string;
  /** 生成该消息的 runtime；人工输入由 system 通道写入。 */
  runtime: MessageRuntime | null;
  /** 消息聚合状态，非 streaming 状态不允许继续追加事件。 */
  status: MessageStatus;
  /** Message 创建时间。 */
  created_at: string;
  /** Message 最近更新时间。 */
  updated_at: string;
}

export interface MessageContext {
  /** 对应 Message ID。 */
  message_id: number;
  /** 上下文生成方式。 */
  kind: MessageContextKind;
  /** 可注入 prompt 的上下文文本。 */
  context: string;
  /** MessageContext 最近更新时间。 */
  updated_at: string;
}

export interface MessageEventSource {
  /** 产生该事件的 runtime 名称。 */
  runtime_name: MessageRuntime | null;
  /** runtime 原始事件类型。 */
  runtime_event_type: string | null;
  /** runtime 原始 message id。 */
  runtime_message_id: string | null;
  /** runtime 原始 item id。 */
  runtime_item_id: string | null;
  /** runtime 原始 tool call id。 */
  runtime_call_id: string | null;
  /** runtime 原始事件体，保留用于排查兼容性问题。 */
  raw_event: Record<string, unknown> | null;
  /** 额外来源元数据。 */
  metadata: Record<string, unknown> | null;
}

/** Message start 事件载荷，标记消息事件流正式开始。 */
export interface StartEventPayload {
  /** 事件流所属消息角色。 */
  role: MessageRole;
  /** 产生消息的 snail 名称；系统消息可为 null。 */
  snail_name: SnailName | string | null;
  /** 产生消息的 runtime。 */
  runtime: MessageRuntime | null;
}

/** 纯文本内容事件载荷。 */
export interface TextEventPayload {
  /** 文本内容。 */
  text: string;
  /** 文本中已解析出的有效 mention 列表。 */
  mentions: SnailName[];
}

/** 结构化内容块事件载荷，用于 message-out 等富内容输出。 */
export interface ContentBlockEventPayload {
  /** 结构化内容块列表。 */
  blocks: MessageContentBlock[];
  /** 无法渲染结构化块时的降级文本。 */
  fallback_text: string | null;
}

/** 工具调用事件载荷，记录一次 tool call 的输入摘要。 */
export interface ToolCallEventPayload {
  /** 工具名称。 */
  tool_name: string;
  /** runtime 或协议内的调用 ID。 */
  call_id: string;
  /** 工具输入；敏感内容是否记录由上游调用方控制。 */
  input: Record<string, unknown> | null;
  /** 可展示的工具调用标题。 */
  title: string | null;
}

/** 工具结果事件载荷，记录工具完成后的输出或错误。 */
export interface ToolResultEventPayload {
  /** 工具名称。 */
  tool_name: string;
  /** 对应 ToolCallEventPayload.call_id。 */
  call_id: string;
  /** 工具调用是否失败。 */
  is_error: boolean;
  /** 工具标准输出或摘要。 */
  output_text: string | null;
  /** 工具错误文本。 */
  error_text: string | null;
  /** 工具结果附加元数据。 */
  metadata: Record<string, unknown> | null;
}

export interface CommandEventPayload {
  command_id: string;
  command: string;
}

export interface CommandResultEventPayload {
  command_id: string;
  command: string;
  output_text: string | null;
  exit_code: number | null;
  is_error: boolean;
  metadata: Record<string, unknown> | null;
}

export interface SignalEventPayload {
  type: MessageSignalType;
  reason: string | null;
  detail: Record<string, unknown> | null;
}

export interface ErrorEventPayload {
  source: "runtime" | "tool" | "command" | "system" | "transport";
  message: string;
  detail: Record<string, unknown> | null;
}

export type MessageEventPayload = StartEventPayload | TextEventPayload | ContentBlockEventPayload | ToolCallEventPayload | ToolResultEventPayload | CommandEventPayload | CommandResultEventPayload | SignalEventPayload | ErrorEventPayload;

/** MessageEvent 基础结构，所有事件在单条消息内按 seq 严格递增。 */
interface MessageEventBase<TKind extends MessageEventKind, TPayload extends MessageEventPayload> {
  /** MessageEvent 唯一标识。 */
  id: number;
  /** 所属 Message ID。 */
  message_id: number;
  /** 单条 Message 内的事件序号。 */
  seq: number;
  /** 事件分类。 */
  category: MessageEventCategory;
  /** 事件种类。 */
  kind: TKind;
  /** 事件载荷。 */
  payload: TPayload;
  /** 事件来源。 */
  source: MessageEventSource;
  /** 事件创建时间。 */
  created_at: string;
}

export type StartMessageEvent = MessageEventBase<"start", StartEventPayload>;
export type TextMessageEvent = MessageEventBase<"text", TextEventPayload>;
export type ContentBlockMessageEvent = MessageEventBase<"content_block", ContentBlockEventPayload>;
export type ToolCallMessageEvent = MessageEventBase<"tool_call", ToolCallEventPayload>;
export type ToolResultMessageEvent = MessageEventBase<"tool_result", ToolResultEventPayload>;
export type CommandMessageEvent = MessageEventBase<"command", CommandEventPayload>;
export type CommandResultMessageEvent = MessageEventBase<"command_result", CommandResultEventPayload>;
export type SignalMessageEvent = MessageEventBase<"signal", SignalEventPayload>;
export type ErrorMessageEvent = MessageEventBase<"error", ErrorEventPayload>;
export type MessageEvent = StartMessageEvent | TextMessageEvent | ContentBlockMessageEvent | ToolCallMessageEvent | ToolResultMessageEvent | CommandMessageEvent | CommandResultMessageEvent | SignalMessageEvent | ErrorMessageEvent;

/** message_event 表的原始行，payload 与 source 尚未反序列化。 */
export interface PersistedMessageEventRow {
  /** MessageEvent 唯一标识。 */
  id: number;
  /** 所属 Message ID。 */
  message_id: number;
  /** 单条 Message 内的事件序号。 */
  seq: number;
  /** 事件分类。 */
  category: MessageEventCategory;
  /** 事件种类。 */
  kind: MessageEventKind;
  /** JSON 序列化后的事件载荷。 */
  payload: string;
  /** JSON 序列化后的事件来源。 */
  source: string;
  /** 事件创建时间。 */
  created_at: string;
}

export type CreateMessageEventInput =
  | { kind: "start"; payload: StartEventPayload; source?: Partial<MessageEventSource> }
  | { kind: "text"; payload: TextEventPayload; source?: Partial<MessageEventSource> }
  | { kind: "content_block"; payload: ContentBlockEventPayload; source?: Partial<MessageEventSource> }
  | { kind: "tool_call"; payload: ToolCallEventPayload; source?: Partial<MessageEventSource> }
  | { kind: "tool_result"; payload: ToolResultEventPayload; source?: Partial<MessageEventSource> }
  | { kind: "command"; payload: CommandEventPayload; source?: Partial<MessageEventSource> }
  | { kind: "command_result"; payload: CommandResultEventPayload; source?: Partial<MessageEventSource> }
  | { kind: "signal"; payload: SignalEventPayload; source?: Partial<MessageEventSource> }
  | { kind: "error"; payload: ErrorEventPayload; source?: Partial<MessageEventSource> };

/** 带完整事件流和终态上下文的消息读取视图。 */
export interface MessageWithEvents extends Message {
  /** 当前消息包含的所有事件，按 seq 升序排列。 */
  events: MessageEvent[];
  /** 当前消息的终态上下文；streaming 或尚未生成时为 null。 */
  context: MessageContext | null;
}

/** MessageDispatch 表，表示某条消息被投递给哪个 snail 消费。 */
export interface MessageDispatch {
  /** Dispatch 唯一标识。 */
  id: number;
  /** 所属 Conversation ID。 */
  conversation_id: string;
  /** 被投递的 Message ID。 */
  message_id: number;
  /** 目标消费者 snail。 */
  to_snail: SnailName;
  /** 当前消费状态。 */
  status: MessageDispatchStatus;
  /** 消费该 dispatch 后生成的回复 Message ID。 */
  consumed_by_message_id: number | null;
  /** Dispatch 创建时间。 */
  created_at: string;
  /** Dispatch 被消费或跳过的时间。 */
  consumed_at: string | null;
}

/** 消费箱分组视图，用于按目标 snail 和状态聚合 dispatch。 */
export interface DispatchInboxGroup {
  /** 该组 dispatch 的目标 snail。 */
  to_snail: SnailName;
  /** 该组 dispatch 的状态。 */
  status: MessageDispatchStatus;
  /** 当前组内的 dispatch ID 列表。 */
  dispatch_ids: number[];
  /** 当前组内关联的 message ID 列表。 */
  message_ids: number[];
  /** 当前组内最近一条 dispatch 的创建时间。 */
  latest_dispatch_at: string;
}

/** 消费箱消息预览项，用于 UI 展示待处理消息摘要。 */
export interface DispatchInboxPreviewItem {
  /** 预览项对应的 Message ID。 */
  message_id: number;
  /** 消息发送方 snail。 */
  from_snail: SnailName | null;
  /** 消息角色。 */
  role: MessageRole;
  /** 消息预览文本。 */
  preview: string;
  /** 消息创建时间。 */
  created_at: string;
}

/** Conversation 历史搜索结果。 */
export interface ConversationHistorySearchResult {
  /** 命中的 Message ID。 */
  message_id: number;
  /** 命中消息角色。 */
  role: MessageRole;
  /** 命中消息发送方 snail。 */
  from_snail: SnailName | null;
  /** 命中消息创建时间。 */
  created_at: string;
  /** FTS 生成的摘要片段。 */
  snippet: string;
}

/** 创建 Message 时的输入结构。 */
export interface CreateMessageInput {
  /** 所属 Conversation ID。 */
  conversationId: string;
  /** 前端 optimistic 消息的客户端临时 ID。 */
  clientId?: string | null;
  /** 消息发送方 snail；系统通知可为 null。 */
  fromSnail: SnailName | null;
  /** 消息投递目标 snail 列表。 */
  toSnails: SnailName[];
  /** 消息角色。 */
  role: MessageRole;
  /** 被引用的历史消息 ID，仅用于 UI 展示和追溯。 */
  quotedMessageId?: number | null;
  /**
   * 创建当前消息时，其可见上下文截止到的历史 message id。
   *
   * 该字段沿用数据库旧字段名，不表示时间；调用方应传入 `String(lastVisibleMessageId)`，空会话传入 `"0"`。
   */
  contextCutoffAt?: string;
  /** 生成该消息的 runtime。 */
  runtime?: MessageRuntime | null;
  /** 初始消息状态。 */
  status?: MessageStatus;
}

/** 创建 MessageDispatch 时的输入结构。 */
export interface CreateMessageDispatchInput {
  /** 所属 Conversation ID。 */
  conversationId: string;
  /** 被投递的 Message ID。 */
  messageId: number;
  /** 目标消费者 snail。 */
  toSnail: SnailName;
}

/** 创建 Stage 时的输入结构。 */
export interface CreateStageInput {
  /** Stage ID。 */
  id: string;
  /** 所属 Project ID。 */
  projectId: string;
  /** 所属 Feature ID。 */
  featureId: string;
  /** 关联的 Stage 定义 ID。 */
  stageDefinitionId: string;
  /** Stage 类型。 */
  type: StageType;
  /** Stage 顺序号。 */
  sequence: number;
  /** Stage 初始状态。 */
  status: StageStatus;
  /** 初始输入产物 ID 列表。 */
  inputArtifacts?: string[];
  /** 初始输出产物 ID 列表。 */
  outputArtifacts?: string[];
  /** Stage 进入时间。 */
  enteredAt?: string | null;
}

/** 创建 Conversation 时的输入结构。 */
export interface CreateConversationInput {
  /** Conversation ID。 */
  id: string;
  projectId: string | null;
  featureId: string | null;
  stageId: string | null;
  ownerType?: ConversationOwnerType;
  ownerId?: string | null;
  /** Conversation 标题。 */
  title: string;
  /** Conversation 类型。 */
  kind: ConversationKind;
  /** 默认响应 snail。 */
  defaultSnail: SnailName;
  /** 允许参与协作的 snail 列表。 */
  participatingSnails: SnailName[];
  /** 初始 Conversation 摘要。 */
  summary?: string;
  /** 来源 Conversation ID 列表。 */
  fromConversationIds?: string[];
}
