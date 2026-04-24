import type {
  AgentMessage,
  SnailRuntimeMessageInput,
  StatelessTranscript,
} from "./interface";
import type { MessageWithParts } from "../persistence/store";
import { getPrimaryMessageText, getResultContent, getResultContentFromInputs } from "../project/message-parts";

export function buildStatelessMessages(input: SnailRuntimeMessageInput): AgentMessage[] {
  // Stateless runtimes need Snail Shell to rebuild the exact working context window.
  return [...input.history];
}

export function buildStatelessTranscript(input: SnailRuntimeMessageInput): StatelessTranscript {
  return {
    lines: buildStatelessMessages(input).map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
}

export function buildStatefulBootstrap(input: SnailRuntimeMessageInput): { systemPrompt: string; messages: AgentMessage[] } {
  // Stateful runtimes should not receive the newest user message twice.
  // We bootstrap the session with prior context only, then send the newest user message
  // separately as the incremental message for this invocation.
  const bootstrapMessages = dropLatestUserMessage(input.history);
  return {
    systemPrompt: input.systemPrompts.conversation,
    messages: bootstrapMessages,
  };
}

export function buildLatestUserMessage(input: SnailRuntimeMessageInput): AgentMessage {
  // The current stateful OpenCode integration only forwards text user parts as the
  // incremental message payload. If future runtimes need richer incremental payloads,
  // extend this mapper rather than flattening those semantics in collaboration code.
  return {
    role: "user",
    content: getResultContentFromInputs(input.latestUserParts),
  };
}

export function buildStatefulIncrementalMessages(input: SnailRuntimeMessageInput): AgentMessage[] {
  // Stateful runtimes should receive every conversation message that happened since
  // this specific snail last replied, not only the newest user text. Otherwise the
  // runtime misses work done by the user or by other snails between two turns.
  return input.incrementalMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => mapIncrementalMessage(message));
}

function dropLatestUserMessage(history: AgentMessage[]): AgentMessage[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "user") {
      return history.filter((_, candidateIndex) => candidateIndex !== index);
    }
  }

  return [...history];
}

function mapIncrementalMessage(message: MessageWithParts): AgentMessage {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: `${message.from_snail ?? "Assistant"}:\n${getPrimaryMessageText(message)}`,
    };
  }

  return {
    role: "user",
    content: `USER:\n${getResultContent(message)}`,
  };
}
