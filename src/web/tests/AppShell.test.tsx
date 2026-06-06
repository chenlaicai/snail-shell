import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "../layouts/AppShell";

vi.mock("../services/api-client", () => ({
  api: vi.fn().mockResolvedValue([]),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>
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
    const navBtn = navBtns.find((el) => el.classList.contains("primary-nav-button"));
    expect(navBtn).toHaveClass("active");
  });

  it("highlights active nav for evolution", () => {
    renderAt("/evolution");
    const evolutionBtn = screen.getByText("Evolution Center");
    expect(evolutionBtn).toHaveClass("active");
  });

  it("renders sidebar with workspace tree on workspace pages", () => {
    renderAt("/ws/test");
    expect(screen.getByText("新建")).toBeInTheDocument();
  });

  it("sets data-primary-view attribute", () => {
    renderAt("/evolution");
    const appShell = document.querySelector(".app-shell");
    expect(appShell).toHaveAttribute("data-primary-view", "evolution");
  });

  it("sets data-workspace-view for board", () => {
    renderAt("/ws/test");
    const appShell = document.querySelector(".app-shell");
    expect(appShell).toHaveAttribute("data-workspace-view", "board");
  });

  it("sets data-workspace-view for conversation", () => {
    renderAt("/ws/test/issue/abc");
    const appShell = document.querySelector(".app-shell");
    expect(appShell).toHaveAttribute("data-workspace-view", "conversation");
  });
});
