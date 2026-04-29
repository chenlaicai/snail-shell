import type { SnailName, StageType, ArtifactType } from "../meta/generated-types";

export type { SnailName, StageType, ArtifactType };

export type ProjectKind = "system_self" | "product_delivery";
export type ProjectStatus = "active" | "paused" | "completed" | "cancelled" | "archived";
export type FeatureStatus = "active" | "in_review" | "waiting_merge" | "completed" | "cancelled" | "archived";
export type StageStatus = "in_progress" | "completed" | "cancelled";
export type ConversationKind = "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";
export type ConversationStatus = "active" | "paused" | "completed" | "archived";
export type MessageRole = "user" | "assistant" | "system";
export type MessageRuntime = "claude" | "opencode" | "codex" | "system" | "unknown";
export type MessageStatus = "streaming" | "completed" | "failed" | "interrupted" | "cancelled";
export type MessageEventCategory = "content" | "signal";
export type MessageEventKind = "start" | "text" | "content_block" | "tool_call" | "tool_result" | "command" | "command_result" | "signal" | "error";
export type MessageSignalType = "step_start" | "step_finish" | "turn_started" | "turn_completed" | "message_completed" | "message_failed" | "message_interrupted" | "message_cancelled";
export type MessageDispatchStatus = "pending" | "seen" | "consumed" | "skipped";
export type ArtifactStatus = "draft" | "active" | "approved" | "superseded" | "archived";
export type ArtifactStorageType = "markdown_file" | "inline_text" | "json_record" | "external_ref";

export interface Project {
  id: string;
  kind: ProjectKind;
  name: string;
  summary: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Feature {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  status: FeatureStatus;
  branch_name: string | null;
  worktree_path: string | null;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Stage {
  id: string;
  project_id: string;
  feature_id: string;
  type: StageType;
  sequence: number;
  status: StageStatus;
  formal_artifacts: string[];
  created_at: string;
  updated_at: string;
  entered_at: string | null;
  left_at: string | null;
}

export interface RuntimeSessionBinding {
  sessionId: string;
}

export interface Conversation {
  id: string;
  project_id: string;
  feature_id: string;
  stage_id: string;
  title: string;
  kind: ConversationKind;
  status: ConversationStatus;
  default_snail: SnailName;
  participating_snails: SnailName[];
  summary: string | null;
  from_conversation_ids: string[];
  runtime_sessions: Partial<Record<SnailName, RuntimeSessionBinding>>;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: string;
  client_id: string | null;
  from_snail: SnailName | null;
  to_snails: SnailName[];
  role: MessageRole;
  quoted_message_id: number | null;
  context_cutoff_at: string;
  runtime: MessageRuntime | null;
  status: MessageStatus;
  created_at: string;
  updated_at: string;
}

export interface MessageEventSource {
  runtime_name: MessageRuntime | null;
  runtime_event_type: string | null;
  runtime_message_id: string | null;
  runtime_item_id: string | null;
  runtime_call_id: string | null;
  raw_event: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface StartEventPayload {
  role: MessageRole;
  snail_name: SnailName | string | null;
  runtime: MessageRuntime | null;
}

export interface TextEventPayload {
  text: string;
  mentions: SnailName[];
}

export interface MessageTextBlock {
  type: "text";
  text: string;
  mentions: SnailName[];
}

export interface MessageRichTextBlock {
  type: "rich_text";
  text: string;
}

export interface MessageMarkdownBlock {
  type: "markdown";
  text: string;
  mentions: SnailName[];
}

export interface MessageImageBlock {
  type: "image";
  url: string;
  alt: string | null;
}

export interface MessageIconBlock {
  type: "icon";
  name: string;
  label: string | null;
}

export interface MessageChartBlock {
  type: "chart";
  chart_type: "bar" | "line" | "pie" | "table";
  title: string | null;
  data: Record<string, unknown>;
}

export interface MessageTableBlock {
  type: "table";
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  title: string | null;
}

export interface MessageToolCallCardBlock {
  type: "tool_call_card";
  tool_name: string;
  status: "pending" | "running" | "success" | "error" | null;
  summary: string | null;
  detail: string | null;
}

export interface MessageArtifactCardBlock {
  type: "artifact_card";
  artifact_id: string | null;
  artifact_type: ArtifactType | string | null;
  title: string;
  summary: string | null;
  status: string | null;
}

export interface MessageReferenceCardBlock {
  type: "reference_card";
  ref_type: "message" | "artifact" | "conversation" | "stage" | "project" | "external";
  ref_id: string | null;
  title: string;
  summary: string | null;
  href: string | null;
}

export interface QuestionOptionPayload {
  key: string;
  label: string;
  description: string | null;
  allow_text_input: boolean;
  text_input_label: string | null;
  text_input_placeholder: string | null;
}

export interface QuestionResponseSelectedOptionPayload {
  key: string;
  label: string;
  extra_text: string | null;
}

export interface MessageQuestionBlock {
  type: "question";
  title: string;
  question: string;
  reason: string | null;
  selection_mode: "single" | "multiple";
  options: QuestionOptionPayload[];
}

export interface MessageQuestionResponseBlock {
  type: "question_response";
  response_to: { title: string };
  selection_mode: "single" | "multiple";
  selected_options: QuestionResponseSelectedOptionPayload[];
  summary: string;
}

export type MessageContentBlock =
  | MessageTextBlock
  | MessageRichTextBlock
  | MessageMarkdownBlock
  | MessageQuestionBlock
  | MessageQuestionResponseBlock
  | MessageImageBlock
  | MessageIconBlock
  | MessageChartBlock
  | MessageTableBlock
  | MessageToolCallCardBlock
  | MessageArtifactCardBlock
  | MessageReferenceCardBlock;

export interface ContentBlockEventPayload {
  blocks: MessageContentBlock[];
  fallback_text: string | null;
}

export interface ToolCallEventPayload {
  tool_name: string;
  call_id: string;
  input: Record<string, unknown> | null;
  title: string | null;
}

export interface ToolResultEventPayload {
  tool_name: string;
  call_id: string;
  is_error: boolean;
  output_text: string | null;
  error_text: string | null;
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

interface MessageEventBase<TKind extends MessageEventKind, TPayload extends MessageEventPayload> {
  id: number;
  message_id: number;
  seq: number;
  category: MessageEventCategory;
  kind: TKind;
  payload: TPayload;
  source: MessageEventSource;
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

export interface PersistedMessageEventRow {
  id: number;
  message_id: number;
  seq: number;
  category: MessageEventCategory;
  kind: MessageEventKind;
  payload: string;
  source: string;
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

export interface MessageWithEvents extends Message {
  events: MessageEvent[];
}

export interface MessageDispatch {
  id: number;
  conversation_id: string;
  message_id: number;
  to_snail: SnailName;
  status: MessageDispatchStatus;
  consumed_by_message_id: number | null;
  created_at: string;
  consumed_at: string | null;
}

export interface DispatchInboxGroup {
  to_snail: SnailName;
  status: MessageDispatchStatus;
  dispatch_ids: number[];
  message_ids: number[];
  latest_dispatch_at: string;
}

export interface DispatchInboxPreviewItem {
  message_id: number;
  from_snail: SnailName | null;
  role: MessageRole;
  preview: string;
  created_at: string;
}

export interface ConversationHistorySearchResult {
  message_id: number;
  role: MessageRole;
  from_snail: SnailName | null;
  created_at: string;
  snippet: string;
}

export interface CreateMessageInput {
  conversationId: string;
  clientId?: string | null;
  fromSnail: SnailName | null;
  toSnails: SnailName[];
  role: MessageRole;
  quotedMessageId?: number | null;
  contextCutoffAt?: string;
  runtime?: MessageRuntime | null;
  status?: MessageStatus;
}

export interface CreateMessageDispatchInput {
  conversationId: string;
  messageId: number;
  toSnail: SnailName;
}

export interface Artifact {
  id: string;
  project_id: string;
  feature_id: string;
  stage_id: string;
  conversation_id: string;
  artifact_type: ArtifactType;
  title: string;
  status: ArtifactStatus;
  storage_type: ArtifactStorageType;
  file_path: string | null;
  inline_content: string | null;
  external_ref: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateStageInput {
  id: string;
  projectId: string;
  featureId: string;
  type: StageType;
  sequence: number;
  status: StageStatus;
  formalArtifacts?: string[];
  enteredAt?: string | null;
}

export interface CreateConversationInput {
  id: string;
  projectId: string;
  featureId: string;
  stageId: string;
  title: string;
  kind: ConversationKind;
  defaultSnail: SnailName;
  participatingSnails: SnailName[];
  summary?: string;
  fromConversationIds?: string[];
}

export interface ArtifactContentOptions {
  filePath?: string;
  inlineContent?: string;
  externalRef?: string;
  metadata?: string;
}

export interface CreateArtifactInput {
  id: string;
  projectId: string;
  featureId: string;
  stageId: string;
  conversationId: string;
  artifactType: ArtifactType;
  title: string;
  status: ArtifactStatus;
  storageType: ArtifactStorageType;
  options?: ArtifactContentOptions;
}
