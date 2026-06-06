import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StageActions } from "../components/StageActions";

vi.mock("../services/api-client", () => ({ api: vi.fn() }));
vi.mock("../components/Toast", () => ({ showToast: vi.fn() }));

const mockIssue = { id: "i1", title: "Test Issue" };
const mockStage = { id: "s1", type: "development", status: "in_progress", stage_definition: { title: "Development" } };

describe("StageActions", () => {
  it("renders nothing when no stage", () => {
    const { container } = render(
      <StageActions issue={mockIssue} currentStage={null} transitions={[]} onStageChanged={() => {}} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when issue is closed", () => {
    const closedIssue = { ...mockIssue, closed_at: "2024-01-01" };
    const { container } = render(
      <StageActions issue={closedIssue} currentStage={mockStage} transitions={[]} onStageChanged={() => {}} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders advance button", () => {
    render(
      <StageActions issue={mockIssue} currentStage={mockStage} transitions={[]} onStageChanged={() => {}} />
    );
    expect(screen.getByText("推进阶段")).toBeInTheDocument();
  });

  it("disables advance when no transitions", () => {
    render(
      <StageActions issue={mockIssue} currentStage={mockStage} transitions={[]} onStageChanged={() => {}} />
    );
    expect(screen.getByText("推进阶段")).toBeDisabled();
  });

  it("enables advance when forward transitions exist", () => {
    const transitions = [{ from_stage_key: "development", to_stage_key: "review" }];
    render(
      <StageActions issue={mockIssue} currentStage={mockStage} transitions={transitions} onStageChanged={() => {}} />
    );
    expect(screen.getByText("推进阶段")).not.toBeDisabled();
  });

  it("shows target selector when multiple forward transitions", () => {
    const transitions = [
      { from_stage_key: "development", to_stage_key: "review" },
      { from_stage_key: "development", to_stage_key: "testing" },
    ];
    render(
      <StageActions issue={mockIssue} currentStage={mockStage} transitions={transitions} onStageChanged={() => {}} />
    );
    expect(screen.getByText("选择目标阶段")).toBeInTheDocument();
  });
});
