import type { AgentMessage } from "./interface";

interface StatelessTranscriptEntry {
  role: AgentMessage["role"];
  content: string;
}

interface StatelessTranscriptPayload {
  type: "snail_shell_stateless_transcript";
  messages: StatelessTranscriptEntry[];
}

export function renderStatelessTranscript(messages: AgentMessage[]): string {
  const payload: StatelessTranscriptPayload = {
    type: "snail_shell_stateless_transcript",
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };

  return JSON.stringify(payload, null, 2);
}
