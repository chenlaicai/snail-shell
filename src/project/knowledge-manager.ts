import { randomUUID } from "crypto";
import type { ConversationStore, KnowledgeProposalStatus } from "../persistence/store";

export function listStageKnowledgeProposals(store: ConversationStore, stageId: string) {
  return store.listKnowledgeProposalsByStage(stageId);
}

export function listStageKnowledgeEntries(store: ConversationStore, stageId: string) {
  return store.listKnowledgeEntriesByStage(stageId);
}

export function listProjectKnowledgeEntries(store: ConversationStore, projectId: string) {
  return store.listKnowledgeEntriesByProject(projectId);
}

export function updateKnowledgeProposalDecision(
  store: ConversationStore,
  proposalId: string,
  status: Extract<KnowledgeProposalStatus, "accepted" | "accepted_project_local" | "rejected" | "deferred">
) {
  const proposal = store.getKnowledgeProposal(proposalId);
  if (!proposal) {
    throw new Error(`Knowledge proposal not found: ${proposalId}`);
  }

  let knowledgeEntryId = proposal.knowledge_entry_id;
  if ((status === "accepted" || status === "accepted_project_local") && !proposal.knowledge_entry_id) {
    const entry = store.createKnowledgeEntry({
      id: randomUUID(),
      projectId: proposal.project_id,
      stageId: proposal.stage_id,
      proposalId: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      knowledgeType: proposal.knowledge_type,
      scope: status === "accepted_project_local" ? "project_local" : proposal.review.suggested_scope,
      authority: proposal.review.suggested_authority,
      status: "active",
      rationale: proposal.rationale,
      applicability: proposal.applicability,
      evidence: proposal.evidence,
    });
    knowledgeEntryId = entry.id;
  }

  return store.updateKnowledgeProposal(proposalId, {
    status,
    knowledge_entry_id: knowledgeEntryId,
    decided_at: new Date().toISOString(),
  });
}
