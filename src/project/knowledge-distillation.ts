import { randomUUID } from "crypto";
import { logger } from "../logger";
import type { KnowledgeProposalGenerator } from "../llm";
import type { ConversationStore, Project, Stage } from "../persistence/store";

export async function generateStageKnowledgeProposals(
  store: ConversationStore,
  knowledgeProposalGenerator: KnowledgeProposalGenerator,
  project: Project,
  stage: Stage
) {
  const conversations = store.listConversationsByStage(stage.id);
  const artifacts = store.listArtifactsByStage(stage.id);
  const formalArtifacts = artifacts.filter((artifact) => stage.formal_artifacts.includes(artifact.id));

  if (!conversations.length || !artifacts.length) {
    return [];
  }

  const conversationInputs = buildConversationInputs(store, conversations);

  try {
    const proposals = await knowledgeProposalGenerator.generateKnowledgeProposals({
      project: {
        id: project.id,
        name: project.name,
        kind: project.kind,
      },
      stage,
      conversations: conversationInputs,
      artifacts,
      formalArtifacts,
    });

    return proposals.map((proposal) => store.createKnowledgeProposal({
      id: randomUUID(),
      projectId: project.id,
      stageId: stage.id,
      sourceStageType: proposal.source_stage_type,
      title: proposal.title,
      summary: proposal.summary,
      knowledgeType: proposal.knowledge_type,
      status: proposal.status,
      rationale: proposal.rationale,
      applicability: proposal.applicability,
      review: proposal.review,
      evidence: proposal.evidence,
    }));
  } catch (error) {
    logger.warn("Stage knowledge distillation failed", {
      projectId: project.id,
      stageId: stage.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function buildConversationInputs(store: ConversationStore, conversations: ReturnType<ConversationStore["listConversationsByStage"]>) {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: store.getRecentMessages(conversation.id, 12)
      .filter((message) => message.role === "user" || message.role === "assistant"),
  }));
}
