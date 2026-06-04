import { logger } from "../../logger";
import type { IMTransport } from "../im-channel/types";

export interface StreamingSessionConfig {
  /** debounce 间隔（ms），默认 300 */
  flushIntervalMs: number;
  /** 最大文本长度 */
  maxLength: number;
}

/**
 * 单条消息的飞书流式会话管理器。
 *
 * 状态机：idle → started（onStart 发占位消息）→ streaming（onTextDelta buffer + debounce flush）→ finalized（onEnd 最终 PATCH）
 * 竞态处理：onEnd 可能在 onStart 完成前到达（极短回复），通过 pendingEndText 机制处理。
 * buffer 策略：累积全部文本，PATCH 全量替换（非追加），flush 不 clear buffer。
 */
export class FeishuStreamingSession {
  private buffer = "";
  private feishuMessageId: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private finalized = false;
  /** onEnd 在 onStart 完成前到达时，暂存 finalText */
  private pendingEndText: string | null = null;

  constructor(
    readonly chatId: string,
    private readonly roleName: string,
    private readonly transport: IMTransport,
    private readonly config: StreamingSessionConfig,
  ) {}

  /** 收到 message_started 事件：发送占位消息 */
  async onStart(): Promise<void> {
    const text = `[${this.roleName}] 思考中...`;
    this.feishuMessageId = await this.transport.sendText({
      chatId: this.chatId,
      text,
    });
    // 竞态保护：onEnd 在 onStart 完成前已到达，立即执行最终 PATCH
    if (this.pendingEndText !== null) {
      const finalText = this.pendingEndText;
      this.pendingEndText = null;
      await this.doFinalPatch(finalText);
    }
  }

  /** 收到 message_event_appended 事件：追加到 buffer，触发 debounce flush */
  onTextDelta(delta: string): void {
    this.buffer += delta;
    this.scheduleFlush();
  }

  /** 收到 message_status_changed 事件：最终 flush + 标记完成 */
  async onEnd(finalText?: string): Promise<void> {
    this.clearTimer();
    if (this.finalized) return;
    this.finalized = true;

    // onStart 尚未完成：暂存 finalText，等 onStart 完成后处理
    if (!this.feishuMessageId) {
      const text = finalText ?? this.buffer;
      // 空文本不触发 doFinalPatch——避免对占位消息做无意义的空内容 PATCH
      this.pendingEndText = text || null;
      return;
    }

    await this.doFinalPatch(finalText ?? this.buffer);
  }

  /** 清理资源，用于 LobbyAwareChannel.stop() 时取消 pending timer */
  dispose(): void {
    this.clearTimer();
  }

  private async doFinalPatch(text: string): Promise<void> {
    if (!this.feishuMessageId || !text) return;
    const rendered = this.render(text);
    try {
      if (!this.transport.patchText) {
        throw new Error("Transport does not support patchText");
      }
      await this.transport.patchText({ messageId: this.feishuMessageId, text: rendered });
    } catch (patchError) {
      // 降级：如果 PATCH 失败，创建一条新消息（占位消息会残留，已知限制）
      try {
        await this.transport.sendText({ chatId: this.chatId, text: rendered });
      } catch (fallbackError) {
        logger.warn("Feishu streaming fallback sendText also failed", {
          chatId: this.chatId, messageId: this.feishuMessageId,
          patchError: patchError instanceof Error ? patchError.message : String(patchError),
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }
  }

  private scheduleFlush(): void {
    // finalized 后 onTextDelta 仍可能被调用（竞态），此时应忽略
    // debounce 行为：timer 期间收到的 delta 累积到 buffer，但不重置 timer。
    // 首次 delta 触发 timer，后续 delta 只追加 buffer，timer 到期后 flush 一次完整内容。
    if (this.finalized || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  private async flush(): Promise<void> {
    if (!this.feishuMessageId || !this.buffer) return;
    // PATCH 是全量替换（非追加），buffer 累积全部文本，flush 不 clear buffer。
    // 后续 flush 和 onEnd 都需要完整 buffer 来渲染完整消息。
    const rendered = this.render(this.buffer);
    try {
      await this.transport.patchText?.({ messageId: this.feishuMessageId, text: rendered });
    } catch {
      // flush 失败不中断，等 onEnd 重试
    }
  }

  private render(text: string): string {
    const prefix = `[${this.roleName}] `;
    const maxBody = this.config.maxLength - prefix.length;
    const body = text.length > maxBody ? text.slice(0, maxBody) + "\u2026" : text;
    return prefix + body;
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
