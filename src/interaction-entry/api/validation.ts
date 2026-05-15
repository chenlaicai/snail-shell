import type { ArtifactStorageType, ArtifactType, ConversationKind, SnailName, StageStatus } from "../../persistence/store";
import { loadArtifactDefinitions } from "../../meta";

const KNOWN_SNAIL_NAMES: SnailName[] = [
  "Boss Snail",
  "Implementation Snail",
  "Acceptance Snail",
];

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

export function isSnailName(value: string): value is SnailName {
  return KNOWN_SNAIL_NAMES.includes(value as SnailName);
}
