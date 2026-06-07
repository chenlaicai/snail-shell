import { randomUUID } from "crypto";
import type {
  ConversationStore,
  CreateEvolutionItemInput,
  EvolutionItemListFilters,
  EvolutionItemSearchResult,
  EvolutionItemWithConversation,
  UpdateEvolutionItemInput,
} from "../persistence/store";

export function createEvolutionItem(
  store: ConversationStore,
  input: Omit<CreateEvolutionItemInput, "id">,
  roleSnailMapping: Record<string, Record<string, string>>,
): EvolutionItemWithConversation {
  return store.evolution.create({ ...input, id: randomUUID() }, roleSnailMapping);
}

export function getEvolutionItem(
  store: ConversationStore,
  id: string,
): EvolutionItemWithConversation | null {
  return store.evolution.get(id);
}

export function listEvolutionItems(
  store: ConversationStore,
  filters: EvolutionItemListFilters = {},
): EvolutionItemSearchResult[] {
  return store.evolution.list(filters);
}

export function updateEvolutionItem(
  store: ConversationStore,
  id: string,
  input: UpdateEvolutionItemInput,
): EvolutionItemWithConversation {
  return store.evolution.update(id, input);
}
