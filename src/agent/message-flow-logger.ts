import { logger } from "../logger";
import type { AgentMessage, AgentRuntime, SnailRuntimeTurnInput } from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages, buildStatelessMessages } from "./prompt-mapper";
import { formatAgentMessagesForPrompt } from "./log-preview";

function formatMessages(messages: AgentMessage[]): string {
  return formatAgentMessagesForPrompt(messages);
}

export function logAgentInput(
  runtime: AgentRuntime,
  turnInput: SnailRuntimeTurnInput,
  sessionId: string | null,
): void {
  if (runtime === "claude-code-cli") {
    logger.debug("Agent input", {
      conversationId: turnInput.conversation.id,
      snail: turnInput.snail.name,
      runtime,
      mode: "stateless",
      systemPrompt: turnInput.systemPrompts.conversation,
      context: formatMessages(buildStatelessMessages(turnInput)),
    });
    return;
  }

  const statefulInput = {
    sessionId,
    bootstrap: sessionId ? null : buildStatefulBootstrap(turnInput),
    incrementalMessages: buildStatefulIncrementalMessages(turnInput),
  };

  logger.debug("Agent input", {
    conversationId: turnInput.conversation.id,
    snail: turnInput.snail.name,
    runtime,
    mode: "stateful",
    systemPrompt: turnInput.systemPrompts.conversation,
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
