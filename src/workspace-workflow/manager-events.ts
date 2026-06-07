import type { BossMentionItem, ConversationDetail, Conversation, MessageWithEvents } from "../shared/types";
import { buildMessagePreview } from "../message-bus/message-events";

export function buildBossMentionItem(dispatch: { id: number; message_id: number; created_at: string }, message: MessageWithEvents | undefined): BossMentionItem {
  return {
    dispatch_id: dispatch.id,
    message_id: dispatch.message_id,
    from_role: message?.from_role ?? null,
    created_at: dispatch.created_at,
    preview: message ? buildMessagePreview(message) : "",
  };
}

export function buildConversationBadgePayload(conversation: ConversationDetail): { conversation_id: string; issue_id: string | null; stage_id: string | null; boss_pending_count: number } {
  return {
    conversation_id: conversation.id,
    issue_id: conversation.issue_id,
    stage_id: conversation.stage_id,
    boss_pending_count: conversation.boss_pending_count,
  };
}

export function sumBossPendingCount(conversations: Conversation[], getBossPendingCount: (conversationId: string) => number): number {
  return conversations.reduce((sum, conversation) => sum + getBossPendingCount(conversation.id), 0);
}
