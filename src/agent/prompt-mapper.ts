import type {
  AgentMessage,
  SnailRuntimeMessageInput,
} from "./interface";
import type { MessageWithEvents } from "../persistence/store";
import { getInputContent } from "../project/message-events";
import { formatMessageContextForPrompt } from "../project/message-context";

export function buildStatelessMessages(input: SnailRuntimeMessageInput): AgentMessage[] {
  // Stateless runtimes need Snail Shell to rebuild the exact working context window.
  return [...input.history];
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
  // The current stateful OpenCode integration only forwards text user events as the
  // incremental message payload. If future runtimes need richer incremental payloads,
  // extend this mapper rather than flattening those semantics in collaboration code.
  return {
    role: "user",
    content: getInputContent(input.latestUserEvents as any),
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

function mapIncrementalMessage(message: MessageWithEvents): AgentMessage {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: `${message.from_snail ?? "Assistant"}:\n${formatMessageContextForPrompt(message)}`,
    };
  }

  return {
    role: "user",
    content: `USER:\n${formatMessageContextForPrompt(message)}`,
  };
}
