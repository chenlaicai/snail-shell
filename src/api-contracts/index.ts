// barrel export — api-contracts 的唯一入口
export type { ApiEndpoints, ApiEndpointDef } from "./endpoints";

// 领域实体 + 聚合视图（直接从 shared 导入，无 DTO 中转）
export type {
  Workspace, WorkspaceSummary, WorkspaceDetail,
  Issue, IssueDetail,
  Stage, StageDetail, StageStatus,
  Conversation, ConversationDetail, ConversationKind, ConversationStatus, ConversationOwnerType,
  ConversationMessagesPage, ConversationRecentMessagesSnapshot, ConversationHistoryWindow, ConversationHistorySearchPage,
  ConversationDispatchState, BossMentionItem,
  MessageEvent, MessageEventSource, MessageContext,
  MessageDispatch, DispatchInboxGroup, DispatchInboxPreviewItem,
  RoleName, MessageRole, MessageStatus,
  Sop, SopTransition, SopSnapshot, TransitionGuard, StageChecklistItem,
  EvolutionItem, EvolutionItemWithConversation, EvolutionItemSearchResult,
  KnowledgeLibraryEntry, KnowledgeLibrarySearchResult, KnowledgeLibraryScope,
} from "../shared";

// Lobby 类型（定义在 lobby/types.ts）
export type { LobbySession, LobbyMessage } from "../lobby/types";

// API 扩展类型（有额外字段的组合类型，从 DTO 文件导入）
export type {
  MessageDto, ConversationEventWithMessage, SendMessageResult, ApproveToolResult, InterruptMessageResult,
} from "./dto/message.dto";
export type {
  CreateIssueResult, AdvanceIssueResult, IssueCleanupResult,
  RepoCleanupResult, RepoCleanupStep, StageSuggestion,
} from "./dto/issue.dto";
export type {
  CreateWorkspaceResult, DetectSnailResult, LoadSnailResult,
} from "./dto/workspace.dto";
export type {
  SopDetailDto, SopStageDefinitionWithRolesDto, SopStageDefinitionInputDto, DeleteSopResult,
} from "./dto/sop.dto";
export type {
  UpdateStageBody,
} from "./dto/stage.dto";
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
