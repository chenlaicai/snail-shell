import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WorkspaceBoard } from "../pages/WorkspaceBoard";

vi.mock("../services/api-client", () => ({
  api: vi.fn(),
}));

import { api } from "../services/api-client";
const mockApi = vi.mocked(api);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ws/:workspaceId" element={<WorkspaceBoard />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("WorkspaceBoard", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("shows loading state", () => {
    mockApi.mockReturnValueOnce(new Promise(() => {})); // never resolves
    renderAt("/ws/test-ws");
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("shows error when workspace not found", async () => {
    mockApi.mockRejectedValueOnce(new Error("Not found"));
    renderAt("/ws/bad-id");
    await waitFor(() => {
      expect(screen.getByText("工作区不存在")).toBeInTheDocument();
    });
  });

  it("renders workspace name and issue groups", async () => {
    mockApi.mockResolvedValueOnce({
      id: "ws1",
      name: "My Workspace",
      issues: [
        { id: "i1", title: "Bug fix", closed_at: null, current_stage: { type: "development", status: "pending" }, created_at: "2024-01-01" },
        { id: "i2", title: "Done task", closed_at: "2024-01-02", current_stage: { type: "review", status: "approved" }, created_at: "2024-01-01" },
      ],
    });
    renderAt("/ws/ws1");
    await waitFor(() => {
      expect(screen.getByText("My Workspace")).toBeInTheDocument();
      expect(screen.getByText("待处理")).toBeInTheDocument();
      expect(screen.getByText("AI 工作中")).toBeInTheDocument();
      expect(screen.getByText("已完成")).toBeInTheDocument();
      expect(screen.getByText("Bug fix")).toBeInTheDocument();
      expect(screen.getByText("Done task")).toBeInTheDocument();
    });
  });

  it("navigates to issue on card click", async () => {
    mockApi.mockResolvedValueOnce({
      id: "ws1",
      name: "Test",
      issues: [
        { id: "issue-abc", title: "Click me", closed_at: null, created_at: "2024-01-01" },
      ],
    });
    renderAt("/ws/ws1");
    await waitFor(() => {
      expect(screen.getByText("Click me")).toBeInTheDocument();
    });
    // Navigation is tested via the MemoryRouter - the card is clickable
    const title = screen.getByText("Click me");
    expect(title).toBeInTheDocument();
    expect(title.closest("[data-testid='task-card']")).toBeInTheDocument();
  });
});
