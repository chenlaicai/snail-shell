import type { ConversationKind, SnailName, StageStatus } from "../../persistence/store";

const KNOWN_SNAIL_NAMES: SnailName[] = [
  "Boss Snail",
  "Owner Snail",
  "Product Snail",
  "Design Snail",
  "Implementation Snail",
  "Acceptance Snail",
];

export function isConversationKind(value: string): value is ConversationKind {
  return ["discussion", "planning", "design", "implementation", "review", "bugfix"].includes(value);
}

export function isStageStatus(value: string): value is StageStatus {
  return ["in_progress", "completed", "cancelled"].includes(value);
}

export function isSnailName(value: string): value is SnailName {
  return KNOWN_SNAIL_NAMES.includes(value as SnailName);
}
