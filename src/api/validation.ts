import type { ArtifactStorageType, ArtifactType, ConversationKind, KnowledgeEventKind, KnowledgeProposalStatus, StageStatus } from "../persistence/store";
import { loadArtifactDefinitions } from "../meta";

export function isConversationKind(value: string): value is ConversationKind {
  return ["discussion", "planning", "design", "implementation", "review", "bugfix"].includes(value);
}

export function isArtifactType(value: string): value is ArtifactType {
  return Object.prototype.hasOwnProperty.call(loadArtifactDefinitions(), value);
}

export function isArtifactStorageType(value: string): value is ArtifactStorageType {
  return ["markdown_file", "inline_text", "json_record", "external_ref"].includes(value);
}

export function isStageStatus(value: string): value is StageStatus {
  return ["in_progress", "completed", "cancelled"].includes(value);
}

export function isKnowledgeProposalDecision(value: string): value is Extract<KnowledgeProposalStatus, "accepted" | "accepted_project_local" | "rejected" | "deferred"> {
  return ["accepted", "accepted_project_local", "rejected", "deferred"].includes(value);
}

export function isKnowledgeValidationEvent(value: string): value is Extract<KnowledgeEventKind, "validated" | "contested"> {
  return ["validated", "contested"].includes(value);
}
