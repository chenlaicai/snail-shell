import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useConversationStore } from "../stores/conversationStore";

// Mock WebSocket
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
    // Simulate async open
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
  }

  close() { this.readyState = 3; this.onclose?.(); }
  send() {}
}

describe("useWebSocket connection", () => {
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

  it("connects when conversationId is provided", () => {
    renderHook(() => useWebSocket("conv-1"));
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toContain("conversation_id=conv-1");
  });

  it("does not connect when conversationId is null", () => {
    renderHook(() => useWebSocket(null));
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("sets wsStatus to connected on open", () => {
    renderHook(() => useWebSocket("conv-1"));
    act(() => { vi.advanceTimersByTime(10); });
    expect(useConversationStore.getState().wsStatus).toBe("connected");
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(() => useWebSocket("conv-1"));
    act(() => { vi.advanceTimersByTime(10); });
    const ws = MockWebSocket.instances[0];
    const closeSpy = vi.spyOn(ws, "close");
    unmount();
    expect(closeSpy).toHaveBeenCalled();
  });
});

describe("useWebSocket message handling", () => {
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

  it("ignores message_started event (API creates placeholder)", () => {
    renderHook(() => useWebSocket("conv-1"));
    act(() => { vi.advanceTimersByTime(10); });
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "agent_event", event: { type: "message_started", message_id: "m1" } }) });
    });
    // message_started is a no-op — API already creates the placeholder
    expect(useConversationStore.getState().messages.length).toBe(0);
  });

  it("updates message content on message_event_appended", () => {
    renderHook(() => useWebSocket("conv-1"));
    act(() => { vi.advanceTimersByTime(10); });
    const ws = MockWebSocket.instances[0];
    // First add a message to the store (simulating API-created placeholder)
    act(() => {
      useConversationStore.getState().appendMessage({
        id: 1, role: "assistant", content: "", created_at: "2024-01-01", status: "streaming",
      });
    });
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "agent_event", event: { type: "message_event_appended", message_id: 1, content: "hello" } }) });
    });
    expect(useConversationStore.getState().messages[0].content).toBe("hello");
  });
});
