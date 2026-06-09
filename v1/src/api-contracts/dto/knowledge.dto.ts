import type {
  KnowledgeLibraryEntry,
  KnowledgeLibrarySearchResult,
  KnowledgeLibraryScope,
} from "../../shared";

// KnowledgeLibraryEntry entity
export type KnowledgeEntryDto = KnowledgeLibraryEntry;

// KnowledgeLibrarySearchResult (includes snippet)
export type KnowledgeSearchResultDto = KnowledgeLibrarySearchResult;

export type { KnowledgeLibraryScope };
