// endpoints.ts — 编译期完整描述每个 endpoint 的输入输出
// DTO 字段从 handler 的 res.json() 逆向提取，不允许凭空设计
import type * as Dto from "./dto";
import type { MessageWithEvents } from "../shared";

// 每个 endpoint 的契约类型
export interface ApiEndpointDef<
  TParams = never,
  TQuery = never,
  TBody = never,
  TResponse = undefined
> {
  params: TParams;
  query: TQuery;
  body: TBody;
  response: TResponse;
}

// 所有 endpoint 的契约映射
export type ApiEndpoints = {
  // ── Workspace ──
  "GET /api/workspaces": ApiEndpointDef<
    never,
    { limit?: number; offset?: number },
    never,
    Dto.WorkspaceSummaryDto[]
  >;
  "POST /api/workspaces": ApiEndpointDef<
    never,
    never,
    { name: string; summary?: string; workspace_root?: string; sop_id: string; role_bindings?: Record<string, string | string[]>; load_from_snail?: boolean },
    Dto.CreateWorkspaceResult
  >;
  "GET /api/workspaces/:workspaceId": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.WorkspaceDetailDto | null
  >;
  "GET /api/workspaces/:workspaceId/stages": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.StageDetailDto[]
  >;
  "GET /api/workspaces/:workspaceId/issues": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.IssueDetailDto[]
  >;
  "GET /api/workspaces/:workspaceId/conversations": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.ConversationDetailDto[]
  >;

  // ── Snail Config ──
  "POST /api/workspaces/detect-snail": ApiEndpointDef<
    never,
    never,
    { workspace_root: string },
    Dto.DetectSnailResult
  >;
  "POST /api/workspaces/:workspaceId/load-snail": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.LoadSnailResult
  >;

  // ── SOP ──
  "GET /api/sops": ApiEndpointDef<
    never,
    { source?: "platform" | "workspace" },
    never,
    Dto.SopDto[]
  >;
  "GET /api/sops/:sopId": ApiEndpointDef<
    { sopId: string },
    never,
    never,
    Dto.SopDetailDto
  >;
  "POST /api/sops": ApiEndpointDef<
    never,
    never,
    { key: string; name: string; description?: string; first_stage?: string; shared_handbook?: string; stage_definitions: Dto.SopStageDefinitionInputDto[]; transitions?: Dto.SopTransitionDto[] },
    Dto.SopDto
  >;
  "PATCH /api/sops/:sopId": ApiEndpointDef<
    { sopId: string },
    never,
    { name?: string; description?: string; first_stage?: string; shared_handbook?: string; stage_definitions?: Dto.SopStageDefinitionInputDto[]; transitions?: Dto.SopTransitionDto[] },
    Dto.SopDto
  >;
  "DELETE /api/sops/:sopId": ApiEndpointDef<
    { sopId: string },
    never,
    never,
    Dto.DeleteSopResult
  >;

  // ── Issue ──
  "POST /api/workspaces/:workspaceId/issues": ApiEndpointDef<
    { workspaceId: string },
    never,
    { title: string; summary?: string; adopted_sop_id?: string },
    Dto.CreateIssueResult
  >;
  "GET /api/issues/:issueId": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.IssueDetailDto
  >;
  "GET /api/issues/:issueId/stages": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.StageDetailDto[]
  >;
  "GET /api/issues/:issueId/conversations": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.ConversationDetailDto[]
  >;
  "POST /api/issues/:issueId/advance": ApiEndpointDef<
    { issueId: string },
    never,
    { target_stage_key?: string },
    Dto.AdvanceIssueResult
  >;
  "POST /api/issues/:issueId/bounce-stage": ApiEndpointDef<
    { issueId: string },
    never,
    { target_stage_key: string },
    Dto.AdvanceIssueResult
  >;
  "PATCH /api/issues/:issueId/task-anchor": ApiEndpointDef<
    { issueId: string },
    never,
    { task_anchor: string },
    Dto.IssueDto
  >;
  "PATCH /api/issues/:issueId/role-snail": ApiEndpointDef<
    { issueId: string },
    never,
    { stage_id: string; role_name: string; snail_template_id: string },
    Dto.IssueDto
  >;
  "POST /api/issues/:issueId/complete": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.IssueCleanupResult
  >;
  "POST /api/issues/:issueId/archive": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.IssueCleanupResult
  >;
  "GET /api/issues/:issueId/stage-suggestion": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.StageSuggestion | null
  >;
  "POST /api/issues/:issueId/confirm-stage-suggestion": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.AdvanceIssueResult
  >;
  "POST /api/issues/:issueId/reject-stage-suggestion": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    { ok: true }
  >;

  // ── Stage ──
  "GET /api/stages/:stageId": ApiEndpointDef<
    { stageId: string },
    never,
    never,
    Dto.StageDetailDto
  >;
  "PATCH /api/stages/:stageId": ApiEndpointDef<
    { stageId: string },
    never,
    Dto.UpdateStageBody,
    Dto.StageDetailDto
  >;
  "GET /api/stages/:stageId/conversations": ApiEndpointDef<
    { stageId: string },
    never,
    never,
    Dto.ConversationDetailDto[]
  >;

  // ── Conversation ──
  "POST /api/issues/:issueId/stages/:stageId/conversations": ApiEndpointDef<
    { issueId: string; stageId: string },
    never,
    { workspace_id: string; title: string; kind: Dto.ConversationKind; from_conversation_ids?: string[]; summary?: string },
    Dto.ConversationDto
  >;
  "GET /api/conversations/:conversationId": ApiEndpointDef<
    { conversationId: string },
    never,
    never,
    Dto.ConversationDetailDto
  >;

  // ── Message ──
  "GET /api/conversations/:conversationId/messages": ApiEndpointDef<
    { conversationId: string },
    { limit?: number; offset?: number },
    never,
    MessageWithEvents[]
  >;
  "GET /api/conversations/:conversationId/messages/page": ApiEndpointDef<
    { conversationId: string },
    { limit?: number; offset?: number; before?: string },
    never,
    Dto.ConversationMessagesPage
  >;
  "GET /api/conversations/:conversationId/messages/recent": ApiEndpointDef<
    { conversationId: string },
    { limit?: number },
    never,
    Dto.ConversationRecentMessagesSnapshot
  >;
  "GET /api/conversations/:conversationId/events": ApiEndpointDef<
    { conversationId: string },
    { after_event_id?: number },
    never,
    { items: Dto.ConversationEventWithMessage[] }
  >;
  "POST /api/conversations/:conversationId/messages/by-ids": ApiEndpointDef<
    { conversationId: string },
    never,
    { message_ids: number[] },
    MessageWithEvents[]
  >;
  "GET /api/conversations/:conversationId/messages/window": ApiEndpointDef<
    { conversationId: string },
    { anchor_message_id: number; before?: number; after?: number },
    never,
    Dto.ConversationHistoryWindow
  >;
  "GET /api/conversations/:conversationId/dispatch-state": ApiEndpointDef<
    { conversationId: string },
    never,
    never,
    Dto.ConversationDispatchState
  >;
  "GET /api/conversations/:conversationId/boss-mentions": ApiEndpointDef<
    { conversationId: string },
    never,
    never,
    Dto.BossMentionItem[]
  >;
  "POST /api/conversations/:conversationId/boss-mentions/ack": ApiEndpointDef<
    { conversationId: string },
    never,
    never,
    Dto.BossMentionItem[]
  >;
  "GET /api/conversations/:conversationId/history/search": ApiEndpointDef<
    { conversationId: string },
    { query: string; limit?: number; offset?: number },
    never,
    Dto.ConversationHistorySearchPage
  >;
  "POST /api/conversations/:conversationId/messages": ApiEndpointDef<
    { conversationId: string },
    never,
    { content?: string; events?: Array<{ kind: "text" | "content_block"; payload: unknown }>; from_role?: string; producer_role?: string; quoted_message_id?: number; asker_role?: string; client_id?: string },
    Dto.SendMessageResult
  >;
  "POST /api/conversations/:conversationId/messages/:messageId/interrupt": ApiEndpointDef<
    { conversationId: string; messageId: number },
    never,
    never,
    Dto.InterruptMessageResult
  >;
  "POST /api/conversations/:conversationId/messages/:messageId/approve-tool": ApiEndpointDef<
    { conversationId: string; messageId: number },
    never,
    { approved: boolean },
    Dto.ApproveToolResult
  >;

  // ── Evolution ──
  "GET /api/evolution/items": ApiEndpointDef<
    never,
    { workspace_id?: string; issue_id?: string; query?: string; limit?: number; offset?: number },
    never,
    Dto.EvolutionItemSearchResultDto[]
  >;
  "GET /api/workspaces/:workspaceId/evolution/items": ApiEndpointDef<
    { workspaceId: string },
    { issue_id?: string; query?: string; limit?: number; offset?: number },
    never,
    Dto.EvolutionItemSearchResultDto[]
  >;
  "GET /api/evolution/items/:itemId": ApiEndpointDef<
    { itemId: string },
    never,
    never,
    Dto.EvolutionItemWithConversationDto | null
  >;
  "POST /api/evolution/items": ApiEndpointDef<
    never,
    never,
    { title: string; content: string; workspace_id: string; tags?: string[]; metadata?: string },
    Dto.EvolutionItemWithConversationDto
  >;
  "PATCH /api/evolution/items/:itemId": ApiEndpointDef<
    { itemId: string },
    never,
    { issue_id?: string; title?: string; content?: string; tags?: string[]; metadata?: string },
    Dto.EvolutionItemWithConversationDto
  >;

  // ── Knowledge Library ──
  "GET /api/knowledge/items/summary": ApiEndpointDef<never, never, never, Record<string, number>>;
  "GET /api/knowledge/items": ApiEndpointDef<
    never,
    { scope?: "global" | "workspace"; workspace_id?: string; limit?: number; offset?: number },
    never,
    Dto.KnowledgeSearchResultDto[]
  >;
  "GET /api/knowledge/items/search": ApiEndpointDef<
    never,
    { q: string },
    never,
    Dto.KnowledgeSearchResultDto[]
  >;
  "GET /api/knowledge/items/:id": ApiEndpointDef<
    { id: string },
    never,
    never,
    Dto.KnowledgeEntryDto
  >;

  // ── Lobby ──
  "GET /api/lobby/sessions": ApiEndpointDef<never, never, never, Dto.LobbySessionDto[]>;
  "GET /api/lobby/sessions/:sessionId": ApiEndpointDef<
    { sessionId: string },
    never,
    never,
    { session: Dto.LobbySessionDto; messages: Dto.LobbyMessageDto[] }
  >;
  "GET /api/lobby/sessions/:sessionId/messages": ApiEndpointDef<
    { sessionId: string },
    { limit?: number; offset?: number },
    never,
    Dto.LobbyMessageDto[]
  >;
  "POST /api/lobby/sessions/:sessionId/reset": ApiEndpointDef<
    { sessionId: string },
    never,
    never,
    Dto.LobbySessionDto
  >;
  "DELETE /api/lobby/sessions/:sessionId": ApiEndpointDef<
    { sessionId: string },
    never,
    never,
    undefined
  >;

  // ── Meta ──
  "GET /api/meta/prompts": ApiEndpointDef<never, never, never, Dto.PromptDto[]>;
  "GET /api/meta/skills": ApiEndpointDef<never, never, never, Dto.SkillDto[]>;
  "GET /api/snail-den": ApiEndpointDef<never, never, never, Dto.SnailDenTemplateDto[]>;
  "GET /api/meta/mcps": ApiEndpointDef<never, { workspace_root?: string }, never, Dto.McpServerDto[]>;

  // ── Role ──
  "GET /api/roles": ApiEndpointDef<never, never, never, Dto.RoleDto[]>;
};
