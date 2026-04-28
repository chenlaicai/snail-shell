export function isCurrentConversationEvent(message, socketConversationId, currentConversationId) {
  if (!currentConversationId || currentConversationId !== socketConversationId) return false;
  const eventConversationId = message?.conversation_id || message?.event?.conversation_id || null;
  return !eventConversationId || eventConversationId === currentConversationId;
}
