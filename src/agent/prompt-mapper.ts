import type {
  AgentMessage,
  SnailRuntimeTurnInput,
} from "./interface";
import type { MessageWithParts } from "../persistence/store";
import { joinPartTextByType } from "../project/message-parts";

export function buildStatelessMessages(input: SnailRuntimeTurnInput): AgentMessage[] {
  // Stateless runtimes need Snail Shell to rebuild the exact working context window.
  return [...input.history];
}

export function buildStatefulBootstrap(input: SnailRuntimeTurnInput): { systemPrompt: string; messages: AgentMessage[] } {
  // Stateful runtimes should not receive the newest user turn twice.
  // We bootstrap the session with prior context only, then send the newest user turn
  // separately as the incremental message for this invocation.
  const bootstrapMessages = dropLatestUserMessage(input.history);
  return {
    systemPrompt: input.systemPrompts.conversation,
    messages: bootstrapMessages,
  };
}

export function buildLatestUserMessage(input: SnailRuntimeTurnInput): AgentMessage {
  // The current stateful OpenCode integration only forwards text user parts as the
  // incremental turn payload. If future runtimes need richer incremental payloads,
  // extend this mapper rather than flattening those semantics in collaboration code.
  return {
    role: "user",
    content: joinPartTextByType(input.latestUserParts, ["content"]),
  };
}

export function buildStatefulIncrementalMessages(input: SnailRuntimeTurnInput): AgentMessage[] {
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
      content: `${message.producer_snail ?? "Assistant"}:\n${joinPartTextByType(message.parts, ["content", "system_event"])}`,
    };
  }

  return {
    role: "user",
    content: `USER:\n${joinPartTextByType(message.parts, ["content"])}`,
  };
}
