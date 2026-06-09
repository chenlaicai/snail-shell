import { describe, it, expect, beforeEach } from "vitest";
import { useConversationStore } from "../stores/conversationStore";

describe("conversationStore (reduced — wsStatus + composerDraft)", () => {
  beforeEach(() => { useConversationStore.getState().clear(); });

  it("starts with correct initial state", () => {
    const s = useConversationStore.getState();
    expect(s.wsStatus).toBe("disconnected");
    expect(s.composerDraft).toBe("");
  });

  it("sets wsStatus", () => {
    useConversationStore.getState().setWsStatus("connected");
    expect(useConversationStore.getState().wsStatus).toBe("connected");
  });

  it("sets composerDraft", () => {
    useConversationStore.getState().setComposerDraft("hello");
    expect(useConversationStore.getState().composerDraft).toBe("hello");
  });

  it("clear resets all state", () => {
    useConversationStore.getState().setWsStatus("connected");
    useConversationStore.getState().setComposerDraft("draft");
    useConversationStore.getState().clear();
    const s = useConversationStore.getState();
    expect(s.wsStatus).toBe("disconnected");
    expect(s.composerDraft).toBe("");
  });
});
