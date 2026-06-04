import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Toast, showToast } from "../components/Toast";

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("renders nothing by default", () => {
    render(<Toast />);
    expect(screen.queryByText(/./)).toBeNull();
  });

  it("shows toast message when showToast is called", () => {
    render(<Toast />);
    act(() => { showToast("Test message"); });
    expect(screen.getByText("Test message")).toBeInTheDocument();
  });

  it("shows error toast with correct style", () => {
    render(<Toast />);
    act(() => { showToast("Error!", true); });
    const el = screen.getByText("Error!");
    expect(el).toHaveStyle({ background: "var(--color-danger-bg)" });
  });

  it("auto-hides after 2500ms", () => {
    render(<Toast />);
    act(() => { showToast("Gone soon"); });
    expect(screen.getByText("Gone soon")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.queryByText("Gone soon")).toBeNull();
  });

  it("shows multiple toasts", () => {
    render(<Toast />);
    act(() => {
      showToast("First");
      showToast("Second");
    });
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });
});
