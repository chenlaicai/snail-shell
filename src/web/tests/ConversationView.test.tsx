import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConversationView } from "../pages/ConversationView";
import { useConversationStore } from "../stores/conversationStore";

vi.mock("../services/api", () => ({
  api: vi.fn(),
}));

// Mock scrollIntoView (not available in JSDOM)
Element.prototype.scrollIntoView = vi.fn();

import { api } from "../services/api";
const mockApi = vi.mocked(api);

describe("ConversationView", () => {
  beforeEach(() => {
    mockApi.mockReset();
    useConversationStore.getState().clear();
  });

  it("shows empty state when no conversation selected", () => {
    render(<ConversationView />);
    expect(screen.getByText("选择一个 Conversation")).toBeInTheDocument();
  });

  it("renders messages when conversation exists", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    mockApi.mockResolvedValueOnce({
      messages: [
        { id: "m1", role: "user", content: "Hello", created_at: "2024-01-01T00:00:00Z" },
        { id: "m2", role: "assistant", content: "Hi there", created_at: "2024-01-01T00:00:01Z" },
      ],
    });
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
      expect(screen.getByText("Hi there")).toBeInTheDocument();
    });
  });

  it("shows send button", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    mockApi.mockResolvedValueOnce({ messages: [] });
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText("发送")).toBeInTheDocument();
    });
  });

  it("shows reply button on messages", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    mockApi.mockResolvedValueOnce({
      messages: [{ id: "m1", role: "user", content: "Test msg", created_at: "2024-01-01T00:00:00Z" }],
    });
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText("回复")).toBeInTheDocument();
    });
  });

  it("shows interrupt button when message is streaming", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    useConversationStore.getState().appendMessage({
      id: "m1", role: "assistant", content: "", created_at: "2024-01-01", status: "streaming",
    });
    mockApi.mockResolvedValueOnce({ messages: [] });
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText("中断 Snail")).toBeInTheDocument();
    });
  });

  it("shows websocket status", async () => {
    useConversationStore.getState().setCurrentConversation({ id: "c1", title: "Test", default_role: "dev" });
    useConversationStore.getState().setWsStatus("connected");
    mockApi.mockResolvedValueOnce({ messages: [] });
    render(<ConversationView />);
    await waitFor(() => {
      expect(screen.getByText(/已连接/)).toBeInTheDocument();
    });
  });
});
