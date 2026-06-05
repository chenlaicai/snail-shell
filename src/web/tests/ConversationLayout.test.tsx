import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConversationLayout } from "../pages/ConversationLayout";

vi.mock("../services/api", () => ({
  api: vi.fn(),
}));

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: vi.fn(),
}));

import { api } from "../services/api";
const mockApi = vi.mocked(api);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ws/:workspaceId/issue/:issueId" element={<ConversationLayout />} />
      </Routes>
    </MemoryRouter>
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
    mockApi.mockResolvedValueOnce({
      id: "i1",
      title: "Fix login bug",
      stages: [
        { id: "s1", type: "development", status: "in_progress", stage_definition: { title: "Development" } },
        { id: "s2", type: "review", status: "pending", stage_definition: { title: "Review" } },
      ],
      current_stage: { id: "s1", type: "development", status: "in_progress", stage_definition: { title: "Development" } },
    });
    mockApi.mockResolvedValueOnce([]); // conversations
    mockApi.mockResolvedValueOnce([]); // boss-mentions
    renderAt("/ws/ws1/issue/i1");
    await waitFor(() => {
      const title = document.querySelector(".conv-title");
      expect(title?.textContent).toBe("Fix login bug");
      expect(screen.getByText("Development")).toBeInTheDocument();
      expect(screen.getByText("Review")).toBeInTheDocument();
    });
  });

  it("renders conversation breadcrumb", async () => {
    mockApi.mockResolvedValueOnce({
      id: "i1",
      title: "My Issue",
      stages: [
        { id: "s1", type: "design", status: "in_progress", stage_definition: { title: "Design" } },
      ],
      current_stage: { id: "s1", type: "design", status: "in_progress", stage_definition: { title: "Design" } },
    });
    mockApi.mockResolvedValueOnce([]);
    mockApi.mockResolvedValueOnce([]);
    renderAt("/ws/my-workspace/issue/i1");
    await waitFor(() => {
      const breadcrumb = document.querySelector(".conv-breadcrumb");
      expect(breadcrumb?.textContent).toContain("my-workspace");
      expect(breadcrumb?.textContent).toContain("My Issue");
    });
  });
});
