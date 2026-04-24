import type { StatelessTranscript } from "./interface";

function renderTranscriptRoleLabel(role: "user" | "assistant"): string {
  return role === "assistant" ? "ASSISTANT" : "USER";
}

export function renderStatelessTranscript(transcript: StatelessTranscript): string {
  return transcript.lines
    .map((line) => `## ${renderTranscriptRoleLabel(line.role)}\n${line.content}`)
    .join("\n\n");
}
