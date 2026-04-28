import { logger } from "../logger";
import type { AgentMessage, AgentRuntime, SnailRuntimeMessageInput } from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages, buildStatelessMessages } from "./prompt-mapper";
import { formatAgentMessagesForPrompt } from "./log-preview";
import { renderStatelessTranscript } from "./stateless-runtime-adapter";

function formatMessages(messages: AgentMessage[]): string {
  return formatAgentMessagesForPrompt(messages);
}

function formatLogSection(title: string, content: string): string {
  const body = content.trimEnd();
  return body ? `\n--- ${title} ---\n${body}` : `\n--- ${title} ---\n(empty)`;
}

export function logAgentInput(
  runtime: AgentRuntime,
  messageInput: SnailRuntimeMessageInput,
  sessionId: string | null,
): void {
  if (runtime === "claude-code-cli") {
    const statelessMessages = buildStatelessMessages(messageInput);
    logger.debug(formatLogSection("Agent input", renderStatelessTranscript(statelessMessages)), {
      conversationId: messageInput.conversation.id,
      snail: messageInput.snail.name,
      runtime,
      mode: "stateless",
      statelessMessageCount: statelessMessages.length,
      systemPrompt: formatLogSection("System prompt", messageInput.systemPrompts.conversation),
    });
    return;
  }

  const statefulInput = {
    sessionId,
    bootstrap: sessionId ? null : buildStatefulBootstrap(messageInput),
    incrementalMessages: buildStatefulIncrementalMessages(messageInput),
  };

  logger.debug(formatLogSection("Agent input", formatMessages(statefulInput.incrementalMessages)), {
    conversationId: messageInput.conversation.id,
    snail: messageInput.snail.name,
    runtime,
    mode: "stateful",
    systemPrompt: formatLogSection("System prompt", messageInput.systemPrompts.conversation),
    bootstrapContext: statefulInput.bootstrap ? formatLogSection("Bootstrap context", formatMessages(statefulInput.bootstrap.messages)) : "",
  });
}

export function logAgentOutput(input: {
  conversationId: string;
  snail: string;
  runtime: AgentRuntime;
  sequence: number;
  content: string;
}): void {
  logger.debug(formatLogSection("Agent output", input.content), {
    conversationId: input.conversationId,
    snail: input.snail,
    runtime: input.runtime,
    sequence: input.sequence,
  });
}
