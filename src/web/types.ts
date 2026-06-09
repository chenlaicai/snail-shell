export type {
  WorkspaceSummaryDto, WorkspaceDetailDto, CreateWorkspaceResult,
} from "../api-contracts/dto/workspace.dto";
export type {
  StageDto, StageDetailDto, UpdateStageBody, StageStatus,
} from "../api-contracts/dto/stage.dto";
export type {
  IssueDto, IssueDetailDto, CreateIssueResult, AdvanceIssueResult, IssueCleanupResult, StageSuggestion,
} from "../api-contracts/dto/issue.dto";
export type {
  ConversationDto, ConversationDetailDto, ConversationMessagesPage,
  ConversationRecentMessagesSnapshot, ConversationHistoryWindow,
  ConversationKind, ConversationStatus, ConversationOwnerType,
} from "../api-contracts/dto/conversation.dto";
export type {
  MessageDto, MessageEvent, MessageEventSource, MessageContext,
  ConversationEventWithMessage, ConversationDispatchState, BossMentionItem,
  SendMessageResult, ApproveToolResult, InterruptMessageResult,
  RoleName, MessageRole, MessageStatus,
} from "../api-contracts/dto/message.dto";
export type {
  SopDto, SopDetailDto, SopStageDefinitionWithRolesDto, SopStageDefinitionInputDto,
  SopTransitionDto, DeleteSopResult,
} from "../api-contracts/dto/sop.dto";
export type {
  EvolutionItemDto, EvolutionItemWithConversationDto, EvolutionItemSearchResultDto,
} from "../api-contracts/dto/evolution.dto";
export type {
  KnowledgeEntryDto, KnowledgeSearchResultDto,
} from "../api-contracts/dto/knowledge.dto";
export type {
  LobbySessionDto, LobbyMessageDto,
} from "../api-contracts/dto/lobby.dto";
export type {
  PromptDto, SkillDto, SnailDenTemplateDto, McpServerDto, RoleDto,
} from "../api-contracts/dto/meta.dto";
export type {
  WsSendMessage, WsClientMessage, WsServerMessage,
  WsAgentEvent, WsError, WsConversationBadge, WsStageSuggestion,
} from "../api-contracts/ws-protocol";
export type { MessageWithEvents } from "../shared";

// Agent types needed for tool approval
export interface ToolPermissionRequest {
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}
