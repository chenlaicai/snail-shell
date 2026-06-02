/** 阶段验收清单项。定义在 stage_definition 上，描述该阶段需要满足的验收条件。 */
export interface StageChecklistItem {
  id: string;
  description: string;
  required: boolean;
}

/** Gate 产物：AI 对某一项 checklist 的自查结果。 */
export interface StageGateArtifact {
  checklistId: string;
  status: "passed" | "failed" | "skipped";
  evidence: string;
}

/** Gate 证据：AI 准备的完整自查结果，写入 stage.gate_evidence。 */
export interface StageGateEvidence {
  items: StageGateArtifact[];
  preparedAt: string;
  preparedBy: string;
}

/**
 * Template 运行时绑定：从 role→snail→template 解析出的运行时参数。
 *
 * Why: 独立为顶层类型，供 InvocationSubject 和 CollaborationDeps.resolveRoleTemplate
 * 共享引用，避免两处内联定义未来不同步。
 */
export interface RuntimeBinding {
  templateId: string;
  runtime: string;
  model: string;
  contextProvider: "shell" | "agent";
  contextWindow?: number;
  invocationTimeoutMs?: number;
}

/**
 * 调用主体：每次 agent 调用前从当前运行态解析出的结构化对象。
 *
 * Why: 将 role/runtime/capability/session 信息打包为一个对象，
 * 让下游不再反查 role→snail→runtime 链路。
 */
export interface InvocationSubject {
  workspaceId: string;
  issueId: string;
  stageId: string;
  conversationId: string;
  role: {
    key: string;
    name: string;
    description: string;
    rules: string[];
    handbookPromptRef: string | null;
    isPrimary: boolean;
  };
  runtimeBinding: RuntimeBinding;
  gateArtifacts?: StageGateArtifact[];
}

export type RoleName = string;
export type StageType = string;
export type { MessageArtifactCardBlock, MessageChartBlock, MessageContentBlock, MessageIconBlock, MessageImageBlock, MessageMarkdownBlock, MessageQuestionBlock, MessageQuestionResponseBlock, MessageReferenceCardBlock, MessageRichTextBlock, MessageTableBlock, MessageTextBlock, MessageToolCallCardBlock, QuestionOptionPayload, QuestionResponseSelectedOptionPayload } from "./message-types";
import type { MessageContentBlock } from "./message-types";

export type WorkspaceModule = "workspace_management" | "evolution";
export type StageStatus = "in_progress" | "completed" | "cancelled";
export type ConversationKind = "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";
export type ConversationOwnerType = "workspace_stage" | "evolution";
export type ConversationStatus = "active" | "paused" | "completed" | "archived";
export type MessageRole = "user" | "assistant" | "system";
export type MessageRuntime = "claude" | "opencode" | "codex" | "system" | "unknown";
export type MessageStatus = "streaming" | "completed" | "failed" | "interrupted" | "cancelled" | "pending_approval";
export type MessageEventCategory = "content" | "signal";
export type MessageEventKind = "start" | "text" | "content_block" | "tool_call" | "tool_result" | "command" | "command_result" | "signal" | "error";
export type MessageSignalType = "step_start" | "step_finish" | "turn_started" | "turn_completed" | "runtime_usage" | "message_completed" | "message_failed" | "message_interrupted" | "message_cancelled" | "permission_blocked" | "message_pending_approval";
export type MessageContextKind = "final_text" | "message_out" | "event_summary" | "llm_summary" | "mcp_final_body";
export type MessageDispatchStatus = "pending" | "seen" | "consumed" | "skipped";

export interface Workspace {
  id: string;
  module: WorkspaceModule;
  name: string;
  summary: string | null;
  /** 工作区工作目录绝对路径。agent spawn cwd、.claude/、.codex/ 等均基于此路径。 */
  workspace_root: string;
  created_at: string;
  updated_at: string;
  guard_profile: Record<string, unknown> | null;
}

/** 工作区级 Stage 定义，描述一个 Stage 的配置。 */
export interface WorkspaceStageDefinition {
  /** 唯一标识。 */
  id: string;
  /** 所属工作区 ID。 */
  workspace_id: string;
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
  /** 阶段验收清单。每项包含 id、description、required。 */
  acceptance_checklist: StageChecklistItem[];
  /** 创建时间。 */
  created_at: string;
  /** 最近更新时间。 */
  updated_at: string;
}

/** Stage 内角色定义。 */
export interface StageRoleDefinition {
  /** 唯一标识。 */
  id: string;
  /** 所属 Stage 定义 ID。 */
  stage_definition_id: string;
  /** 角色标识符，如 developer、reviewer。 */
  key: string;
  /** 角色显示名，用于 conversation/message 路由。 */
  name: string;
  /** 引用的 snail den template ID，来自 workspace_sop.role_bindings 运行时绑定。 */
  snail_template_id: string | null;
  /** 是否为该 Stage 的主角色。 */
  is_primary: number;
  /** 该角色在本 Stage 的实例数（如 count=2 展开为 "检视者-1"、"检视者-2"）。 */
  count: number;
  /** 角色描述。 */
  description: string;
  /** 角色手册 prompt 引用，格式 "global:S-03"。 */
  handbook_prompt_ref: string | null;
  /** 该角色在本 Stage 的工作规则。 */
  working_rules: string[];
}

export interface Sop {
  id: string;
  /** SOP 来源：platform（平台预设）或 workspace（某 workspace 创建）。语义是"谁创建的"，不是"谁能用"。 */
  source: "platform" | "workspace";
  /** workspace 级 SOP 指向创建它的 workspace_id，platform 级为 null。 */
  source_ref: string | null;
  key: string;
  name: string;
  description: string | null;
  /** SOP 首 stage key，创建 feature 时从此 stage 开始。null 时 fallback 到 sequence 最小的 stage。 */
  first_stage: string | null;
  created_at: string;
  updated_at: string;
}

/** SOP 转移守卫配置。 */
export interface TransitionGuard {
  /**
   * 守卫类型。当前仅支持 requires_artifacts。
   * 使用 string 而非字面量联合类型，以便在 checkGuard 中捕获未知类型并抛错，
   * 而非在类型检查阶段就阻止非法值进入运行时。
   */
  type: string;
  /** 守卫参数。requires_artifacts 时为必须存在的 artifact key 列表。 */
  config: Record<string, unknown>;
}

/** SOP 转移边定义，描述 stage 之间的有向转移关系。 */
export interface SopTransition {
  id: string;
  /** 所属 SOP ID。 */
  sop_id: string;
  /** 源 stage key。 */
  from_stage_key: string;
  /** 目标 stage key。 */
  to_stage_key: string;
  /** 转移守卫，null 表示无条件允许。 */
  guard: TransitionGuard | null;
}

export interface SopStageDefinition {
  id: string;
  sop_id: string;
  key: string;
  title: string;
  sequence: number;
  input_description: string | null;
  output_description: string | null;
  acceptance_focus: string[];
  /** 阶段验收清单，JSON 数组。每项包含 id、description、required。 */
  acceptance_checklist: StageChecklistItem[];
}

export interface WorkspaceSop {
  id: string;
  workspace_id: string;
  sop_id: string;
  is_default: number;
  role_bindings: Record<string, string | string[]>;
}

export interface Issue {
  id: string;
  workspace_id: string;
  title: string;
  summary: string | null;
  task_anchor: string | null;
  adopted_sop_id: string | null;
  role_snail_mapping: Record<string, Record<string, string>>;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Stage {
  /** Stage 唯一标识。 */
  id: string;
  /** 所属 Workspace ID。 */
  workspace_id: string;
  /** 所属 Issue ID。 */
  issue_id: string;
  /** 关联的 Stage 定义 ID。 */
  stage_definition_id: string;
  /** Stage 类型，与 definition.key 一致。 */
  type: StageType;
  /** Stage 在当前 Issue 内的顺序号。 */
  sequence: number;
  /** Stage 当前状态。 */
  status: StageStatus;
  /** 输出产物 Map，key 为产物名（如 branch_name、pr_url），value 为产物值。JSON object。值可以是字符串或数组（如 resources）。 */
  output_artifacts: Record<string, unknown>;
  /** AI 准备的 gate 证据，JSON 对象。推进前检查 required 项是否全部 passed。 */
  gate_evidence: StageGateEvidence | null;
  /** Stage 进入时间。 */
  entered_at: string | null;
  /** Stage 离开时间。 */
  left_at: string | null;
}

export interface Conversation {
  /** Conversation 唯一标识。 */
  id: string;
  workspace_id: string | null;
  issue_id: string | null;
  stage_id: string | null;
  owner_type: ConversationOwnerType;
  owner_id: string | null;
  /** Conversation 标题。 */
  title: string;
  /** Conversation 类型，用于区分讨论、研发、检视等场景。 */
  kind: ConversationKind;
  /** Conversation 当前状态。 */
  status: ConversationStatus;
  /** 历史存储/事件协议字段名：没有显式 mention 时默认响应的 role。 */
  default_role: RoleName;
  /** 历史存储/事件协议字段名：当前 Conversation 允许参与协作的 role 列表。 */
  participating_roles: RoleName[];
  /** Conversation 摘要，用于压缩历史上下文。 */
  summary: string | null;
  /** 来源 Conversation ID 列表，用于记录跨会话承接关系。 */
  from_conversation_ids: string[];
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
  /** 历史存储/事件协议字段名：消息发送方 role；系统通知可为 null。 */
  from_role: RoleName | null;
  /** 历史存储/事件协议字段名：消息投递目标 role 列表，是消息级路由结果。 */
  to_roles: RoleName[];
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
  /**
   * 原始事件只用于审计、调试和未来重新映射，不属于产品主语义。
   * 业务逻辑必须消费归一化后的 payload，避免把某个 CLI 的低层结构重新升级成平行消息模型。
   */
  raw_event: Record<string, unknown> | null;
  /** 额外来源元数据。 */
  metadata: Record<string, unknown> | null;
}

/** Message start 事件载荷，标记消息事件流正式开始。 */
export interface StartEventPayload {
  /** 事件流所属消息角色。 */
  role: MessageRole;
  /** 历史事件协议字段名：产生消息的 role 名称；系统消息可为 null。 */
  role_name: RoleName | string | null;
  /** 产生消息的 runtime。 */
  runtime: MessageRuntime | null;
}

/** 纯文本内容事件载荷。 */
export interface TextEventPayload {
  /** 文本内容。 */
  text: string;
  /** 文本中已解析出的有效 mention 列表。 */
  mentions: RoleName[];
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

/**
 * MessageEvent 是 Snail Shell 唯一的消息事件语言。
 * 内容事件和信号事件共享同一条有序流，防止前端、持久化层和运行时 adapter 各自维护平行正文或状态模型。
 */
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

/** MessageDispatch 表，表示某条消息被投递给哪个 role 消费。 */
export interface MessageDispatch {
  /** Dispatch 唯一标识。 */
  id: number;
  /** 所属 Conversation ID。 */
  conversation_id: string;
  /** 被投递的 Message ID。 */
  message_id: number;
  /** 历史存储/事件协议字段名：目标消费者 role。 */
  to_role: RoleName;
  /** 当前消费状态。 */
  status: MessageDispatchStatus;
  /** 消费该 dispatch 后生成的回复 Message ID。 */
  consumed_by_message_id: number | null;
  /** Dispatch 创建时间。 */
  created_at: string;
  /** Dispatch 被消费或跳过的时间。 */
  consumed_at: string | null;
}

/** 消费箱分组视图，用于按目标 role 和状态聚合 dispatch。 */
export interface DispatchInboxGroup {
  /** 该组 dispatch 的目标 role。 */
  to_role: RoleName;
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
  /** 消息发送方 role。 */
  from_role: RoleName | null;
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
  /** 命中消息发送方 role。 */
  from_role: RoleName | null;
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
  /** 消息发送方 role；系统通知可为 null。 */
  fromRole: RoleName | null;
  /** 消息投递目标 role 列表。 */
  toRoles: RoleName[];
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
  /** 目标消费者 role。 */
  toRole: RoleName;
}

/** 创建 Stage 时的输入结构。 */
export interface CreateStageInput {
  /** Stage ID。 */
  id: string;
  /** 所属 Workspace ID。 */
  workspaceId: string;
  /** 所属 Issue ID。 */
  issueId: string;
  /** 关联的 Stage 定义 ID。 */
  stageDefinitionId: string;
  /** Stage 类型。 */
  type: StageType;
  /** Stage 顺序号。 */
  sequence: number;
  /** Stage 初始状态。 */
  status: StageStatus;
  /** 初始输出产物 Map。 */
  outputArtifacts?: Record<string, unknown>;
  /** Stage 进入时间。 */
  enteredAt?: string | null;
}

/** 创建 Conversation 时的输入结构。 */
export interface CreateConversationInput {
  /** Conversation ID。 */
  id: string;
  workspaceId: string | null;
  issueId: string | null;
  stageId: string | null;
  ownerType?: ConversationOwnerType;
  ownerId?: string | null;
  /** Conversation 标题。 */
  title: string;
  /** Conversation 类型。 */
  kind: ConversationKind;
  /** 默认响应 role。 */
  defaultRole: RoleName;
  /** 允许参与协作的 role 列表。 */
  participatingRoles: RoleName[];
  /** 初始 Conversation 摘要。 */
  summary?: string;
  /** 来源 Conversation ID 列表。 */
  fromConversationIds?: string[];
}
