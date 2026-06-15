import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationView } from "../pages/ConversationView";
import { useConversationStore } from "../stores/conversationStore";
import { queryKeys } from "../queries/keys";
import type { MessageDto } from "../types";

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

function message(overrides: Partial<MessageDto>): MessageDto {
  return {
    id: 1,
    stage_id: "s1",
    conversation_id: "s1",
    from_speaker: null,
    from_role: null,
    to_speakers: [],
    to_roles: [],
    role: "user",
    status: "completed",
    created_at: "2024-01-01T00:00:00Z",
    ended_at: null,
    updated_at: "2024-01-01T00:00:00Z",
    context: null,
    events: [],
    ...overrides,
  };
}

describe("ConversationView", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue([]);
    useConversationStore.getState().clear();
    queryClient = createQueryClient();
  });

  it("shows empty state when no stage selected", () => {
    renderWithProviders(<ConversationView stageId={null} />, queryClient);
    expect(screen.getByText("选择一个 Stage")).toBeInTheDocument();
  });

  it("renders messages when stage exists", async () => {
    queryClient.setQueryData(queryKeys.stages.messages("s1"), [
      message({ id: 1, role: "user", from_role: "用户", content: "Hello" }),
      message({ id: 2, role: "assistant", from_role: "AI", content: "Hi there", created_at: "2024-01-01T00:00:01Z" }),
    ]);
    renderWithProviders(<ConversationView stageId="s1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
      expect(screen.getByText("Hi there")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows send button", async () => {
    renderWithProviders(<ConversationView stageId="s1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText("发送")).toBeInTheDocument();
    });
  });

  it("shows reply button on messages", async () => {
    queryClient.setQueryData(queryKeys.stages.messages("s1"), [
      message({ id: 1, role: "user", from_role: "用户", content: "Test msg" }),
    ]);
    renderWithProviders(<ConversationView stageId="s1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText("回复")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows interrupt button when message is streaming", async () => {
    queryClient.setQueryData(queryKeys.stages.messages("s1"), [
      message({ id: 1, role: "assistant", from_role: "AI", content: "", status: "streaming" }),
    ]);
    renderWithProviders(<ConversationView stageId="s1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText("中断 Snail")).toBeInTheDocument();
    });
  });

  it("shows websocket status", async () => {
    useConversationStore.getState().setWsStatus("connected");
    renderWithProviders(<ConversationView stageId="s1" />, queryClient);
    await waitFor(() => {
      expect(screen.getByText(/已连接/)).toBeInTheDocument();
    });
  });
});
