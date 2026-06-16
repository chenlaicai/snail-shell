import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationLayout } from "../pages/ConversationLayout";

vi.mock("../services/api-client", () => ({
  api: vi.fn(),
}));

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: vi.fn(),
}));

import { api } from "../services/api-client";
const mockApi = vi.mocked(api);

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ws/:workspaceId/issue/:issueId" element={<ConversationLayout />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ConversationLayout", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue([]); // default: return empty
  });

  it("shows loading state", () => {
    mockApi.mockReturnValueOnce(new Promise(() => {}));
    renderAt("/ws/ws1/issue/i1");
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("shows error when issue not found", async () => {
    mockApi.mockRejectedValueOnce(new Error("Not found"));
    renderAt("/ws/ws1/issue/bad");
    await waitFor(() => {
      expect(screen.getByText("Issue 不存在")).toBeInTheDocument();
    });
  });

  it("renders issue title and stage tabs", async () => {
    const issueData = {
      id: "i1",
      title: "Fix login bug",
      stages: [
        { id: "s1", type: "development", status: "in_progress", stage_definition: { title: "Development" } },
        { id: "s2", type: "review", status: "pending", stage_definition: { title: "Review" } },
      ],
      current_stage: { id: "s1", type: "development", status: "in_progress", stage_definition: { title: "Development" } },
    };
    mockApi.mockImplementation((endpoint: string) => {
      if (endpoint === "GET /api/issues/:issueId") return Promise.resolve(issueData);
      if (endpoint === "GET /api/stages/:stageId/conversations") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    renderAt("/ws/ws1/issue/i1");
    await waitFor(() => {
      expect(screen.getAllByText("Fix login bug").length).toBeGreaterThan(0);
      expect(screen.getByText("Development")).toBeInTheDocument();
      expect(screen.getByText("Review")).toBeInTheDocument();
    });
  });

  it("renders conversation breadcrumb", async () => {
    const issueData = {
      id: "i1",
      title: "My Issue",
      stages: [
        { id: "s1", type: "design", status: "in_progress", stage_definition: { title: "Design" } },
      ],
      current_stage: { id: "s1", type: "design", status: "in_progress", stage_definition: { title: "Design" } },
    };
    mockApi.mockImplementation((endpoint: string) => {
      if (endpoint === "GET /api/issues/:issueId") return Promise.resolve(issueData);
      if (endpoint === "GET /api/stages/:stageId/conversations") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    renderAt("/ws/my-workspace/issue/i1");
    await waitFor(() => {
      const breadcrumbEl = screen.getByText(/my-workspace/);
      expect(breadcrumbEl.textContent).toContain("My Issue");
    });
  });
});
