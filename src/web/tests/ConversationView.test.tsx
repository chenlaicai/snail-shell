import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationView } from "../pages/ConversationView";
import { useConversationStore } from "../stores/conversationStore";
import { queryKeys } from "../queries/keys";

vi.mock("../services/api-client", () => ({
  api: vi.fn().mockResolvedValue([]),
}));

// Mock scrollIntoView (not available in JSDOM)
Element.prototype.scrollIntoView = vi.fn();

import { api } from "../services/api-client";
const mockApi = vi.mocked(api);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderWithProviders(ui: React.ReactNode, queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("ConversationView", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue([]);
    useConversationStore.getState().clear();
    queryClient = createQueryClient();
  });

  it("shows empty state when no conversation selected", () => {
    renderWithProviders(<ConversationView conversationId={null} />, queryClient);
    expect(screen.getByText("选择一个 Conversation")).toBeInTheDocument();
  });

  it("renders messages when conversation exists", async () => {
    queryClient.setQueryData(queryKeys.conversations.messages("c1"), [
      { id: 1, role: "user", from_role: "用户", events: [{ category: "content", kind: "text", payload: { text: "Hello" } }], created_at: "2024-01-01T00:00:00Z" },
      { id: 2, role: "assistant", from_role: "AI", events: [{ category: "content", kind: "text", payload: { text: "Hi there" } }], created_at: "2024-01-01T00:00:01Z" },
    ]);
    renderWithProviders(<ConversationView conversationId="c1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
      expect(screen.getByText("Hi there")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows send button", async () => {
    renderWithProviders(<ConversationView conversationId="c1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText("发送")).toBeInTheDocument();
    });
  });

  it("shows reply button on messages", async () => {
    queryClient.setQueryData(queryKeys.conversations.messages("c1"), [
      { id: 1, role: "user", from_role: "用户", events: [{ category: "content", kind: "text", payload: { text: "Test msg" } }], created_at: "2024-01-01T00:00:00Z" },
    ]);
    renderWithProviders(<ConversationView conversationId="c1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText("回复")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows interrupt button when message is streaming", async () => {
    queryClient.setQueryData(queryKeys.conversations.messages("c1"), [
      { id: 1, role: "assistant", from_role: "AI", content: "", created_at: "2024-01-01", status: "streaming", events: [{ category: "content", kind: "text", payload: { text: "" } }] },
    ]);
    renderWithProviders(<ConversationView conversationId="c1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText("中断 Snail")).toBeInTheDocument();
    });
  });

  it("shows websocket status", async () => {
    useConversationStore.getState().setWsStatus("connected");
    renderWithProviders(<ConversationView conversationId="c1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText(/已连接/)).toBeInTheDocument();
    });
  });
});
