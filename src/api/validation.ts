import type { ArtifactStorageType, ArtifactType, ConversationKind, StageStatus } from "../persistence/store";
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
