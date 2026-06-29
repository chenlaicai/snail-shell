import type { Message, MessageContext, MessageEventPayload } from "@domain/message/model";
import type { AgentEvent, Message as AgentMessage } from "@infra/acs/model";

export interface MessageHandlerDeps {
  getContext(messageId: number): MessageContext | null;
}

export class MessageHandler {
  constructor(private readonly deps: MessageHandlerDeps) {}

  toAgentMessage(message: Message): AgentMessage {
    const context = this.deps.getContext(message.id);
    const prefix = message.to_speakers.length > 0 ? `${message.to_speakers.map(target => `@${target}`).join(" ")} ` : "";
    return {
      role: message.from_speaker === "user" ? "human" : message.from_speaker === "system" || message.from_speaker === null ? "system" : "agent",
      speaker: message.from_speaker ?? "system",
      content: `${prefix}${context?.context ?? ""}`.trim(),
    };
  }

  mapAgentEvent(event: AgentEvent): MessageEventPayload {
    const agentEvent = event.event;
    if (agentEvent.kind === "text") {
      return { type: "text", text: agentEvent.payload.text };
    }
    if (agentEvent.kind === "tool_call") {
      return { type: "tool_call", tool_name: agentEvent.payload.tool_name, tool_input: agentEvent.payload.input };
    }
    if (agentEvent.kind === "tool_result") {
      return { type: "tool_result", tool_name: "tool", result: agentEvent.payload.output };
    }
    if (agentEvent.kind === "signal") {
      const data = typeof agentEvent.payload.data === "object" && agentEvent.payload.data ? agentEvent.payload.data as Record<string, unknown> : {};
      return { type: "signal", signal: agentEvent.payload.signal_type, ...data };
    }
    if (agentEvent.kind === "error") {
      return { type: "error", error: agentEvent.payload.message };
    }
    return { type: "error", error: agentEvent.payload.error };
  }
}
