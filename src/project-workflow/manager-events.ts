import type { BossMentionItem, ConversationDetail } from "./manager-types";
import type { Conversation } from "../persistence/store";
import type { MessageWithEvents } from "../persistence/store";
import { buildMessagePreview } from "../message-bus/message-events";

export function buildBossMentionItem(dispatch: { id: number; message_id: number; created_at: string }, message: MessageWithEvents | undefined): BossMentionItem {
  return {
    dispatch_id: dispatch.id,
    message_id: dispatch.message_id,
    from_snail: message?.from_snail ?? null,
    created_at: dispatch.created_at,
    preview: message ? buildMessagePreview(message) : "",
  };
}

export function buildConversationBadgePayload(conversation: ConversationDetail): { conversation_id: string; feature_id: string | null; stage_id: string | null; boss_pending_count: number } {
  return {
    conversation_id: conversation.id,
    feature_id: conversation.feature_id,
    stage_id: conversation.stage_id,
    boss_pending_count: conversation.boss_pending_count,
  };
}

export function sumBossPendingCount(conversations: Conversation[], getBossPendingCount: (conversationId: string) => number): number {
  return conversations.reduce((sum, conversation) => sum + getBossPendingCount(conversation.id), 0);
}
