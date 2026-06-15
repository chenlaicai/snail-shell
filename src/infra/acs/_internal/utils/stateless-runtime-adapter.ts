import type { Message } from "@infra/acs/model";

interface StatelessTranscriptEntry {
  role: Message["role"];
  content: string;
}

interface StatelessTranscriptPayload {
  type: "snail_shell_stateless_transcript";
  messages: StatelessTranscriptEntry[];
}

export function renderStatelessTranscript(messages: Message[]): string {
  const payload: StatelessTranscriptPayload = {
    type: "snail_shell_stateless_transcript",
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };

  return JSON.stringify(payload, null, 2);
}
