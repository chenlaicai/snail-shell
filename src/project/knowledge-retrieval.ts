import type { KnowledgeEntry, SnailName, StageType } from "../persistence/store";

export interface KnowledgeRetrievalInput {
  entries: KnowledgeEntry[];
  stageType: StageType;
  snailName: SnailName;
  projectKind: string;
}

export interface KnowledgeRetrievalResult {
  mandatory: KnowledgeEntry[];
  recommended: KnowledgeEntry[];
  reference: KnowledgeEntry[];
}

export function retrieveKnowledgeForPrompt(input: KnowledgeRetrievalInput): KnowledgeRetrievalResult {
  const applicable = input.entries
    .filter((entry) => entry.status === "active")
    .filter((entry) => isApplicable(entry, input.stageType, input.snailName, input.projectKind))
    .sort(compareKnowledgePriority);

  return {
    mandatory: applicable.filter((entry) => entry.authority === "mandatory").slice(0, 6),
    recommended: applicable.filter((entry) => entry.authority === "recommended").slice(0, 6),
    reference: applicable.filter((entry) => entry.authority === "reference").slice(0, 4),
  };
}

function isApplicable(entry: KnowledgeEntry, stageType: StageType, snailName: SnailName, projectKind: string): boolean {
  const applicability = entry.applicability.toLowerCase();
  if (!applicability.trim()) {
    return true;
  }

  return [stageType.toLowerCase(), snailName.toLowerCase(), projectKind.toLowerCase()].some((token) => applicability.includes(token));
}

function compareKnowledgePriority(left: KnowledgeEntry, right: KnowledgeEntry): number {
  return priorityScore(right) - priorityScore(left);
}

function priorityScore(entry: KnowledgeEntry): number {
  const scopeScore = entry.scope === "system" ? 30 : entry.scope === "cross_project" ? 20 : 10;
  const authorityScore = entry.authority === "mandatory" ? 30 : entry.authority === "recommended" ? 20 : 10;
  const typeScore = entry.knowledge_type === "principle" ? 15 : entry.knowledge_type === "protocol" ? 10 : 5;
  return scopeScore + authorityScore + typeScore;
}
