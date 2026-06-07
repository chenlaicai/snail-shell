import type { ConversationKind, RoleName, StageStatus } from "../../shared/types";

export function isConversationKind(value: string): value is ConversationKind {
  return ["discussion", "planning", "design", "implementation", "review", "bugfix"].includes(value);
}

export function isStageStatus(value: string): value is StageStatus {
  return ["in_progress", "completed", "cancelled"].includes(value);
}

export function isRoleName(value: string): value is RoleName {
  return typeof value === "string" && value.length > 0;
}
