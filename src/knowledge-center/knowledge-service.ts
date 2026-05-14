import { randomUUID } from "crypto";
import type {
  ConversationStore,
  CreateKnowledgeInput,
  KnowledgeApprovalInput,
  KnowledgeGovernanceUpdateInput,
  KnowledgeListFilters,
  KnowledgeSearchResult,
  KnowledgeUsagePolicyInput,
  KnowledgeWithDetails,
  RecordKnowledgeUseInput,
  SnailName,
  StageType,
} from "../persistence/store";

export function createKnowledge(store: ConversationStore, input: Omit<CreateKnowledgeInput, "id">): KnowledgeWithDetails {
  return store.createKnowledge({ ...input, id: randomUUID() });
}

export function listPromptInjectableKnowledge(store: ConversationStore, input: { projectId: string; featureId: string; stageType: StageType; snailName: SnailName; conversationId?: string | null; stageId?: string | null; limit?: number }): KnowledgeWithDetails[] {
  return store.listPromptInjectableKnowledge(input);
}

export function listKnowledgeGovernance(store: ConversationStore, limit = 50, offset = 0) {
  return store.listKnowledgeGovernance(limit, offset);
}

export function getKnowledgeGovernance(store: ConversationStore, id: string) {
  return store.getKnowledgeGovernance(id);
}

export function updateKnowledgeGovernance(store: ConversationStore, id: string, input: KnowledgeGovernanceUpdateInput) {
  const updated = store.updateKnowledgeGovernance(id, input);
  const knowledge = store.getKnowledge(updated.knowledge_id);
  if (knowledge?.status === "active" && updated.runtime_feedback_allowed && updated.runtime_feedback_channels.includes("prompt") && !knowledge.usage_policy) {
    store.upsertKnowledgeUsagePolicy(knowledge.id, defaultKnowledgeUsagePolicy(knowledge));
  }
  return store.getKnowledgeGovernance(id);
}

export function listKnowledge(store: ConversationStore, filters: KnowledgeListFilters = {}): KnowledgeSearchResult[] {
  return store.listKnowledge(filters);
}

export function getKnowledge(store: ConversationStore, id: string): KnowledgeWithDetails | null {
  return store.getKnowledge(id);
}

export function approveKnowledge(store: ConversationStore, id: string, input: KnowledgeApprovalInput): KnowledgeWithDetails {
  const approved = store.approveKnowledge(id, input);
  if (approved.governance?.runtime_feedback_allowed && approved.governance.runtime_feedback_channels.includes("prompt") && !approved.usage_policy) {
    /**
     * 候选批准不再等于自动反哺；只有治理裁决明确允许 prompt 通道时，才生成默认注入策略。
     * 这样保留人工治理闭环，避免"候选审批"绕过最终去向裁决直接影响后续 agent 行为。
     */
    store.upsertKnowledgeUsagePolicy(id, defaultKnowledgeUsagePolicy(approved));
  }
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

export function upsertKnowledgeUsagePolicy(store: ConversationStore, id: string, input: KnowledgeUsagePolicyInput) {
  return store.upsertKnowledgeUsagePolicy(id, input);
}

export function listKnowledgeUses(store: ConversationStore, id: string) {
  return store.listKnowledgeUses(id);
}

export function recordKnowledgeUse(store: ConversationStore, input: Omit<RecordKnowledgeUseInput, "id">) {
  return store.recordKnowledgeUse({ ...input, id: randomUUID() });
}

function defaultKnowledgeUsagePolicy(knowledge: KnowledgeWithDetails): KnowledgeUsagePolicyInput {
  const promptMode = knowledge.kind === "decision" ? "summary" : "reference_only";
  return {
    allowPromptInjection: knowledge.governance_level === "L2" || knowledge.kind === "preference" || knowledge.kind === "rule",
    promptMode,
    priority: knowledge.scope_type === "project" || knowledge.scope_type === "feature" ? 20 : 10,
  };
}
