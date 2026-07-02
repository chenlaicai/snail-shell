import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloseIssueDialog } from "../CloseIssueDialog";

// Mock the native dialog methods
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

describe("CloseIssueDialog", () => {
  it("renders with correct title and message", () => {
    render(
      <CloseIssueDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} closing={false} />
    );

    // Title and message are visible
    expect(screen.getByText("确认关闭此 Issue？关闭后对话保留为只读")).toBeInTheDocument();
    // Buttons are present
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    // "Close Issue" appears twice: once as title (h3) and once as button text
    expect(screen.getAllByText("Close Issue")).toHaveLength(2);
  });

  it("calls onConfirm when Close Issue button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <CloseIssueDialog open={true} onClose={vi.fn()} onConfirm={onConfirm} closing={false} />
    );

    // Get the button (second occurrence of "Close Issue")
    const buttons = screen.getAllByText("Close Issue");
    fireEvent.click(buttons[1]);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Cancel button is clicked", () => {
    const onClose = vi.fn();
    render(
      <CloseIssueDialog open={true} onClose={onClose} onConfirm={vi.fn()} closing={false} />
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables buttons when closing is true", () => {
    render(
      <CloseIssueDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} closing={true} />
    );

    expect(screen.getByText("Cancel")).toBeDisabled();
    expect(screen.getByText("Closing...")).toBeDisabled();
  });

  it("shows 'Closing...' text when closing is true", () => {
    render(
      <CloseIssueDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} closing={true} />
    );

    expect(screen.getByText("Closing...")).toBeInTheDocument();
    // "Close Issue" only appears once now (as title), not as button text
    expect(screen.getAllByText("Close Issue")).toHaveLength(1);
  });

  it("does not call onClose when Cancel is clicked during closing", () => {
    const onClose = vi.fn();
    render(
      <CloseIssueDialog open={true} onClose={onClose} onConfirm={vi.fn()} closing={true} />
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
