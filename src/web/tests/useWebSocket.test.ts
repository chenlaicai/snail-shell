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

describe("useWebSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    useConversationStore.getState().clear();
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
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

  it("appends message on message_started event", () => {
    renderHook(() => useWebSocket("conv-1"));
    act(() => { vi.advanceTimersByTime(10); });
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "agent_event", event: { type: "message_started", message_id: "m1" } }) });
    });
    const msgs = useConversationStore.getState().messages;
    expect(msgs.length).toBe(1);
    expect(msgs[0].id).toBe("m1");
    expect(msgs[0].role).toBe("assistant");
  });

  it("updates message content on event_appended", () => {
    renderHook(() => useWebSocket("conv-1"));
    act(() => { vi.advanceTimersByTime(10); });
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "agent_event", event: { type: "message_started", message_id: "m1" } }) });
      ws.onmessage?.({ data: JSON.stringify({ type: "agent_event", event: { type: "event_appended", message_id: "m1", content: "hello" } }) });
    });
    expect(useConversationStore.getState().messages[0].content).toBe("hello");
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
