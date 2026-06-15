import type * as Dto from "@api-contracts/dto";

export type EndpointDef<TParams = never, TQuery = never, TBody = never, TResponse = unknown> = {
  params: TParams;
  query: TQuery;
  body: TBody;
  response: TResponse;
};

export type ApiEndpoints = {
  "GET /api/workspaces": EndpointDef<never, { limit?: number; offset?: number }, never, Dto.WorkspaceSummaryDto[]>;
  "POST /api/workspaces": EndpointDef<never, never, { path: string; summary?: string }, Dto.WorkspaceSummaryDto>;
  "GET /api/workspaces/:workspaceId": EndpointDef<{ workspaceId: string }, never, never, Dto.WorkspaceDetailDto | null>;
  "GET /api/workspaces/:workspaceId/issues": EndpointDef<{ workspaceId: string }, never, never, Dto.IssueDetailDto[]>;
  "POST /api/workspaces/:workspaceId/issues": EndpointDef<{ workspaceId: string }, never, { title: string; summary?: string; adopted_sop_key: string; initial_message?: string; snail_assignments?: Record<string, string> }, Dto.CreateIssueResult>;
  "GET /api/issues/:issueId": EndpointDef<{ issueId: string }, never, never, Dto.IssueDetailDto | null>;
  "POST /api/issues/:issueId/launch": EndpointDef<{ issueId: string }, never, { stage_key?: string; initial_message?: string; snail_assignments: Record<string, string> }, Dto.StageDetailDto>;
  "GET /api/issues/:issueId/stages": EndpointDef<{ issueId: string }, never, never, Dto.StageDetailDto[]>;
  "GET /api/stages/:stageId": EndpointDef<{ stageId: string }, never, never, Dto.StageDetailDto | null>;
  "GET /api/stages/:stageId/messages": EndpointDef<{ stageId: string }, { limit?: number; offset?: number }, never, Dto.MessageDto[]>;
  "POST /api/stages/:stageId/messages": EndpointDef<{ stageId: string }, never, { text: string; from_speaker?: string }, { ok: true }>;
  "GET /api/stages/:stageId/transition-suggestions": EndpointDef<{ stageId: string }, never, never, Dto.StageSuggestion[]>;
  "POST /api/stages/:stageId/advance": EndpointDef<{ stageId: string }, never, { target_key: string; snail_assignments: Record<string, string> }, Dto.StageDetailDto>;
  "GET /api/sops": EndpointDef<never, { source?: string }, never, Dto.SopDto[]>;
  "GET /api/sops/:sopKey": EndpointDef<{ sopKey: string }, never, never, Dto.SopDetailDto | null>;
  "GET /api/meta/prompts": EndpointDef<never, never, never, Dto.PromptDto[]>;
  "GET /api/meta/skills": EndpointDef<never, never, never, Dto.SkillDto[]>;
  "GET /api/meta/mcps": EndpointDef<never, { workspace_root?: string }, never, Dto.McpServerDto[]>;
  "GET /api/snail-den": EndpointDef<never, never, never, Dto.SnailDenTemplateDto[]>;
  "GET /api/knowledge/items": EndpointDef<never, { scope?: string; workspace_id?: string; limit?: number; offset?: number }, never, Dto.KnowledgeSearchResultDto[]>;
  "GET /api/knowledge/items/search": EndpointDef<never, { q: string }, never, Dto.KnowledgeSearchResultDto[]>;
  "GET /api/knowledge/items/summary": EndpointDef<never, never, never, Record<string, number>>;
  "GET /api/evolution/items": EndpointDef<never, { workspace_id?: string; issue_id?: string; query?: string; limit?: number; offset?: number }, never, Dto.EvolutionItemDto[]>;
  "GET /api/evolution/items/:itemId": EndpointDef<{ itemId: string }, never, never, Dto.EvolutionItemDto | null>;
};
