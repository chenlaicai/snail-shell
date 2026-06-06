// barrel export — api-contracts 的唯一入口
export type { ApiEndpoints, ApiEndpointDef } from "./endpoints";

// DTO
export type {
  WorkspaceSummaryDto, WorkspaceDetailDto, CreateWorkspaceResult, DetectSnailResult, LoadSnailResult,
} from "./dto/workspace.dto";
export type {
  StageDto, StageDetailDto, UpdateStageBody, StageStatus,
} from "./dto/stage.dto";
export type {
  IssueDto, IssueDetailDto, CreateIssueResult, AdvanceIssueResult, IssueCleanupResult,
  RepoCleanupResult, RepoCleanupStep, StageSuggestion,
} from "./dto/issue.dto";
export type {
  ConversationDto, ConversationDetailDto, ConversationMessagesPage,
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
  SopDto, SopDetailDto, SopStageDefinitionWithRolesDto, SopStageDefinitionInputDto,
  SopTransitionDto, WorkspaceSopDto, DeleteSopResult,
} from "./dto/sop.dto";
export type {
  EvolutionItemDto, EvolutionItemWithConversationDto, EvolutionItemSearchResultDto,
} from "./dto/evolution.dto";
export type {
  KnowledgeEntryDto, KnowledgeSearchResultDto, KnowledgeLibraryScope,
} from "./dto/knowledge.dto";
export type {
  LobbySessionDto, LobbyMessageDto,
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
  MessageDtoSchema, StageDetailDtoSchema, IssueDetailDtoSchema, WorkspaceSummaryDtoSchema,
} from "./validators";
