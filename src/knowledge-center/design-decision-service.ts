import { randomUUID } from "crypto";
import type { ConversationStore, CreateDesignDecisionInput, DesignDecisionListFilters, UpdateDesignDecisionInput } from "../persistence/store";

export function createDesignDecision(store: ConversationStore, input: Omit<CreateDesignDecisionInput, "id">) {
  return store.createDesignDecision({ ...input, id: randomUUID() });
}

export function getDesignDecision(store: ConversationStore, id: string) {
  return store.getDesignDecision(id);
}

export function listDesignDecisions(store: ConversationStore, filters: DesignDecisionListFilters = {}) {
  return store.listDesignDecisions(filters);
}

export function searchDesignDecisions(store: ConversationStore, filters: DesignDecisionListFilters) {
  return store.searchDesignDecisions(filters);
}

export function updateDesignDecision(store: ConversationStore, id: string, updates: UpdateDesignDecisionInput) {
  return store.updateDesignDecision(id, updates);
}

export function deprecateDesignDecision(store: ConversationStore, id: string) {
  return store.deprecateDesignDecision(id);
}
