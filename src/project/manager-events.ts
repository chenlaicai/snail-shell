import type { BossMentionItem, ConversationDetail } from "./manager-types";
import type { Conversation } from "../persistence/store";
import type { MessageWithParts } from "../persistence/store";
import { buildMessagePreview } from "./message-parts";

export function buildBossMentionItem(dispatch: { id: number; message_id: number; created_at: string }, message: MessageWithParts | undefined): BossMentionItem {
  return {
    dispatch_id: dispatch.id,
    message_id: dispatch.message_id,
    producer_snail: message?.producer_snail ?? null,
    created_at: dispatch.created_at,
    preview: message ? buildMessagePreview(message) : "",
  };
}

export function buildConversationBadgePayload(conversation: ConversationDetail): { conversation_id: string; stage_id: string; boss_pending_count: number } {
  return {
    conversation_id: conversation.id,
    stage_id: conversation.stage_id,
    boss_pending_count: conversation.boss_pending_count,
  };
}

export function sumBossPendingCount(conversations: Conversation[], getBossPendingCount: (conversationId: string) => number): number {
  return conversations.reduce((sum, conversation) => sum + getBossPendingCount(conversation.id), 0);
}
