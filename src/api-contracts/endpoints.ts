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
  "POST /api/workspaces/:workspaceId/issues": EndpointDef<{ workspaceId: string }, never, { title: string; summary?: string; adopted_sop_key: string; snail_assignment_plan: Dto.IssueSnailAssignmentPlanDto }, Dto.CreateIssueResult>;
  "GET /api/sops/:sopKey/stage-previews": EndpointDef<{ sopKey: string }, { title?: string }, never, Dto.StagePreviewDto[]>;
  "GET /api/issues/:issueId": EndpointDef<{ issueId: string }, never, never, Dto.IssueDetailDto | null>;
  "POST /api/issues/:issueId/close": EndpointDef<{ issueId: string }, never, never, Dto.CloseIssueResultDto>;
  "GET /api/issues/:issueId/stages": EndpointDef<{ issueId: string }, never, never, Dto.StageDetailDto[]>;
  "GET /api/stages/:stageId": EndpointDef<{ stageId: string }, never, never, Dto.StageDetailDto | null>;
  "GET /api/stages/:stageId/messages": EndpointDef<{ stageId: string }, { limit?: number; before_id?: number }, never, Dto.MessageDto[]>;
  "POST /api/stages/:stageId/messages": EndpointDef<{ stageId: string }, never, { text: string; from_speaker?: string }, { ok: true }>;
  "POST /api/stages/:stageId/messages/:messageId/interrupt": EndpointDef<{ stageId: string; messageId: string }, never, never, { interrupted: boolean }>;
  "GET /api/stages/:stageId/transition-suggestions": EndpointDef<{ stageId: string }, never, never, Dto.StageSuggestion[]>;
  "DELETE /api/stages/:stageId/transition-suggestions/:targetKey": EndpointDef<{ stageId: string; targetKey: string }, never, never, { ok: true }>;
  "POST /api/stages/:stageId/advance": EndpointDef<{ stageId: string }, never, { target_key: string }, Dto.StageDetailDto>;
  "GET /api/sops": EndpointDef<never, { source?: string }, never, Dto.SopDto[]>;
  "GET /api/sops/:sopKey": EndpointDef<{ sopKey: string }, never, never, Dto.SopDetailDto | null>;
  "POST /api/sops": EndpointDef<never, never, Omit<Dto.SopDto, 'scope'>, Dto.SopDto>;
  "PATCH /api/sops/:sopKey": EndpointDef<{ sopKey: string }, never, Partial<Omit<Dto.SopDto, 'key' | 'scope'>>, Dto.SopDto>;
  "DELETE /api/sops/:sopKey": EndpointDef<{ sopKey: string }, never, never, { ok: true }>;
  "GET /api/meta/prompts": EndpointDef<never, never, never, Dto.PromptDto[]>;
  "GET /api/meta/skills": EndpointDef<never, never, never, Dto.SkillDto[]>;
  "GET /api/meta/mcp-configs": EndpointDef<never, { workspace_root?: string }, never, Dto.McpConfigDto[]>;
  "GET /api/snail-den": EndpointDef<never, never, never, Dto.SnailDenTemplateDto[]>;
  "POST /api/snail-den": EndpointDef<never, never, Dto.SnailDenTemplateDto, Dto.SnailDenTemplateDto>;
  "PATCH /api/snail-den/:key": EndpointDef<{ key: string }, never, Partial<Omit<Dto.SnailDenTemplateDto, 'key'>>, Dto.SnailDenTemplateDto>;
  "DELETE /api/snail-den/:key": EndpointDef<{ key: string }, never, never, { ok: true }>;
  "GET /api/knowledge/items": EndpointDef<never, { scope?: string; workspace_id?: string; limit?: number; offset?: number }, never, Dto.KnowledgeSearchResultDto[]>;
  "GET /api/knowledge/items/search": EndpointDef<never, { q: string }, never, Dto.KnowledgeSearchResultDto[]>;
  "GET /api/knowledge/items/summary": EndpointDef<never, never, never, Record<string, number>>;
  "GET /api/evolution/items": EndpointDef<never, { workspace_id?: string; issue_id?: string; query?: string; limit?: number; offset?: number }, never, Dto.EvolutionItemDto[]>;
  "GET /api/evolution/items/:itemId": EndpointDef<{ itemId: string }, never, never, Dto.EvolutionItemDto | null>;
};
