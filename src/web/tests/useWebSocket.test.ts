// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWebSocket } from "../hooks/useWebSocket";
import { useConversationStore } from "../stores/conversationStore";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
  }
  close() { this.readyState = 3; this.onclose?.(); }
  send() {}
}

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

describe("useWebSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    useConversationStore.getState().clear();
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocket;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).WebSocket;
  });

  it("connects when stageId is provided", () => {
    renderHook(() => useWebSocket("stage-1"), { wrapper });
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toContain("stage_id=stage-1");
  });

  it("does not connect when stageId is null", () => {
    renderHook(() => useWebSocket(null), { wrapper });
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("sets wsStatus to connected on open", () => {
    renderHook(() => useWebSocket("conv-1"), { wrapper });
    act(() => { vi.advanceTimersByTime(10); });
    expect(useConversationStore.getState().wsStatus).toBe("connected");
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(() => useWebSocket("conv-1"), { wrapper });
    act(() => { vi.advanceTimersByTime(10); });
    const ws = MockWebSocket.instances[0];
    const closeSpy = vi.spyOn(ws, "close");
    unmount();
    expect(closeSpy).toHaveBeenCalled();
  });
});
