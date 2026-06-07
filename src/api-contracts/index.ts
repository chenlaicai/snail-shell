// barrel export — api-contracts 的唯一入口
export type { ApiEndpoints, ApiEndpointDef } from "./endpoints";

// DTO — 显式导出，防止内部类型泄漏
export type {
  WorkspaceSummary, WorkspaceDetail, CreateWorkspaceResult, DetectSnailResult, LoadSnailResult,
} from "./dto/workspace.dto";
export type {
  StageDetail, UpdateStageBody, StageStatus,
} from "./dto/stage.dto";
export type {
  Issue, IssueDetail, CreateIssueResult, AdvanceIssueResult, IssueCleanupResult,
  RepoCleanupResult, RepoCleanupStep, StageSuggestion,
} from "./dto/issue.dto";
export type {
  Conversation, ConversationDetail, ConversationMessagesPage,
  ConversationRecentMessagesSnapshot, ConversationHistoryWindow, ConversationHistorySearchPage,
  ConversationKind, ConversationStatus, ConversationOwnerType,
} from "./dto/conversation.dto";
export type {
  MessageDto, MessageEvent, MessageEventSource, MessageContext,
  ConversationEventWithMessage, ConversationDispatchState, BossMentionItem,
  SendMessageResult, ApproveToolResult, InterruptMessageResult,
  MessageDispatch, DispatchInboxGroup, DispatchInboxPreviewItem,
  RoleName, MessageRole, MessageStatus,
} from "./dto/message.dto";
export type {
  Sop, SopDetailDto, SopStageDefinitionWithRolesDto, SopStageDefinitionInputDto,
  SopTransition, DeleteSopResult, SopSnapshot, TransitionGuard, StageChecklistItem,
} from "./dto/sop.dto";
export type {
  EvolutionItem, EvolutionItemWithConversation, EvolutionItemSearchResult,
} from "./dto/evolution.dto";
export type {
  KnowledgeLibraryEntry, KnowledgeLibrarySearchResult, KnowledgeLibraryScope,
} from "./dto/knowledge.dto";
export type {
  LobbySession, LobbyMessage,
} from "./dto/lobby.dto";
export type {
  PromptDto, SkillDto, SnailDenTemplateDto, McpServerDto, RoleDto,
} from "./dto/meta.dto";

// WebSocket protocol
export type {
  WsSendMessage, WsClientMessage, WsServerMessage,
  WsAgentEvent, WsError, WsConversationBadge, WsStageSuggestion,
} from "./ws-protocol";

// Validators (runtime values + zod schemas)
export {
  CONVERSATION_KINDS, ConversationKindSchema,
  STAGE_STATUSES, StageStatusSchema,
  MESSAGE_ROLES, MessageRoleSchema,
  MessageSchema, StageDetailSchema, IssueDetailSchema, WorkspaceSummarySchema,
} from "./validators";
