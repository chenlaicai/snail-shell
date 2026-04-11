export type ProjectKind = "system_self" | "product_delivery";
export type ProjectStatus = "active" | "paused" | "completed" | "cancelled" | "archived";
export type StageType =
  | "init"
  | "discuss"
  | "coding"
  | "check"
  | "publish";
export type StageStatus = "in_progress" | "completed" | "cancelled";
export type ConversationKind = "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";
export type ConversationStatus = "active" | "paused" | "completed" | "archived";
export type SnailName = "owner" | "product_agent" | "design_agent" | "implementation_agent" | "acceptance_agent";
export type MessageRole = "user" | "assistant" | "system";
export type MessagePartType = "text" | "tool_use" | "result" | "system_event";
export type ArtifactStatus = "draft" | "active" | "approved" | "superseded" | "archived";
export type ArtifactStorageType = "markdown_file" | "inline_text" | "json_record" | "external_ref";
export type ArtifactType =
  | "project_charter"
  | "initiative_discussion_record"
  | "requirement_document"
  | "product_specification"
  | "technical_design"
  | "implementation_task_breakdown"
  | "acceptance_report"
  | "code_commit"
  | "code_change_record"
  | "evolution_record"
  | "bug_analysis";

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

export interface Conversation {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  kind: ConversationKind;
  status: ConversationStatus;
  default_snail: string;
  participating_snails: SnailName[];
  summary: string | null;
  from_conversation_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: string;
  role: MessageRole;
  snail_name: string | null;
  created_at: string;
}

export interface MessagePart {
  id: number;
  message_id: number;
  sequence: number;
  part_type: MessagePartType;
  content: string;
  created_at: string;
}

export interface MessageWithParts extends Message {
  parts: MessagePart[];
}

export interface ConversationHistorySearchResult {
  message_id: number;
  role: MessageRole;
  snail_name: string | null;
  created_at: string;
  snippet: string;
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
  defaultSnail: string;
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
