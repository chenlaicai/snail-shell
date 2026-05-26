import { randomUUID } from "crypto";
import type { ConversationStore, CreateKnowledgeLibraryInput, KnowledgeLibraryListFilters, UpdateKnowledgeLibraryInput } from "../persistence/store";

export function createKnowledgeLibraryEntry(store: ConversationStore, input: Omit<CreateKnowledgeLibraryInput, "id">) {
  return store.createKnowledgeLibraryEntry({ ...input, id: randomUUID() });
}

export function getKnowledgeLibraryEntry(store: ConversationStore, id: string) {
  return store.getKnowledgeLibraryEntry(id);
}

export function listKnowledgeLibrary(store: ConversationStore, filters: KnowledgeLibraryListFilters = {}) {
  return store.listKnowledgeLibrary(filters);
}

export function searchKnowledgeLibrary(store: ConversationStore, filters: KnowledgeLibraryListFilters) {
  return store.searchKnowledgeLibrary(filters);
}

export function getKnowledgeLibraryKindSummaries(store: ConversationStore, projectId?: string | null) {
  return store.getKnowledgeLibraryKindSummaries(projectId);
}

export function updateKnowledgeLibraryEntry(store: ConversationStore, id: string, updates: UpdateKnowledgeLibraryInput) {
  return store.updateKnowledgeLibraryEntry(id, updates);
}

export function deprecateKnowledgeLibraryEntry(store: ConversationStore, id: string) {
  return store.deprecateKnowledgeLibraryEntry(id);
}
