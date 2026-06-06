// src/web/types.ts — 前端唯一的类型来源
// 所有组件从这里导入，不从 ../shared/ 或自行定义

// 实体枚举类型（不退化为 string）
export type {
  RoleName, MessageRole, MessageStatus, StageStatus,
  ConversationKind, ConversationStatus,
  ConversationOwnerType, StageType,
  StageRoleDefinition,
} from "../shared/domain-types";
/** @deprecated Use StageRoleDefinition. Kept for backward compatibility. */
export type RoleDefinition = StageRoleDefinition;

// API DTO（API 响应的精确形状）
export type {
  WorkspaceSummaryDto, WorkspaceDetailDto, CreateWorkspaceResult, DetectSnailResult, LoadSnailResult,
  IssueDto, IssueDetailDto, CreateIssueResult, AdvanceIssueResult, IssueCleanupResult,
  RepoCleanupResult, RepoCleanupStep, StageSuggestion,
  StageDetailDto, UpdateStageBody,
  ConversationDetailDto,
  ConversationMessagesPage,
  ConversationRecentMessagesSnapshot, ConversationHistoryWindow, ConversationHistorySearchPage,
  MessageDto, MessageEvent, MessageEventSource, MessageContext,
  ConversationEventWithMessage, ConversationDispatchState, BossMentionItem,
  SendMessageResult, ApproveToolResult, InterruptMessageResult,
  MessageDispatch, DispatchInboxGroup, DispatchInboxPreviewItem,
  Sop, SopDetailDto, SopStageDefinitionWithRolesDto, SopStageDefinitionInputDto,
  SopTransition, DeleteSopResult,
  EvolutionItem, EvolutionItemWithConversation, EvolutionItemSearchResult,
  KnowledgeLibraryEntry, KnowledgeLibrarySearchResult, KnowledgeLibraryScope,
  LobbySession, LobbyMessage,
  PromptDto, SkillDto, SnailDenTemplateDto, McpServerDto, RoleDto,
} from "../api-contracts/dto";

// WebSocket 协议
export type {
  WsServerMessage, WsClientMessage,
  WsAgentEvent, WsError, WsConversationBadge, WsStageSuggestion,
} from "../api-contracts/ws-protocol";

// 前端 UI 专用类型（纯展示逻辑，不来自 API）
export interface ToastMessage {
  id: number;
  message: string;
  isError: boolean;
}

/** @mention 角色建议项，从 participating_roles 名称列表构造。 */
export interface Role {
  name: string;
  description?: string;
}

/** 运行时用量展示信息，从消息事件计算得出。 */
export interface RuntimeUsage {
  label: string;
  percentLabel: string;
  title: string;
  isPlaceholder: boolean;
}

/** ContextPanel 参与者展示项。 */
export interface Participant {
  name: string;
  roleDef?: { name: string; description?: string; snail_template_id?: string } | null;
  isPrimary: boolean;
}

/** ConversationSource 展示项。 */
export interface ConversationSource {
  id: string;
  title: string;
}
