import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ConversationView } from "../pages/ConversationView";
import { useConversationStore } from "../stores/conversationStore";

vi.mock("../services/api", () => ({
  api: vi.fn().mockResolvedValue([]),
}));

// Mock scrollIntoView (not available in JSDOM)
Element.prototype.scrollIntoView = vi.fn();

import { api } from "../services/api";
const mockApi = vi.mocked(api);

describe("ConversationView", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue([]); // default: return empty array
    useConversationStore.getState().clear();
  });

  it("shows empty state when no conversation selected", () => {
    render(<ConversationView />);
    expect(screen.getByText("选择一个 Conversation")).toBeInTheDocument();
  });

  it("renders messages when conversation exists", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    mockApi.mockResolvedValue({
      messages: [
        { id: 1, role: "user", from_role: "用户", events: [{ category: "content", kind: "text", payload: { text: "Hello" } }], created_at: "2024-01-01T00:00:00Z" },
        { id: 2, role: "assistant", from_role: "AI", events: [{ category: "content", kind: "text", payload: { text: "Hi there" } }], created_at: "2024-01-01T00:00:01Z" },
      ],
    });
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
      expect(screen.getByText("Hi there")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows send button", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText("发送")).toBeInTheDocument();
    });
  });

  it("shows reply button on messages", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    mockApi.mockResolvedValue({
      messages: [{ id: 1, role: "user", from_role: "用户", events: [{ category: "content", kind: "text", payload: { text: "Test msg" } }], created_at: "2024-01-01T00:00:00Z" }],
    });
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText("回复")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows interrupt button when message is streaming", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    useConversationStore.getState().appendMessage({
      id: 1, role: "assistant", from_role: "AI", content: "", created_at: "2024-01-01", status: "streaming",
    });
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText("中断 Snail")).toBeInTheDocument();
    });
  });

  it("shows websocket status", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    useConversationStore.getState().setWsStatus("connected");
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText(/已连接/)).toBeInTheDocument();
    });
  });
});
