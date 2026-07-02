import { useEffect, useMemo, useState } from "react";
import type { MessageDto } from "@/types";

/**
 * 实时计时器 hook：streaming 期间每秒更新 elapsedMs，完成后冻结最终值。
 * 返回当前耗时（ms）。
 */
export function useLiveTimer(message: MessageDto, isStreaming: boolean): number {
  // streaming 期间用 interval 驱动更新
  const [liveMs, setLiveMs] = useState(() =>
    isStreaming ? Date.now() - new Date(message.created_at).getTime() : 0,
  );

  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => {
      setLiveMs(Date.now() - new Date(message.created_at).getTime());
    }, 1000);
    return () => clearInterval(id);
  }, [isStreaming, message.created_at]);

  // 非 streaming：直接从消息数据计算（ended_at ?? updated_at - created_at）
  // streaming 结束瞬间：用 memo 冻结最终值，避免依赖 updated_at 的时序抖动
  const finalMs = useMemo(
    () => new Date(message.ended_at ?? message.updated_at).getTime() - new Date(message.created_at).getTime(),
    [message.ended_at, message.updated_at, message.created_at],
  );

  return isStreaming ? liveMs : finalMs;
}
