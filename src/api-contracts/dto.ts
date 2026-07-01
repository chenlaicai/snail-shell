export type WorkspaceDto = {
  id: string;
  path: string;
  summary: string | null;
};

export type WorkspaceSummaryDto = WorkspaceDto;
export type WorkspaceDetailDto = WorkspaceDto & { issues: IssueDetailDto[] };

export type StageTransition = { to: string; guard: string | null };
export type RoleSnailAssignment = {
  stage_id: string;
  role_instance: string;
  seq: number;
  snail_key: string;
  snail_instance_id: string | null;
  role_key: string;
  description: string;
  created_at: string;
};

export type StageStatus = "in_progress" | "completed";
export type ActivityStatus = "ai_running" | "needs_human" | "completed";
export type StageDto = {
  id: string;
  workspace_path: string;
  issue_id: string;
  key: string;
  type: string;
  title: string;
  description: string;
  default_role_instance: string;
  role_instances: string[];
  active_roles: string[];
  from_stage_id: string | null;
  available_transitions: StageTransition[];
  output_artifacts: Record<string, string>;
  entered_at: string;
  left_at: string | null;
  status: StageStatus;
  assignments: RoleSnailAssignment[];
  created_at: string;
  stage_definition?: { title: string; roles: RoleDefinitionDto[] };
};
export type StageDetailDto = StageDto;

export type RoleDefinitionDto = { key?: string; name: string; description?: string; snail_template_id?: string; is_primary?: boolean; count?: number; skill?: string | null; prohibition?: string | null; self_check?: string | null };
export type StagePreviewDto = {
  key: string;
  title: string;
  description: string;
  available_transitions: StageTransition[];
  role_instances: Array<{ role_key: string; role_instance: string; description: string }>;
};
export type IssueSnailAssignmentPlanDto = Record<string, Record<string, string>>;
export type SopDto = {
  key: string;
  name: string;
  description: string | null;
  shared_skill: string | null;
  stage_definitions: Array<{ key: string; title: string; description: string; roles: RoleDefinitionDto[] }>;
  transitions: Array<{ from: string; to: string; guard: string | null }>;
  scope: string;
};
export type SopDetailDto = SopDto;

export type ResourceStatus = "success" | "failed" | "skipped";
export type ResourceResultDto = { status: ResourceStatus; error?: string };
export type CleanupResultDto = {
  pr: ResourceResultDto;
  worktree: ResourceResultDto;
  localBranch: ResourceResultDto;
  remoteBranch: ResourceResultDto;
};

export type IssueDto = {
  id: string;
  workspace_id: string;
  workspace_path: string;
  title: string;
  summary: string | null;
  sop_snapshot: SopDto;
  snail_assignment_plan: IssueSnailAssignmentPlanDto;
  context: Record<string, string>;
  created_at: string;
  closed_at: string | null;
  close_summary: CleanupResultDto | null;
};
export type IssueDetailDto = IssueDto & { stages: StageDetailDto[]; current_stage: StageDetailDto; activity_status: ActivityStatus };
export type CreateIssueResult = { issue: IssueDetailDto; stage: StageDetailDto };
export type StageSuggestion = {
  stage_id: string;
  message_id: number;
  from_speaker: string;
  target_key: string;
  toStageKey?: string;
  reason: string;
  guard: string | null;
  artifacts: Record<string, string>;
  created_at: string;
  signal_type?: "gate_complete" | "adversarial_consensus" | "disagreement";
  gate_evidence?: Record<string, unknown>;
  adversarial_artifact?: Record<string, unknown>;
  /** 建议被忽略的次数（用于 B5：重复建议提示） */
  dismiss_count?: number;
};

export type IssueRealtimeMessage = {
  type: "issue_event";
  issue_id: string;
  activity_status: ActivityStatus;
  event:
    | { type: "message_started"; stage_id: string; message_id: number; role: MessageRole; role_name: string | null; client_id: string | null; status: MessageStatus }
    | { type: "message_event_appended"; stage_id: string; message_id: number; event: MessageEvent }
    | { type: "message_status_changed"; stage_id: string; message_id: number; status: MessageStatus; context: MessageContext | null; ended_at?: string | null }
    | { type: "user_called"; stage_id: string; message_id: number; role: MessageRole; role_name: string | null; client_id: string | null; status: MessageStatus; content?: string }
    | { type: "stage_transition_suggested"; stage_id: string; suggestion: StageSuggestion };
};

export type WsHeartbeatMessage = { type: "heartbeat"; issue_id: string; ts: number };
export type WsServerMessage = IssueRealtimeMessage | WsHeartbeatMessage;

export type WorkspaceWsMessage =
  | { type: "activity_status_changed"; issue_id: string; activity_status: ActivityStatus; previous_status: ActivityStatus }
  | { type: "heartbeat"; ts: number };

/** frontend-only: "sending" 是纯前端状态，后端永远不会产生 */
type MessageStatus = "sending" | "streaming" | "completed" | "failed" | "interrupted" | "cancelled";
type MessageRole = "user" | "assistant" | "system";

export type MessageEvent = { id: number; message_id: number; seq: number; payload: Record<string, unknown> & { type: string }; created_at: string };
export type MessageContext = { message_id: number; kind: string; context: string; created_at: string };
export type MessageDto = {
  id: number;
  stage_id: string;
  conversation_id: string;
  from_speaker: string | null;
  from_role: string | null;
  to_speakers: string[];
  to_roles: string[];
  role: MessageRole;
  status: MessageStatus;
  created_at: string;
  ended_at: string | null;
  updated_at: string;
  content?: string;
  context: MessageContext | null;
  events: MessageEvent[];
  /** EventBatcher 在收到新事件时设置，用于 stuck-streaming 检测 */
  _lastEventAt?: number;
};

export type ConversationDto = {
  id: string;
  stage_id: string;
  issue_id: string;
  title: string;
  kind: "stage" | "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";
  status: "active" | "completed";
  default_role: string;
  participating_roles: string[];
  summary: string | null;
  created_at: string;
  updated_at: string;
};

export type CloseIssueResultDto = { issue: IssueDetailDto; cleanup: CleanupResultDto };

export type EvolutionItemDto = { id: string; workspace_id: string; status: string; issue_id: string | null; title: string; content: string; tags: string[]; result: string | null; metadata: unknown; created_at: string; updated_at: string };
export type EvolutionItemWithConversationDto = EvolutionItemDto;
export type EvolutionItemSearchResultDto = EvolutionItemDto;
export type KnowledgeEntryDto = { id: string; title: string; tags: string[]; content: string; scope: string };
export type KnowledgeSearchResultDto = KnowledgeEntryDto;
export type PromptDto = { id: string; title: string; content: string; tags: string[]; scope: string };
export type SkillDto = { name: string; description: string; content: string; scope: string; dir_path: string };
export type SnailDenTemplateDto = { key: string; name: string; agent_name: string; model: string; context_window?: number; invocation_timeout_ms?: number };
export type McpConfigDto = { name: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; scope: string; source?: 'builtin' | 'platform' | 'workspace'; workspace_path?: string };
