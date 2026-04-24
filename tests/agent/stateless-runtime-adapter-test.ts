import { renderStatelessTranscript } from "../../src/agent/stateless-runtime-adapter";
import type { StatelessTranscript } from "../../src/agent/interface";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testRenderStatelessTranscript(): void {
  const transcript: StatelessTranscript = {
    lines: [
      { role: "assistant", content: "Conversation summary:\nsummary block" },
      { role: "user", content: "USER:\nhello" },
      { role: "assistant", content: "Owner Snail:\nworld" },
    ],
  };

  const rendered = renderStatelessTranscript(transcript);
  assert(rendered.includes("## ASSISTANT\nConversation summary:\nsummary block"), "assistant sections should be explicitly labeled");
  assert(rendered.includes("## USER\nUSER:\nhello"), "user sections should be explicitly labeled");
  assert(rendered.includes("## ASSISTANT\nOwner Snail:\nworld"), "later assistant sections should be preserved");
  assert(rendered.split("## ").length === 4, "transcript should render one explicit section per line");
  console.log("✓ testRenderStatelessTranscript passed");
}

testRenderStatelessTranscript();
