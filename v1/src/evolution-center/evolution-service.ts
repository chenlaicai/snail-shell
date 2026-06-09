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
  return store.createEvolutionItem({ ...input, id: randomUUID() }, roleSnailMapping);
}

export function getEvolutionItem(
  store: ConversationStore,
  id: string,
): EvolutionItemWithConversation | null {
  return store.getEvolutionItem(id);
}

export function listEvolutionItems(
  store: ConversationStore,
  filters: EvolutionItemListFilters = {},
): EvolutionItemSearchResult[] {
  return store.listEvolutionItems(filters);
}

export function updateEvolutionItem(
  store: ConversationStore,
  id: string,
  input: UpdateEvolutionItemInput,
): EvolutionItemWithConversation {
  return store.updateEvolutionItem(id, input);
}
