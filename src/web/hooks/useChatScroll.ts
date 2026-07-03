import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "@/services/api-client";
import type { MessageDto } from "@/types";

const SCROLL_THRESHOLD = 80;

interface UseChatScrollOptions {
  sorted: MessageDto[];
  stageId: string | null;
  setOlderHistory: (msgs: MessageDto[] | ((prev: MessageDto[]) => MessageDto[])) => void;
  isLoadingHistoryRef: React.MutableRefObject<boolean>;
  allHistoryLoadedRef: React.MutableRefObject<boolean>;
}

/** 计算虚拟列表底部填充：消息少时填充底部避免大面积空白 */
function usePaddingEnd(scrollRef: React.RefObject<HTMLDivElement | null>, itemCount: number) {
  const [paddingEnd, setPaddingEnd] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  /** 监听容器尺寸变化（窗口 resize、PropertiesPanel 展开/折叠等） */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  /** 当消息数量或容器尺寸变化时，计算 paddingEnd */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rawContentHeight = itemCount * 120;
    setPaddingEnd(Math.max(0, el.clientHeight - rawContentHeight));
  }, [itemCount, containerHeight, scrollRef]);

  return paddingEnd;
}

/** 滚动管理 hook：虚拟化、auto-scroll、历史加载触发、滚动按钮。stage 切换时自行重置滚动（DR-1）。 */
export function useChatScroll({ sorted, stageId, setOlderHistory, isLoadingHistoryRef, allHistoryLoadedRef }: UseChatScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const [scrollPosition, setScrollPosition] = useState<'top' | 'middle' | 'bottom'>('bottom');
  const isSmoothScrollingRef = useRef(false);
  const prevStageIdForScrollRef = useRef<string | null>(null);
  const paddingEnd = usePaddingEnd(scrollRef, sorted.length);
  const virtualizer = useVirtualizer({ count: sorted.length, getScrollElement: () => scrollRef.current, estimateSize: () => 120, overscan: 10, paddingEnd });

  /** stage 切换时滚动重置（DR-1）— 进入 issue / stage 切换时应滚动到底部 */
  useEffect(() => {
    if (prevStageIdForScrollRef.current !== stageId) {
      prevStageIdForScrollRef.current = stageId;
      wasAtBottomRef.current = true;
    }
  }, [stageId]);

  // useLayoutEffect + totalSize 双依赖：测量完成后 re-render 用实际高度修正滚动位置
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || sorted.length === 0) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
    if (atBottom || wasAtBottomRef.current) virtualizer.scrollToIndex(sorted.length - 1, { align: 'end' });
  }, [sorted, totalSize]);

  /** cursor-based 翻页加载更早历史，加载后保持滚动位置不变 */
  const loadMoreHistory = useCallback(async () => {
    if (isLoadingHistoryRef.current || allHistoryLoadedRef.current || !stageId || sorted.length === 0) return;
    isLoadingHistoryRef.current = true;
    try {
      const older = await api("GET /api/stages/:stageId/messages", { params: { stageId }, query: { before_id: sorted[0].id } }) as MessageDto[];
      if (older.length === 0) { allHistoryLoadedRef.current = true; return; }
      const el = scrollRef.current;
      const prevScrollHeight = el?.scrollHeight ?? 0;
      const prevScrollTop = el?.scrollTop ?? 0;
      setOlderHistory(prev => [...older.reverse(), ...prev]);
      requestAnimationFrame(() => { if (el) el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight); });
    } finally { isLoadingHistoryRef.current = false; }
  }, [stageId, sorted, setOlderHistory, isLoadingHistoryRef, allHistoryLoadedRef]);

  /** 更新滚动状态 + 滚动到顶部时触发加载更早消息 */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
    wasAtBottomRef.current = atBottom;
    if (isSmoothScrollingRef.current) return;
    if (el.scrollTop < SCROLL_THRESHOLD) { setScrollPosition('top'); loadMoreHistory(); }
    else if (atBottom) setScrollPosition('bottom');
    else setScrollPosition('middle');
  }, [loadMoreHistory]);

  /** 平滑滚动到指定位置 */
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
