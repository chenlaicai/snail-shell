import type { ConversationStore, Conversation, Stage } from "../persistence/store";
import { sumBossPendingCount } from "./manager-events";
import type { ConversationDetail, StageDetail } from "./manager-types";

export function buildConversationDetail(store: ConversationStore, conversation: Conversation): ConversationDetail {
  return {
    ...conversation,
    message_count: store.getMessages(conversation.id).length,
    artifact_count: store.listArtifactsByConversation(conversation.id).length,
    boss_pending_count: store.listBossPendingDispatches(conversation.id).length,
  };
}

export function buildStageDetail(store: ConversationStore, stage: Stage): StageDetail {
  return {
    ...stage,
    boss_pending_count: sumBossPendingCount(store.listConversationsByStage(stage.id), (conversationId) => store.listBossPendingDispatches(conversationId).length),
    knowledge_proposals: store.listKnowledgeProposalsByStage(stage.id),
    knowledge_entries: store.listKnowledgeEntriesByStage(stage.id),
  };
}
