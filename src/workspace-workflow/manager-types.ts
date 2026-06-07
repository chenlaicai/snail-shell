import type { SnailDen, SystemAI } from "../snail-den";
import type { Conversation, MessageWithEvents } from "../shared/types";

export interface WorkspaceManagerDeps {
  systemAI: SystemAI;
  snailDen: SnailDen;
}

export interface SummaryGenerationInput {
  conversation: Conversation;
  previousSummary: string;
  recentMessages: MessageWithEvents[];
}
