import type { SnailName, StageType } from "./types";

export type KnowledgeScopeType = "global" | "project" | "feature" | "stage_type" | "conversation" | "snail" | "code_area" | "workflow";
export type KnowledgeKind = "decision" | "rule" | "preference" | "incident" | "anti_pattern" | "glossary" | "open_question" | "procedure" | "fact" | "pattern";
export type KnowledgeStatus = "candidate" | "pending_document" | "active" | "rejected" | "superseded" | "deprecated" | "archived";
export type KnowledgeGovernanceLevel = "L0" | "L1" | "L2" | "L3";
export type KnowledgeSourceType = "message" | "artifact" | "conversation" | "stage" | "feature" | "project" | "pull_request" | "review_comment" | "test_failure" | "external";
export type KnowledgePromptMode = "none" | "summary" | "full" | "reference_only";
export type KnowledgeUseType = "prompt_injection" | "manual_reference" | "search_result" | "skill" | "tool" | "checker";
export type KnowledgeRuntimeState = "inactive" | "pending_restart" | "active" | "failed";
export type KnowledgeChangeRequestType = "create" | "update" | "deprecate" | "supersede" | "archive" | "prompt_policy_update";
export type KnowledgeChangeRequestState = "draft" | "in_progress" | "completed" | "cancelled" | "failed";
export type KnowledgeChangePrState = "none" | "open" | "changes_requested" | "approved" | "merged" | "closed";

export interface KnowledgeItem {
  id: string;
  project_id: string | null;
  scope_type: KnowledgeScopeType;
  scope_ref: string | null;
  kind: KnowledgeKind;
  status: KnowledgeStatus;
  governance_level: KnowledgeGovernanceLevel;
  title: string;
  content: string;
  rationale: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  metadata: string | null;
  document_path: string | null;
  document_hash: string | null;
  runtime_state: KnowledgeRuntimeState;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSource {
  id: string;
  knowledge_id: string;
  source_type: KnowledgeSourceType;
  source_id: string;
  quote: string | null;
  created_at: string;
}

export interface KnowledgeUsagePolicy {
  knowledge_id: string;
  allow_prompt_injection: boolean;
  prompt_mode: KnowledgePromptMode;
  skill_visibility: string[];
  tool_visibility: string[];
  checker_binding: string | null;
  stage_types: StageType[];
  snail_names: SnailName[];
  priority: number;
  token_budget: number | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeUse {
  id: string;
  knowledge_id: string;
  conversation_id: string | null;
  stage_id: string | null;
  snail_name: string | null;
  use_type: KnowledgeUseType;
  outcome: string | null;
  feedback: string | null;
  created_at: string;
}

export interface KnowledgeSearchResult {
  id: string;
  project_id: string | null;
  scope_type: KnowledgeScopeType;
  scope_ref: string | null;
  kind: KnowledgeKind;
  status: KnowledgeStatus;
  governance_level: KnowledgeGovernanceLevel;
  title: string;
  content: string;
  snippet: string;
  updated_at: string;
}

export interface KnowledgeWithDetails extends KnowledgeItem {
  sources: KnowledgeSource[];
  usage_policy: KnowledgeUsagePolicy | null;
  use_count: number;
}

export interface CreateKnowledgeInput {
  id: string;
  projectId?: string | null;
  scopeType: KnowledgeScopeType;
  scopeRef?: string | null;
  kind: KnowledgeKind;
  status?: KnowledgeStatus;
  governanceLevel?: KnowledgeGovernanceLevel;
  title: string;
  content: string;
  rationale?: string | null;
  createdBy?: string | null;
  metadata?: string | null;
  sources?: Array<{ id: string; sourceType: KnowledgeSourceType; sourceId: string; quote?: string | null }>;
}

export interface KnowledgeChangeRequest {
  id: string;
  type: KnowledgeChangeRequestType;
  request_state: KnowledgeChangeRequestState;
  pr_state: KnowledgeChangePrState;
  runtime_state: KnowledgeRuntimeState | "not_applicable";
  candidate_id: string | null;
  knowledge_id: string | null;
  target_knowledge_id: string | null;
  document_path: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  pr_url: string | null;
  pr_number: number | null;
  latest_commit_sha: string | null;
  merge_commit_sha: string | null;
  expected_document_hash: string | null;
  synced_document_hash: string | null;
  created_by: string | null;
  approved_by: string | null;
  error_message: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChangeRequestEvent {
  id: string;
  request_id: string;
  event_type: string;
  actor: string | null;
  pr_url: string | null;
  commit_sha: string | null;
  document_path: string | null;
  document_hash: string | null;
  payload: string | null;
  created_at: string;
}

export interface CreateKnowledgeChangeRequestInput {
  id: string;
  type: KnowledgeChangeRequestType;
  candidateId?: string | null;
  knowledgeId?: string | null;
  targetKnowledgeId?: string | null;
  documentPath?: string | null;
  branchName?: string | null;
  worktreePath?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  expectedDocumentHash?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  metadata?: string | null;
}

export interface UpdateKnowledgeChangeRequestRepoInput {
  id: string;
  prState?: KnowledgeChangePrState;
  runtimeState?: KnowledgeRuntimeState | "not_applicable";
  requestState?: KnowledgeChangeRequestState;
  documentPath?: string | null;
  branchName?: string | null;
  worktreePath?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  latestCommitSha?: string | null;
  mergeCommitSha?: string | null;
  expectedDocumentHash?: string | null;
  actor?: string | null;
  eventType?: string;
}

export interface KnowledgeDocumentSyncInput {
  item: CreateKnowledgeInput & { status: Exclude<KnowledgeStatus, "candidate" | "pending_document" | "rejected">; approvedBy?: string | null; approvedAt?: string | null };
  documentPath: string;
  documentHash: string;
  usagePolicy?: KnowledgeUsagePolicyInput | null;
  changeRequestId?: string | null;
}

export interface KnowledgeListFilters {
  projectId?: string | null;
  scopeType?: KnowledgeScopeType;
  scopeRef?: string;
  kind?: KnowledgeKind;
  status?: KnowledgeStatus;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface KnowledgeApprovalInput {
  reviewer: string;
  comment?: string | null;
  updates?: Partial<Pick<KnowledgeItem, "title" | "content" | "rationale" | "scope_type" | "scope_ref" | "kind" | "governance_level" | "metadata">>;
}

export interface KnowledgeUsagePolicyInput {
  allowPromptInjection?: boolean;
  promptMode?: KnowledgePromptMode;
  skillVisibility?: string[];
  toolVisibility?: string[];
  checkerBinding?: string | null;
  stageTypes?: StageType[];
  snailNames?: SnailName[];
  priority?: number;
  tokenBudget?: number | null;
}

export interface RecordKnowledgeUseInput {
  id: string;
  knowledgeId: string;
  conversationId?: string | null;
  stageId?: string | null;
  snailName?: string | null;
  useType: KnowledgeUseType;
  outcome?: string | null;
  feedback?: string | null;
}
