import type { SnailName, StageType } from "./types";

export type KnowledgeScopeType = "global" | "project" | "feature" | "stage_type" | "conversation" | "snail" | "code_area" | "workflow";
export type KnowledgeKind = "decision" | "rule" | "preference" | "incident" | "anti_pattern" | "glossary" | "open_question" | "procedure" | "fact" | "pattern";
export type KnowledgeStatus = "candidate" | "active" | "rejected" | "superseded" | "deprecated" | "archived";
export type KnowledgeGovernanceLevel = "L0" | "L1" | "L2" | "L3";
export type KnowledgeSourceType = "message" | "artifact" | "conversation" | "stage" | "feature" | "project" | "pull_request" | "review_comment" | "test_failure" | "external";
export type KnowledgePromptMode = "none" | "summary" | "full" | "reference_only";
export type KnowledgeUseType = "prompt_injection" | "manual_reference" | "search_result" | "skill" | "tool" | "checker";
export type KnowledgeGovernanceEntryStatus = "pending_entry_check" | "entry_check_passed" | "entry_check_closed" | "deferred" | "merged";
export type KnowledgeGovernanceDedupeStatus = "pending" | "unique" | "duplicate" | "related" | "merged";
export type KnowledgeGovernanceScenarioType = "pending" | "negative_feedback" | "new_knowledge_review";
export type KnowledgeGovernanceDispositionStatus = "pending" | "conclusion_only" | "pr_required" | "pr_open" | "pr_merged" | "landed" | "reference_only" | "merged_or_superseded" | "closed" | "deferred";
export type KnowledgeGovernanceArtifactType = "pending" | "conclusion_only" | "system_prompt_pr" | "skill_pr" | "core_doc_pr" | "user_manual_pr" | "code_or_checker_pr" | "merge_or_supersede_record";

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

export interface KnowledgeGovernanceConversation {
  id: string;
  governance_id: string;
  title: string;
  status: "active" | "completed" | "archived";
  default_snail: string;
  participating_snails: string[];
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeGovernance {
  id: string;
  knowledge_id: string;
  entry_check_status: KnowledgeGovernanceEntryStatus;
  dedupe_status: KnowledgeGovernanceDedupeStatus;
  scenario_type: KnowledgeGovernanceScenarioType;
  disposition_status: KnowledgeGovernanceDispositionStatus;
  artifact_type: KnowledgeGovernanceArtifactType;
  related_knowledge_ids: string[];
  final_destination: string | null;
  governance_pr_url: string | null;
  disposition_reason: string | null;
  deferred_reason: string | null;
  retrigger_condition: string | null;
  runtime_feedback_allowed: boolean;
  runtime_feedback_channels: string[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  conversation: KnowledgeGovernanceConversation | null;
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
  governance: KnowledgeGovernance | null;
  updated_at: string;
}

export interface KnowledgeWithDetails extends KnowledgeItem {
  sources: KnowledgeSource[];
  usage_policy: KnowledgeUsagePolicy | null;
  use_count: number;
  governance: KnowledgeGovernance | null;
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

export interface KnowledgeGovernanceUpdateInput {
  entryCheckStatus?: KnowledgeGovernanceEntryStatus;
  dedupeStatus?: KnowledgeGovernanceDedupeStatus;
  scenarioType?: KnowledgeGovernanceScenarioType;
  dispositionStatus?: KnowledgeGovernanceDispositionStatus;
  artifactType?: KnowledgeGovernanceArtifactType;
  relatedKnowledgeIds?: string[];
  finalDestination?: string | null;
  governancePrUrl?: string | null;
  dispositionReason?: string | null;
  deferredReason?: string | null;
  retriggerCondition?: string | null;
  runtimeFeedbackAllowed?: boolean;
  runtimeFeedbackChannels?: string[];
}
