import { logger } from "../logger";
import type { AgentMessage, AgentRuntime, SnailRuntimeMessageInput } from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages, buildStatelessMessages } from "./prompt-mapper";
import { formatAgentMessagesForPrompt } from "./log-preview";

function formatMessages(messages: AgentMessage[]): string {
  return formatAgentMessagesForPrompt(messages);
}

export function logAgentInput(
  runtime: AgentRuntime,
  messageInput: SnailRuntimeMessageInput,
  sessionId: string | null,
): void {
  if (runtime === "claude-code-cli") {
    logger.debug("Agent input", {
      conversationId: messageInput.conversation.id,
      snail: messageInput.snail.name,
      runtime,
      mode: "stateless",
      systemPrompt: messageInput.systemPrompts.conversation,
      context: formatMessages(buildStatelessMessages(messageInput)),
    });
    return;
  }

  const statefulInput = {
    sessionId,
    bootstrap: sessionId ? null : buildStatefulBootstrap(messageInput),
    incrementalMessages: buildStatefulIncrementalMessages(messageInput),
  };

  logger.debug("Agent input", {
    conversationId: messageInput.conversation.id,
    snail: messageInput.snail.name,
    runtime,
    mode: "stateful",
    systemPrompt: messageInput.systemPrompts.conversation,
    bootstrapContext: statefulInput.bootstrap ? formatMessages(statefulInput.bootstrap.messages) : "",
    incrementalContext: formatMessages(statefulInput.incrementalMessages),
  });
}

export function logAgentOutput(input: {
  conversationId: string;
  snail: string;
  runtime: AgentRuntime;
  sequence: number;
  content: string;
}): void {
  logger.debug("Agent output", {
    conversationId: input.conversationId,
    snail: input.snail,
    runtime: input.runtime,
    sequence: input.sequence,
    content: input.content,
  });
}
