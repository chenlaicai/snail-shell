import type {
  EvolutionItem,
  EvolutionItemWithConversation,
  EvolutionItemSearchResult,
} from "../../shared";

// Re-export directly
export type { EvolutionItem, EvolutionItemWithConversation, EvolutionItemSearchResult };

// Backward-compatible aliases
export type EvolutionItemSearchResultDto = EvolutionItemSearchResult;
export type EvolutionItemWithConversationDto = EvolutionItemWithConversation;
