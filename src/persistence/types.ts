import type { SnailName, StageType, ArtifactType } from "../meta/generated-types";

export type { SnailName, StageType, ArtifactType };

export type ProjectKind = "system_self" | "product_delivery";
export type ProjectStatus = "active" | "paused" | "completed" | "cancelled" | "archived";
export type StageStatus = "in_progress" | "completed" | "cancelled";
export type ConversationKind = "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";
export type ConversationStatus = "active" | "paused" | "completed" | "archived";
export type MessageRole = "user" | "assistant" | "system";
export type MessagePartType = "streaming_chunk" | "content" | "tool_use" | "system_event";

// Constants for part types
export const PartType = {
  STREAMING_CHUNK: "streaming_chunk" as const,
  CONTENT: "content" as const,
  TOOL_USE: "tool_use" as const,
  SYSTEM_EVENT: "system_event" as const,
} as const;
export type MessageDispatchStatus = "pending" | "seen" | "consumed" | "skipped";
export type ArtifactStatus = "draft" | "active" | "approved" | "superseded" | "archived";
export type ArtifactStorageType = "markdown_file" | "inline_text" | "json_record" | "external_ref";
export type KnowledgeType = "principle" | "protocol" | "experience";
export type KnowledgeScope = "system" | "cross_project" | "project_local";
export type KnowledgeAuthority = "mandatory" | "recommended" | "reference";
export type KnowledgeProposalStatus = "pending_review" | "accepted" | "accepted_project_local" | "rejected" | "deferred";
export type KnowledgeEntryStatus = "active" | "superseded" | "archived";
export type KnowledgeEventKind = "prompt_injected" | "validated" | "contested" | "superseded";

export interface Project {
  id: string;
  kind: ProjectKind;
  name: string;
  summary: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: string;
  project_id: string;
  type: StageType;
  sequence: number;
  status: StageStatus;
  formal_artifacts: string[];
  created_at: string;
  updated_at: string;
  entered_at: string | null;
  left_at: string | null;
}

export interface RuntimeSessionBinding {
  sessionId: string;
}

export interface Conversation {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  kind: ConversationKind;
  status: ConversationStatus;
  default_snail: SnailName;
  participating_snails: SnailName[];
  summary: string | null;
  from_conversation_ids: string[];
  runtime_sessions: Partial<Record<SnailName, RuntimeSessionBinding>>;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: string;
  producer_snail: SnailName | null;
  role: MessageRole;
  reply_to_message_id: number | null;
  quoted_message_id?: number | null;
  context_cutoff_at: string;
  created_at: string;
}

export interface MessagePart {
  id: number;
  message_id: number;
  part_type: MessagePartType;
  text_value: string | null;
  mentions?: SnailName[];
  json_value: string | null;
  created_at: string;
}

export interface MessageWithParts extends Message {
  parts: MessagePart[];
  quoted_message?: QuotedMessagePreview | null;
}

export interface QuotedMessagePreview {
  id: number;
  role: MessageRole;
  producer_snail: SnailName | null;
  preview: string;
  created_at: string;
}

export interface MessageDispatch {
  id: number;
  conversation_id: string;
  message_id: number;
  target_snail: SnailName;
  status: MessageDispatchStatus;
  consumed_by_message_id: number | null;
  created_at: string;
  consumed_at: string | null;
}

export interface DispatchInboxGroup {
  target_snail: SnailName;
  status: MessageDispatchStatus;
  dispatch_ids: number[];
  message_ids: number[];
  latest_dispatch_at: string;
}

export interface DispatchInboxPreviewItem {
  message_id: number;
  producer_snail: SnailName | null;
  role: MessageRole;
  preview: string;
  created_at: string;
}

export interface ConversationHistorySearchResult {
  message_id: number;
  role: MessageRole;
  producer_snail: SnailName | null;
  created_at: string;
  snippet: string;
}

export interface CreateMessageInput {
  conversationId: string;
  producerSnail: SnailName | null;
  role: MessageRole;
  replyToMessageId?: number | null;
  quotedMessageId?: number | null;
  contextCutoffAt?: string;
}

export interface MessagePartInput {
  part_type: MessagePartType;
  text_value?: string | null;
  mentions?: SnailName[];
  json_value?: string | null;
}

export interface CreateMessageDispatchInput {
  conversationId: string;
  messageId: number;
  targetSnail: SnailName;
}

export interface Artifact {
  id: string;
  project_id: string;
  stage_id: string;
  conversation_id: string;
  artifact_type: ArtifactType;
  title: string;
  status: ArtifactStatus;
  storage_type: ArtifactStorageType;
  file_path: string | null;
  inline_content: string | null;
  external_ref: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeProposalEvidence {
  conversation_ids: string[];
  artifact_ids: string[];
  formal_artifact_ids: string[];
}

export interface KnowledgeProposalReview {
  suggested_scope: KnowledgeScope;
  suggested_authority: KnowledgeAuthority;
  confidence: number;
  why_include: string[];
  why_not_include: string[];
  risk_if_wrong: string;
  reviewer_mode: "single_model" | "ephemeral_council";
  council_views?: KnowledgeCouncilView[];
}

export interface KnowledgeCouncilView {
  reviewer: string;
  focus: string;
  stance: "support" | "caution" | "neutral";
  notes: string[];
}

export interface KnowledgeProposal {
  id: string;
  project_id: string;
  stage_id: string;
  source_stage_type: StageType;
  title: string;
  summary: string;
  knowledge_type: KnowledgeType;
  status: KnowledgeProposalStatus;
  rationale: string;
  applicability: string;
  review: KnowledgeProposalReview;
  evidence: KnowledgeProposalEvidence;
  knowledge_entry_id: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
}

export interface KnowledgeEntry {
  id: string;
  project_id: string;
  stage_id: string;
  proposal_id: string;
  title: string;
  summary: string;
  knowledge_type: KnowledgeType;
  scope: KnowledgeScope;
  authority: KnowledgeAuthority;
  status: KnowledgeEntryStatus;
  rationale: string;
  applicability: string;
  evidence: KnowledgeProposalEvidence;
  supersedes_entry_id: string | null;
  superseded_by_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEvent {
  id: string;
  knowledge_entry_id: string;
  project_id: string;
  stage_id: string | null;
  conversation_id: string | null;
  event_kind: KnowledgeEventKind;
  note: string | null;
  metadata: string | null;
  created_at: string;
}

export interface CreateStageInput {
  id: string;
  projectId: string;
  type: StageType;
  sequence: number;
  status: StageStatus;
  formalArtifacts?: string[];
  enteredAt?: string | null;
}

export interface CreateConversationInput {
  id: string;
  projectId: string;
  stageId: string;
  title: string;
  kind: ConversationKind;
  defaultSnail: SnailName;
  participatingSnails: SnailName[];
  summary?: string;
  fromConversationIds?: string[];
}

export interface ArtifactContentOptions {
  filePath?: string;
  inlineContent?: string;
  externalRef?: string;
  metadata?: string;
}

export interface CreateArtifactInput {
  id: string;
  projectId: string;
  stageId: string;
  conversationId: string;
  artifactType: ArtifactType;
  title: string;
  status: ArtifactStatus;
  storageType: ArtifactStorageType;
  options?: ArtifactContentOptions;
}

export interface CreateKnowledgeProposalInput {
  id: string;
  projectId: string;
  stageId: string;
  sourceStageType: StageType;
  title: string;
  summary: string;
  knowledgeType: KnowledgeType;
  status: KnowledgeProposalStatus;
  rationale: string;
  applicability: string;
  review: KnowledgeProposalReview;
  evidence: KnowledgeProposalEvidence;
}

export interface CreateKnowledgeEntryInput {
  id: string;
  projectId: string;
  stageId: string;
  proposalId: string;
  title: string;
  summary: string;
  knowledgeType: KnowledgeType;
  scope: KnowledgeScope;
  authority: KnowledgeAuthority;
  status: KnowledgeEntryStatus;
  rationale: string;
  applicability: string;
  evidence: KnowledgeProposalEvidence;
  supersedesEntryId?: string | null;
}

export interface CreateKnowledgeEventInput {
  id: string;
  knowledgeEntryId: string;
  projectId: string;
  stageId?: string | null;
  conversationId?: string | null;
  eventKind: KnowledgeEventKind;
  note?: string | null;
  metadata?: string | null;
}
