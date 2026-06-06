import type {
  KnowledgeLibraryEntry,
  KnowledgeLibrarySearchResult,
  KnowledgeLibraryScope,
} from "../../shared";

// Re-export directly
export type { KnowledgeLibraryEntry, KnowledgeLibrarySearchResult, KnowledgeLibraryScope };

// Backward-compatible aliases
export type KnowledgeEntryDto = KnowledgeLibraryEntry;
export type KnowledgeSearchResultDto = KnowledgeLibrarySearchResult;
