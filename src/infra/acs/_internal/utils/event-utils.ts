import type { AgentEvent } from "@infra/acs/model";

export function buildResultTextEvent(text: string, runtimeEventType: string): AgentEvent {
  return {
    type: "message_event",
    event: {
      kind: "text",
      payload: { text, mentions: [] },
      source: { runtime_event_type: runtimeEventType, runtime_message_id: null, runtime_call_id: null },
    },
  };
}
