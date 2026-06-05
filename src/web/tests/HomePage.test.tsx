import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "../pages/HomePage";

vi.mock("../services/api", () => ({ api: vi.fn() }));

function renderHome() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>);
}

describe("HomePage", () => {
  it("renders welcome page", () => {
    renderHome();
    expect(screen.getByText("欢迎使用 Snail Shell")).toBeInTheDocument();
  });

  it("renders navigation buttons", () => {
    renderHome();
    expect(screen.getByText("进入工作区")).toBeInTheDocument();
    expect(screen.getByText("新建工作区")).toBeInTheDocument();
  });

  it("renders welcome description", () => {
    renderHome();
    expect(screen.getByText(/Snail Shell 是一个 AI 协作平台/)).toBeInTheDocument();
  });
});
