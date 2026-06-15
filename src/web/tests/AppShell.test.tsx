import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "../layouts/AppShell";

vi.mock("../services/api-client", () => ({
  api: vi.fn().mockResolvedValue([]),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AppShell", () => {
  it("renders brand bar", () => {
    renderAt("/");
    expect(screen.getByText("Shell")).toBeInTheDocument();
  });

  it("renders navigation items", () => {
    renderAt("/");
    expect(screen.getAllByText("Workspaces").length).toBeGreaterThan(0);
    expect(screen.getByText("Evolution Center")).toBeInTheDocument();
    expect(screen.getByText("知识库")).toBeInTheDocument();
  });

  it("highlights active nav for workspace pages", () => {
    renderAt("/ws/test");
    const navBtns = screen.getAllByText("Workspaces");
    const navBtn = navBtns.find((el) => el.getAttribute("aria-current") === "page");
    expect(navBtn).toBeTruthy();
  });

  it("highlights active nav for evolution", () => {
    renderAt("/evolution");
    const evolutionBtn = screen.getByText("Evolution Center");
    expect(evolutionBtn).toHaveAttribute("aria-current", "page");
  });

  it("renders sidebar with workspace tree on workspace pages", () => {
    renderAt("/ws/test");
    expect(screen.getByText("新建")).toBeInTheDocument();
  });

  it("sets data-primary-view attribute", () => {
    renderAt("/evolution");
    const appShell = document.querySelector("[data-primary-view]");
    expect(appShell).toHaveAttribute("data-primary-view", "evolution");
  });

  it("sets data-workspace-view for board", () => {
    renderAt("/ws/test");
    const appShell = document.querySelector("[data-workspace-view]");
    expect(appShell).toHaveAttribute("data-workspace-view", "board");
  });

  it("sets data-workspace-view for conversation", () => {
    renderAt("/ws/test/issue/abc");
    const appShell = document.querySelector("[data-workspace-view]");
    expect(appShell).toHaveAttribute("data-workspace-view", "conversation");
  });
});
