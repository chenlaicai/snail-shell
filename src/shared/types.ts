// Re-export all shared types from sub-modules.

export type AgentRuntime = "claude-code-cli" | "claude-code-stateful-cli" | "opencode-cli" | "codex-cli";

export interface MessageContextSummaryInput {
  context: string;
  targetChars: number;
}

export interface MessageContextSummaryGenerator {
  generateMessageContextSummary(input: MessageContextSummaryInput): Promise<string>;
}

export type { RoleName, StageType } from "./domain-types";
export type {
  MessageTextBlock,
  MessageRichTextBlock,
  MessageMarkdownBlock,
  MessageImageBlock,
  MessageIconBlock,
  MessageChartBlock,
  MessageTableBlock,
  MessageToolCallCardBlock,
  MessageArtifactCardBlock,
  MessageReferenceCardBlock,
  QuestionOptionPayload,
  QuestionResponseSelectedOptionPayload,
  MessageQuestionBlock,
  MessageQuestionResponseBlock,
  MessageContentBlock,
} from "./message-types";
export type {
  EvolutionItem,
  EvolutionItemWithConversation,
  CreateEvolutionItemInput,
  UpdateEvolutionItemInput,
  EvolutionItemListFilters,
  EvolutionItemSearchResult,
} from "./evolution-types";
export type {
  KnowledgeLibraryScope,
  KnowledgeLibraryEntry,
  KnowledgeLibrarySearchResult,
  CreateKnowledgeLibraryInput,
  UpdateKnowledgeLibraryInput,
  KnowledgeLibraryListFilters,
} from "./knowledge-library-types";
export type {
  WorkspaceStatus,
  StageStatus,
  ConversationKind,
  ConversationOwnerType,
  ConversationStatus,
  MessageRole,
  MessageRuntime,
  MessageStatus,
  MessageEventCategory,
  MessageEventKind,
  MessageSignalType,
  MessageContextKind,
  MessageDispatchStatus,
  Workspace,
  WorkspaceStageDefinition,
  StageRoleDefinition,
  Sop,
  SopStageDefinition,
  WorkspaceSop,
  Issue,
  Stage,
  Conversation,
  StageChecklistItem,
  StageGateArtifact,
  StageGateEvidence,
  RuntimeBinding,
  InvocationSubject,
  Message,
  MessageContext,
  MessageEventSource,
  StartEventPayload,
  TextEventPayload,
  ContentBlockEventPayload,
  ToolCallEventPayload,
  ToolResultEventPayload,
  CommandEventPayload,
  CommandResultEventPayload,
  SignalEventPayload,
  ErrorEventPayload,
  MessageEventPayload,
  StartMessageEvent,
  TextMessageEvent,
  ContentBlockMessageEvent,
  ToolCallMessageEvent,
  ToolResultMessageEvent,
  CommandMessageEvent,
  CommandResultMessageEvent,
  SignalMessageEvent,
  ErrorMessageEvent,
  MessageEvent,
  PersistedMessageEventRow,
  CreateMessageEventInput,
  MessageWithEvents,
  MessageDispatch,
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  ConversationHistorySearchResult,
  CreateMessageInput,
  CreateMessageDispatchInput,
  CreateStageInput,
  CreateConversationInput,
} from "./domain-types";
