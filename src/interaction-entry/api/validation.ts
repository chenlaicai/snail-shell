import type { ConversationKind, SnailName, StageStatus } from "../../persistence/store";

export function isConversationKind(value: string): value is ConversationKind {
  return ["discussion", "planning", "design", "implementation", "review", "bugfix"].includes(value);
}

export function isStageStatus(value: string): value is StageStatus {
  return ["in_progress", "completed", "cancelled"].includes(value);
}

export function isSnailName(value: string): value is SnailName {
  return typeof value === "string" && value.length > 0;
}
