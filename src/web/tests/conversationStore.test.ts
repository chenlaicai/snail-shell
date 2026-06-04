import { describe, it, expect, beforeEach } from "vitest";
import { useConversationStore } from "../stores/conversationStore";

describe("conversationStore", () => {
  beforeEach(() => {
    useConversationStore.getState().clear();
  });

  it("starts with empty state", () => {
    const state = useConversationStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.currentStage).toBeNull();
    expect(state.currentConversation).toBeNull();
    expect(state.wsStatus).toBe("disconnected");
  });

  it("sets current stage", () => {
    const stage = { id: "s1", type: "development", status: "in_progress" };
    useConversationStore.getState().setCurrentStage(stage);
    expect(useConversationStore.getState().currentStage).toEqual(stage);
  });

  it("sets current conversation", () => {
    const conv = { id: "c1", title: "test", default_role: "developer" };
    useConversationStore.getState().setCurrentConversation(conv);
    expect(useConversationStore.getState().currentConversation).toEqual(conv);
  });

  it("appends messages", () => {
    const msg1 = { id: "m1", role: "user", content: "hello", created_at: "2024-01-01" };
    const msg2 = { id: "m2", role: "assistant", content: "hi", created_at: "2024-01-01" };
    const store = useConversationStore.getState();
    store.appendMessage(msg1);
    store.appendMessage(msg2);
    expect(useConversationStore.getState().messages).toEqual([msg1, msg2]);
  });

  it("updates message by id", () => {
    const msg = { id: "m1", role: "assistant", content: "", created_at: "2024-01-01", status: "streaming" };
    useConversationStore.getState().appendMessage(msg);
    useConversationStore.getState().updateMessage("m1", { content: "hello world", status: "done" });
    const updated = useConversationStore.getState().messages[0];
    expect(updated.content).toBe("hello world");
    expect(updated.status).toBe("done");
  });

  it("sets messages in bulk", () => {
    const messages = [
      { id: "m1", role: "user", content: "a", created_at: "2024-01-01" },
      { id: "m2", role: "assistant", content: "b", created_at: "2024-01-01" },
    ];
    useConversationStore.getState().setMessages(messages);
    expect(useConversationStore.getState().messages).toEqual(messages);
  });

  it("clears all state", () => {
    const store = useConversationStore.getState();
    store.appendMessage({ id: "m1", role: "user", content: "a", created_at: "2024-01-01" });
    store.setCurrentStage({ id: "s1", type: "dev", status: "active" });
    store.setCurrentConversation({ id: "c1", title: "t", default_role: "r" });
    store.setWsStatus("connected");
    store.clear();
    const state = useConversationStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.currentStage).toBeNull();
    expect(state.currentConversation).toBeNull();
  });

  it("sets websocket status", () => {
    useConversationStore.getState().setWsStatus("connected");
    expect(useConversationStore.getState().wsStatus).toBe("connected");
    useConversationStore.getState().setWsStatus("reconnecting");
    expect(useConversationStore.getState().wsStatus).toBe("reconnecting");
  });
});
