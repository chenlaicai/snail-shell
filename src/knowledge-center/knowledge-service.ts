import { randomUUID } from "crypto";
import type {
  ConversationStore,
  CreateKnowledgeInput,
  KnowledgeApprovalInput,
  KnowledgeGovernanceUpdateInput,
  KnowledgeListFilters,
  KnowledgeSearchResult,
  KnowledgeWithDetails,
  RecordKnowledgeUseInput,
} from "../persistence/store";

export function createKnowledge(store: ConversationStore, input: Omit<CreateKnowledgeInput, "id">): KnowledgeWithDetails {
  return store.createKnowledge({ ...input, id: randomUUID() });
}

export function listKnowledgeGovernance(store: ConversationStore, limit = 50, offset = 0) {
  return store.listKnowledgeGovernance(limit, offset);
}

export function getKnowledgeGovernance(store: ConversationStore, id: string) {
  return store.getKnowledgeGovernance(id);
}

export function updateKnowledgeGovernance(store: ConversationStore, id: string, input: KnowledgeGovernanceUpdateInput) {
  store.updateKnowledgeGovernance(id, input);
  return store.getKnowledgeGovernance(id);
}

export function listKnowledge(store: ConversationStore, filters: KnowledgeListFilters = {}): KnowledgeSearchResult[] {
  return store.listKnowledge(filters);
}

export function getKnowledge(store: ConversationStore, id: string): KnowledgeWithDetails | null {
  return store.getKnowledge(id);
}

export function approveKnowledge(store: ConversationStore, id: string, input: KnowledgeApprovalInput): KnowledgeWithDetails {
  store.approveKnowledge(id, input);
  return store.getKnowledge(id)!;
}

export function rejectKnowledge(store: ConversationStore, id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
  return store.rejectKnowledge(id, reviewer, comment);
}

export function deprecateKnowledge(store: ConversationStore, id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
  return store.deprecateKnowledge(id, reviewer, comment);
}

export function archiveKnowledge(store: ConversationStore, id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
  return store.archiveKnowledge(id, reviewer, comment);
}

export function listKnowledgeUses(store: ConversationStore, id: string) {
  return store.listKnowledgeUses(id);
}

export function recordKnowledgeUse(store: ConversationStore, input: Omit<RecordKnowledgeUseInput, "id">) {
  return store.recordKnowledgeUse({ ...input, id: randomUUID() });
}
