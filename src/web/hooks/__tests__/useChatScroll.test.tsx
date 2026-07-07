import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useCallback, useRef } from "react";
import { useChatScroll } from "../useChatScroll";
import type { MessageDto } from "@/types";

// Mock api-client to prevent real API calls during loadMoreHistory
vi.mock("@/services/api-client", () => ({ api: vi.fn().mockResolvedValue([]) }));

const SCROLL_THRESHOLD = 80;
const ESTIMATE_SIZE = 120;

function createMessage(id: number, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id,
    stage_id: "stage-1",
    conversation_id: "conv-1",
    from_speaker: "user",
    from_role: "user",
    to_speakers: [],
    to_roles: [],
    role: "user",
    status: "completed",
    created_at: new Date(Date.now() - id * 1000).toISOString(),
    ended_at: null,
    updated_at: new Date().toISOString(),
    content: `Message ${id}`,
    context: null,
    events: [],
    ...overrides,
  } as MessageDto;
}

function createMessages(count: number): MessageDto[] {
  return Array.from({ length: count }, (_, i) => createMessage(i + 1));
}

/** Hook result exposed by TestComponent for test assertions */
let hookResult: ReturnType<typeof useChatScroll> | null = null;

function TestComponent({ messages, stageId, clientHeight = 500 }: {
  messages: MessageDto[];
  stageId: string;
  clientHeight?: number;
}) {
  const setOlderHistory = useCallback(() => {}, []);
  const isLoadingHistoryRef = useRef(false);
  const allHistoryLoadedRef = useRef(false);
  const hook = useChatScroll({ sorted: messages, stageId, setOlderHistory, isLoadingHistoryRef, allHistoryLoadedRef });
  hookResult = hook;

  // Set dimensions on the scroll element via ref callback (runs before useLayoutEffect)
  const scrollRef = hook.scrollRef;
  const combinedRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (el) {
      const contentHeight = messages.length * ESTIMATE_SIZE;
      Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
      Object.defineProperty(el, "scrollHeight", { value: Math.max(contentHeight, clientHeight), configurable: true });
      Object.defineProperty(el, "scrollTop", { value: 0, configurable: true, writable: true });
      // jsdom doesn't implement scrollTo — define it so virtualizer's scrollToIndex works
      el.scrollTo = ((x?: number | ScrollToOptions) => {
        const top = typeof x === "object" && x !== null ? (x.top ?? el.scrollTop) : (typeof x === "number" ? x : el.scrollTop);
        el.scrollTop = Math.max(0, top);
      }) as typeof el.scrollTo;
    }
  }, [scrollRef, clientHeight, messages.length]);

  return (
    <div ref={combinedRef} onScroll={hook.handleScroll} style={{ height: `${clientHeight}px`, overflow: "auto" }} data-testid="scroll-container">
      <div style={{ height: hook.virtualizer.getTotalSize(), position: "relative" }} data-testid="virtual-list">
        {/* measureElement intentionally omitted: jsdom offsetHeight=0 causes totalSize to
            collapse unrealistically. MP2 initial scroll mode is tested via sorted reference
            changes that trigger useLayoutEffect re-runs — see "MP2: initial scroll mode" tests. */}
        {hook.virtualizer.getVirtualItems().map((vr) => (
          <div key={vr.key} data-index={vr.index} style={{ position: "absolute", top: 0, transform: `translateY(${vr.start}px)` }}>
            {messages[vr.index]?.content}
          </div>
        ))}
      </div>
    </div>
  );
}

describe("useChatScroll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hookResult = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    hookResult = null;
  });

  describe("MP3: paddingEnd removed", () => {
    it("T2: few messages — virtual list container height equals messages total height (no padding)", () => {
      const messages = createMessages(3);
      const { container } = render(<TestComponent messages={messages} stageId="stage-1" />);
      const virtualList = container.querySelector('[data-testid="virtual-list"]') as HTMLDivElement;

      // Without paddingEnd, getTotalSize() = count * estimateSize = 3 * 120 = 360
      // With paddingEnd, getTotalSize() would be > 360 (padded to fill container)
      expect(virtualList.style.height).toBe("360px");
    });

    it("T2: many messages — no paddingEnd affecting container height", () => {
      const messages = createMessages(20);
      const { container } = render(<TestComponent messages={messages} stageId="stage-1" />);
      const virtualList = container.querySelector('[data-testid="virtual-list"]') as HTMLDivElement;

      // 20 * 120 = 2400, no paddingEnd
      expect(virtualList.style.height).toBe("2400px");
    });
  });

  describe("MP1+MP3: scroll-to-bottom behavior", () => {
    it("T1: initial load — scroll position at bottom (latest messages visible)", () => {
      const messages = createMessages(10);
      const { container } = render(<TestComponent messages={messages} stageId="stage-1" />);
      const scrollEl = container.querySelector('[data-testid="scroll-container"]') as HTMLDivElement;

      // After initial load, should be scrolled to bottom:
      // scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD
      const { scrollTop, clientHeight, scrollHeight } = scrollEl;
      expect(scrollTop + clientHeight).toBeGreaterThanOrEqual(scrollHeight - SCROLL_THRESHOLD);
    });

    it("T3: stage switch — scroll position at bottom for new stage", () => {
      const messagesA = createMessages(10);
      const messagesB = createMessages(8);
      const { rerender, container } = render(<TestComponent messages={messagesA} stageId="stage-A" />);

      // Wait for initial mode to end
      act(() => { vi.advanceTimersByTime(600); });

      // Switch to stage B with different messages (triggers useLayoutEffect via sorted change)
      act(() => {
        rerender(<TestComponent messages={messagesB} stageId="stage-B" />);
      });

      const scrollEl = container.querySelector('[data-testid="scroll-container"]') as HTMLDivElement;
      const { scrollTop, clientHeight, scrollHeight } = scrollEl;
      expect(scrollTop + clientHeight).toBeGreaterThanOrEqual(scrollHeight - SCROLL_THRESHOLD);
    });

    it("T4: new messages arrive at bottom — auto-scroll to latest", () => {
      const messages = createMessages(5);
      const { rerender, container } = render(<TestComponent messages={messages} stageId="stage-1" />);

      // Wait for initial mode to end
      act(() => { vi.advanceTimersByTime(600); });

      // Add new messages (triggers useLayoutEffect via sorted change)
      // wasAtBottomRef is still true (handleScroll was blocked during initial mode)
      const moreMessages = [...messages, createMessage(6), createMessage(7)];
      act(() => {
        rerender(<TestComponent messages={moreMessages} stageId="stage-1" />);
      });

      const scrollEl = container.querySelector('[data-testid="scroll-container"]') as HTMLDivElement;
      const { scrollTop, clientHeight, scrollHeight } = scrollEl;
      expect(scrollTop + clientHeight).toBeGreaterThanOrEqual(scrollHeight - SCROLL_THRESHOLD);
    });

    // T5 (mixed height messages) removed: jsdom doesn't execute real layout,
    // scrollHeight is always count * estimateSize regardless of content length.
    // Mixed-height behavior is verified through code review of measureElement usage
    // in IssueConversation.tsx and totalSize stability detection in useChatScroll.ts.
  });

  describe("MP2: handleScroll race condition fix", () => {
    it("B6: handleScroll is a no-op during initial scroll mode (does not update scrollPosition)", () => {
      const messages = createMessages(10);
      const { container } = render(<TestComponent messages={messages} stageId="stage-1" />);
      const scrollEl = container.querySelector('[data-testid="scroll-container"]') as HTMLDivElement;

      // After render, isInitialScrollRef is true (set by useEffect)
      // Set dimensions so atBottom would be false if handleScroll ran
      Object.defineProperty(scrollEl, "scrollHeight", { value: 5000, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", { value: 0, configurable: true, writable: true });

      // Fire scroll event — handleScroll should return early during initial mode
      act(() => {
        scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      });

      // scrollPosition should remain 'bottom' because handleScroll was blocked
      expect(hookResult?.scrollPosition).toBe("bottom");
    });

    it("B6: handleScroll resumes normal operation after initial mode timeout (500ms)", () => {
      const messages = createMessages(10);
      const { container } = render(<TestComponent messages={messages} stageId="stage-1" />);
      const scrollEl = container.querySelector('[data-testid="scroll-container"]') as HTMLDivElement;

      // Advance past the 500ms timeout to exit initial mode
      act(() => { vi.advanceTimersByTime(600); });

      // Now handleScroll should work normally
      Object.defineProperty(scrollEl, "scrollHeight", { value: 5000, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", { value: 0, configurable: true, writable: true });

      act(() => {
        scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      });

      // scrollTop=0 means at top, so scrollPosition should update to 'top'
      expect(hookResult?.scrollPosition).toBe("top");
    });
  });

  // MP1 (scroll container isolation) is a structural change in IssueConversation.tsx:
  // non-message content moved from scroll container to shrink-0 fixed area.
  // Verified through code review of JSX structure — TestComponent doesn't replicate
  // IssueConversation's full layout, so a unit test here would only test the test helper.

  describe("MP2: initial scroll mode", () => {
    it("initial scroll mode blocks handleScroll after stage switch (isInitialScrollRef=true)", () => {
      const messagesA = createMessages(10);
      const { rerender, container } = render(<TestComponent messages={messagesA} stageId="stage-A" />);

      // End initial mode for stage-A via timeout
      act(() => { vi.advanceTimersByTime(600); });

      // Switch to stage-B — useEffect sets isInitialScrollRef=true, prevTotalSizeRef=0
      act(() => {
        rerender(<TestComponent messages={createMessages(10)} stageId="stage-B" />);
      });

      // Trigger useLayoutEffect re-run with isInitialScrollRef=true
      // (sorted reference change causes useLayoutEffect deps to change)
      act(() => {
        rerender(<TestComponent messages={createMessages(10)} stageId="stage-B" />);
      });

      // isInitialScrollRef is true (prevTotalSizeRef was 0, exit was skipped)
      // handleScroll should be blocked — verify without advancing timer
      const scrollEl = container.querySelector('[data-testid="scroll-container"]') as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 5000, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", { value: 0, configurable: true, writable: true });

      act(() => {
        scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      });

      expect(hookResult?.scrollPosition).toBe("bottom");
    });

    it("exitInitialScrollMode triggered by totalSize stability (not timeout)", () => {
      const messages = createMessages(10);
      const { rerender, container } = render(<TestComponent messages={messages} stageId="stage-A" />);

      // End initial mode for stage-A via timeout
      act(() => { vi.advanceTimersByTime(600); });

      // Switch to stage-B — useEffect sets isInitialScrollRef=true, prevTotalSizeRef=0
      act(() => {
        rerender(<TestComponent messages={createMessages(10)} stageId="stage-B" />);
      });

      // First useLayoutEffect re-run with isInitialScrollRef=true:
      // prevTotalSizeRef=0 → skip exit, set prevTotalSizeRef=totalSize
      act(() => {
        rerender(<TestComponent messages={createMessages(10)} stageId="stage-B" />);
      });

      // Second useLayoutEffect re-run with isInitialScrollRef=true:
      // prevTotalSizeRef>0 and totalSize unchanged → exitInitialScrollMode called
      act(() => {
        rerender(<TestComponent messages={createMessages(10)} stageId="stage-B" />);
      });

      // isInitialScrollRef is now false via exitInitialScrollMode (not timeout)
      // Verify handleScroll works normally WITHOUT advancing timer
      const scrollEl = container.querySelector('[data-testid="scroll-container"]') as HTMLDivElement;
      Object.defineProperty(scrollEl, "scrollHeight", { value: 5000, configurable: true });
      Object.defineProperty(scrollEl, "scrollTop", { value: 0, configurable: true, writable: true });

      act(() => {
        scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
      });

      expect(hookResult?.scrollPosition).toBe("top");
    });
  });
});
