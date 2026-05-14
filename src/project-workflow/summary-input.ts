import type { Conversation, ConversationStore, MessageWithEvents } from "../persistence/store";
import type { ConversationSummaryGenerator } from "../llm";
import { logger } from "../logger";
import type { SummaryGenerationInput } from "./manager-types";

export function buildSummaryGenerationInput(conversation: Conversation, recentMessages: MessageWithEvents[]): SummaryGenerationInput {
  return {
    conversation,
    previousSummary: conversation.summary?.trim() ?? "",
    recentMessages,
  };
}

export async function refreshConversationSummary(input: { store: ConversationStore; summaryGenerator: ConversationSummaryGenerator; conversationId: string }): Promise<void> {
  const conversation = input.store.getConversation(input.conversationId);
  if (!conversation) return;
  const recentMessages = input.store.getRecentMessages(input.conversationId, 8).filter((message) => message.role === "user" || message.role === "assistant");
  const summaryInput = buildSummaryGenerationInput(conversation, recentMessages);

  let nextSummary: string;
  try {
    nextSummary = await generateConversationSummary(input.summaryGenerator, summaryInput);
  } catch (error) {
    logger.warn("Conversation summary refresh fell back after generation failure", { conversationId: input.conversationId, error: error instanceof Error ? error.message : String(error), fallback: "keeping_existing_summary", failed_step: "generation" });
    return;
  }

  try {
    input.store.updateConversation(input.conversationId, { summary: nextSummary });
  } catch (error) {
    logger.error("Conversation summary persistence failed", { conversationId: input.conversationId, error: error instanceof Error ? error.message : String(error), fallback: "keeping_existing_summary", failed_step: "persistence" });
  }
}

async function generateConversationSummary(summaryGenerator: ConversationSummaryGenerator, input: SummaryGenerationInput): Promise<string> {
  try {
    return await summaryGenerator.generateConversationSummary({
      conversation: { title: input.conversation.title, kind: input.conversation.kind },
      previousSummary: input.previousSummary,
      recentMessages: input.recentMessages,
    });
  } catch (error) {
    logger.error("Conversation summary generation failed", { conversationId: input.conversation.id, title: input.conversation.title, kind: input.conversation.kind, recentMessageCount: input.recentMessages.length, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
