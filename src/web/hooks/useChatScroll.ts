import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "@/services/api-client";
import type { MessageDto } from "@/types";

const SCROLL_THRESHOLD = 80;
const INITIAL_SCROLL_TIMEOUT_MS = 500;

interface UseChatScrollOptions {
  sorted: MessageDto[];
  stageId: string | null;
  setOlderHistory: (msgs: MessageDto[] | ((prev: MessageDto[]) => MessageDto[])) => void;
  isLoadingHistoryRef: React.MutableRefObject<boolean>;
  allHistoryLoadedRef: React.MutableRefObject<boolean>;
}

/** MP2: 启动初始滚动模式超时兜底，防止 totalSize 不收敛时退出死角 */
function startInitialScrollTimeout(
  isInitialScrollRef: React.MutableRefObject<boolean>,
  timeoutRef: React.RefObject<number | null>,
) {
  if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  timeoutRef.current = window.setTimeout(() => {
    isInitialScrollRef.current = false;
    timeoutRef.current = null;
  }, INITIAL_SCROLL_TIMEOUT_MS);
}

/** MP2: 退出初始滚动模式并清除超时 */
function exitInitialScrollMode(
  isInitialScrollRef: React.MutableRefObject<boolean>,
  timeoutRef: React.RefObject<number | null>,
) {
  isInitialScrollRef.current = false;
  if (timeoutRef.current) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
}

/** cursor-based 翻页加载更早历史，加载后保持滚动位置不变 */
async function fetchOlderHistory(
  stageId: string,
  sorted: MessageDto[],
  setOlderHistory: (msgs: MessageDto[] | ((prev: MessageDto[]) => MessageDto[])) => void,
  historyRefs: { isLoading: React.MutableRefObject<boolean>; allLoaded: React.MutableRefObject<boolean> },
  scrollRef: React.RefObject<HTMLDivElement | null>,
) {
  if (historyRefs.isLoading.current || historyRefs.allLoaded.current || sorted.length === 0) return;
  historyRefs.isLoading.current = true;
  try {
    const older = await api("GET /api/stages/:stageId/messages", { params: { stageId }, query: { before_id: sorted[0].id } }) as MessageDto[];
    if (older.length === 0) { historyRefs.allLoaded.current = true; return; }
    const el = scrollRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevScrollTop = el?.scrollTop ?? 0;
    setOlderHistory(prev => [...older.reverse(), ...prev]);
    requestAnimationFrame(() => { if (el) el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight); });
  } finally { historyRefs.isLoading.current = false; }
}

/** 滚动管理 hook：虚拟化、auto-scroll、历史加载触发、滚动按钮。stage 切换时自行重置滚动（DR-1）。 */
export function useChatScroll({ sorted, stageId, setOlderHistory, isLoadingHistoryRef, allHistoryLoadedRef }: UseChatScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const [scrollPosition, setScrollPosition] = useState<'top' | 'middle' | 'bottom'>('bottom');
  const isSmoothScrollingRef = useRef(false);
  const prevStageIdForScrollRef = useRef<string | null>(null);
  const isInitialScrollRef = useRef(false);
  const prevTotalSizeRef = useRef(0);
  const initialScrollTimeoutRef = useRef<number | null>(null);
  const virtualizer = useVirtualizer({ count: sorted.length, getScrollElement: () => scrollRef.current, estimateSize: () => 120, overscan: 10 });

  useEffect(() => {
    if (prevStageIdForScrollRef.current !== stageId) {
      prevStageIdForScrollRef.current = stageId;
      wasAtBottomRef.current = true;
      isInitialScrollRef.current = true;
      prevTotalSizeRef.current = 0;
      startInitialScrollTimeout(isInitialScrollRef, initialScrollTimeoutRef);
    }
    return () => { if (initialScrollTimeoutRef.current) { window.clearTimeout(initialScrollTimeoutRef.current); initialScrollTimeoutRef.current = null; } };
  }, [stageId]);

  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || sorted.length === 0) return;
    if (isInitialScrollRef.current) {
      // Initial scroll mode: unconditionally scrollToIndex(last) without checking wasAtBottomRef.
      // Why unconditional: during initial load/stage switch, user hasn't interacted yet,
      // so we must force-scroll to bottom regardless of current scroll position.
      // totalSize stability check: when totalSize stops changing (< 1px delta between renders),
      // measureElement has converged — exit initial mode to restore normal handleScroll behavior.
      virtualizer.scrollToIndex(sorted.length - 1, { align: 'end' });
      if (prevTotalSizeRef.current > 0 && Math.abs(totalSize - prevTotalSizeRef.current) < 1) exitInitialScrollMode(isInitialScrollRef, initialScrollTimeoutRef);
      prevTotalSizeRef.current = totalSize;
    } else {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
      if (atBottom || wasAtBottomRef.current) virtualizer.scrollToIndex(sorted.length - 1, { align: 'end' });
    }
  }, [sorted, totalSize, virtualizer]);

  const loadMoreHistory = useCallback(() => {
    if (!stageId) return;
    void fetchOlderHistory(stageId, sorted, setOlderHistory, { isLoading: isLoadingHistoryRef, allLoaded: allHistoryLoadedRef }, scrollRef);
  }, [stageId, sorted, setOlderHistory, isLoadingHistoryRef, allHistoryLoadedRef]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Block handleScroll during initial scroll mode and smooth scrolling.
    // Why: during initial mode, useLayoutEffect calls scrollToIndex unconditionally;
    // if handleScroll updated wasAtBottomRef to false here, auto-scroll to bottom would break.
    // During smooth scrolling, programmatic scroll events must not override the target position.
    if (isInitialScrollRef.current || isSmoothScrollingRef.current) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
    wasAtBottomRef.current = atBottom;
    if (el.scrollTop < SCROLL_THRESHOLD) { setScrollPosition('top'); loadMoreHistory(); }
    else if (atBottom) setScrollPosition('bottom');
    else setScrollPosition('middle');
  }, [loadMoreHistory]);

  const smoothScrollTo = useCallback((index: number, align: 'start' | 'end', position: 'top' | 'bottom', atBottom: boolean) => {
    if (sorted.length === 0) return;
    isSmoothScrollingRef.current = true;
    virtualizer.scrollToIndex(index, { align, behavior: 'smooth' });
    wasAtBottomRef.current = atBottom;
    setScrollPosition(position);
    setTimeout(() => { isSmoothScrollingRef.current = false; }, 500);
  }, [sorted.length, virtualizer]);

  const scrollToTop = useCallback(() => smoothScrollTo(0, 'start', 'top', false), [smoothScrollTo]);
  const scrollToBottom = useCallback(() => smoothScrollTo(sorted.length - 1, 'end', 'bottom', true), [smoothScrollTo, sorted.length]);

  return { scrollRef, virtualizer, scrollPosition, handleScroll, scrollToTop, scrollToBottom };
}
