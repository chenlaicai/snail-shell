import type {
  EvolutionItem,
  EvolutionItemWithConversation,
  EvolutionItemSearchResult,
} from "../../shared";

// EvolutionItem entity
export type EvolutionItemDto = EvolutionItem;

// EvolutionItem + conversation enrichment
export type EvolutionItemWithConversationDto = EvolutionItemWithConversation;

// EvolutionItem search result (includes snippet)
export type EvolutionItemSearchResultDto = EvolutionItemSearchResult;
