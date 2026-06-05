// src/web/types.ts — 前端唯一的类型来源
// 所有组件从这里导入，不从 ../shared/ 或自行定义

// 实体枚举类型（不退化为 string）
export type {
  RoleName, MessageRole, MessageStatus, StageStatus,
  ConversationKind, ConversationStatus, WorkspaceModule,
  ConversationOwnerType, StageType,
} from "../shared/domain-types";

// API DTO（API 响应的精确形状）
export type {
  WorkspaceDto, WorkspaceSummaryDto, WorkspaceDetailDto, CreateWorkspaceResult, DetectSnailResult, LoadSnailResult,
  IssueDto, IssueDetailDto, CreateIssueResult, AdvanceIssueResult, IssueCleanupResult,
  RepoCleanupResult, RepoCleanupStep, StageSuggestion,
  StageDto, StageDetailDto, UpdateStageBody,
  ConversationDto, ConversationDetailDto, ConversationMessagesPage,
  ConversationRecentMessagesSnapshot, ConversationHistoryWindow, ConversationHistorySearchPage,
  MessageDto, MessageEvent, MessageEventSource, MessageContext,
  ConversationEventWithMessage, ConversationDispatchState, BossMentionItem,
  SendMessageResult, ApproveToolResult, InterruptMessageResult,
  MessageDispatch, DispatchInboxGroup, DispatchInboxPreviewItem,
  SopDto, SopDetailDto, SopStageDefinitionWithRolesDto, SopStageDefinitionInputDto,
  SopTransitionDto, WorkspaceSopDto, DeleteSopResult,
  EvolutionItemDto, EvolutionItemWithConversationDto, EvolutionItemSearchResultDto,
  KnowledgeEntryDto, KnowledgeSearchResultDto, KnowledgeLibraryScope,
  LobbySessionDto, LobbyMessageDto,
  PromptDto, SkillDto, SnailDenTemplateDto, McpServerDto, RoleDto,
} from "../api-contracts/dto";

// WebSocket 协议
export type {
  WsServerMessage, WsClientMessage,
  WsAgentEvent, WsError, WsConversationBadge, WsStageSuggestion,
} from "../api-contracts/ws-protocol";

// 前端 UI 专用类型（纯展示逻辑，不来自 API）
export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  text: string;
}
