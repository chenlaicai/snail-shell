import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "../pages/HomePage";

vi.mock("../services/api", () => ({ api: vi.fn() }));

import { api } from "../services/api";
const mockApi = vi.mocked(api);

function renderHome() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>);
}

describe("HomePage", () => {
  beforeEach(() => { mockApi.mockReset(); });

  it("shows loading state", () => {
    mockApi.mockReturnValueOnce(new Promise(() => {}));
    renderHome();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("renders workspace list", async () => {
    mockApi.mockResolvedValueOnce([
      { id: "ws1", name: "My Project", module: "workspace_management", summary: "Test", issue_count: 3, boss_pending_count: 0 },
      { id: "ws2", name: "Another", module: "workspace_management", summary: "Test 2", issue_count: 1, boss_pending_count: 1 },
    ]);
    renderHome();
    await waitFor(() => {
      expect(screen.getByText("My Project")).toBeInTheDocument();
      expect(screen.getByText("Another")).toBeInTheDocument();
      expect(screen.getByText("工作区")).toBeInTheDocument();
    });
  });

  it("shows empty state when no workspaces", async () => {
    mockApi.mockResolvedValueOnce([]);
    renderHome();
    await waitFor(() => {
      expect(screen.getByText("暂无工作区")).toBeInTheDocument();
    });
  });

  it("shows issue count", async () => {
    mockApi.mockResolvedValueOnce([
      { id: "ws1", name: "Project", module: "m", summary: "s", issue_count: 5, boss_pending_count: 0 },
    ]);
    renderHome();
    await waitFor(() => {
      expect(screen.getByText("5 Issues")).toBeInTheDocument();
    });
  });
});
