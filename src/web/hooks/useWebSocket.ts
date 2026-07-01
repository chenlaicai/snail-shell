import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConversationStore } from "../stores/conversationStore";
import { queryKeys } from "../queries/keys";
import { removePendingMessage } from "../lib/pending-messages";
import { recordWsReconnect, recordWsDisconnect } from "../lib/perf-logger";
import type { IssueRealtimeMessage, IssueDetailDto, MessageDto, WsServerMessage } from "../types";

/** 创建占位 MessageDto——用于 WebSocket message_started 和乐观发送 */
export function createPlaceholderMessage(
  stageId: string,
  opts: { id: number; role: MessageDto["role"]; from_role?: string | null; client_id?: string | null; status?: MessageDto["status"]; content?: string; createdAt?: string }
): MessageDto {
  return {
    id: opts.id,
    stage_id: stageId,
    conversation_id: stageId,
    client_id: opts.client_id ?? null,
    from_speaker: opts.from_role ?? null,
    from_role: opts.from_role ?? null,
    to_speakers: [],
    to_roles: [],
    role: opts.role,
    quoted_message_id: null,
    context_cutoff_at: "",
    runtime: null,
    status: opts.status ?? "streaming",
    created_at: opts.createdAt ?? new Date().toISOString(),
    ended_at: null,
    updated_at: new Date().toISOString(),
    content: opts.content,
    context: null,
    events: [],
    quoted_message: null,
  };
}

/** 按 stageId 缓存的事件批次：每种事件类型一个数组 */
interface StageBatch {
  messageStarted: Array<Extract<IssueRealtimeMessage["event"], { type: "message_started" }>>;
  messageEventAppended: Array<Extract<IssueRealtimeMessage["event"], { type: "message_event_appended" }>>;
  messageStatusChanged: Array<Extract<IssueRealtimeMessage["event"], { type: "message_status_changed" }>>;
  userCalled: Array<Extract<IssueRealtimeMessage["event"], { type: "user_called" }>>;
}

function createEmptyBatch(): StageBatch {
  return { messageStarted: [], messageEventAppended: [], messageStatusChanged: [], userCalled: [] };
}

/**
 * WebSocket 事件批处理器。
 *
 * 将 16ms 窗口内（一帧）的多个 WebSocket 事件收集后一次性 setQueryData，
 * 避免每个事件都触发独立的 React 重渲染周期。
 */
class EventBatcher {
  private batch = new Map<string, StageBatch>();
  private pendingStageTransitions: Array<{ issueId: string; stageId: string }> = [];
  /** 每个 issue 只保留最新的 activity_status，flush 时一次性更新 */
  private pendingActivityStatus = new Map<string, IssueDetailDto["activity_status"]>();
  private scheduled = false;

  constructor(private queryClient: ReturnType<typeof useQueryClient>) {}

  add(msg: WsServerMessage): void {
    if (msg.type === "heartbeat") return;
    const { event } = msg;
    const stageId = event.stage_id;

    /** 收集 activity_status 到 batch，不立即 setQueryData */
    this.pendingActivityStatus.set(msg.issue_id, msg.activity_status);

    if (event.type === "stage_transition_suggested") {
      this.pendingStageTransitions.push({ issueId: msg.issue_id, stageId });
      this.schedule();
      return;
    }

    let stageBatch = this.batch.get(stageId);
    if (!stageBatch) {
      stageBatch = createEmptyBatch();
      this.batch.set(stageId, stageBatch);
    }

    switch (event.type) {
      case "message_started":
        stageBatch.messageStarted.push(event);
        break;
      case "message_event_appended":
        stageBatch.messageEventAppended.push(event);
        break;
      case "message_status_changed":
        stageBatch.messageStatusChanged.push(event);
        break;
      case "user_called":
        stageBatch.userCalled.push(event);
        break;
    }

    this.schedule();
  }

  /** flush 时批量更新 activity_status，每个 issue 只处理最新值 */
  private applyActivityStatus(): void {
    for (const [issueId, activityStatus] of this.pendingActivityStatus) {
      this.queryClient.setQueryData(
        queryKeys.issues.detail(issueId),
        (old: IssueDetailDto | null | undefined) => old ? { ...old, activity_status: activityStatus } : old,
      );
      this.queryClient.setQueriesData(
        { queryKey: queryKeys.workspaces.issues(""), exact: false },
        (old: IssueDetailDto[] | undefined) => old?.map(issue =>
          issue.id === issueId ? { ...issue, activity_status: activityStatus } : issue,
        ),
      );
    }
    this.pendingActivityStatus.clear();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    // requestAnimationFrame 在标签页不可见时不触发，用 setTimeout 兜底
    requestAnimationFrame(() => {
      if (this.scheduled) this.flush();
    });
    setTimeout(() => {
      if (this.scheduled) this.flush();
    }, 50);
  }

  private applyBatch(stageId: string, batch: StageBatch, old: MessageDto[] | undefined): MessageDto[] {
    let result = old ?? [];
    let changed = false;

    /** 处理 message_started 事件（服务端推送的 AI 消息开始） */
    for (const event of batch.messageStarted) {
      if (result.some((m) => m.id === event.message_id)) continue;
      result = [createPlaceholderMessage(stageId, {
        id: event.message_id, role: event.role, from_role: event.role_name,
        client_id: event.client_id, status: event.status,
      }), ...result];
      changed = true;
    }

    /** 处理 user_called 事件（服务端推送的用户消息确认） */
    for (const event of batch.userCalled) {
      if (result.some((m) => m.id === event.message_id)) continue;
      const replaced = this.replaceOptimisticMessage(result, stageId, event);
      if (replaced) {
        result = replaced;
      } else {
        result = [createPlaceholderMessage(stageId, {
          id: event.message_id, role: event.role, from_role: event.role_name,
          client_id: event.client_id, status: event.status,
        }), ...result];
      }
      changed = true;
    }

    /** 批量追加 events + 记录 _lastEventAt 用于 stuck-streaming 检测 */
    const appendResult = this.appendEvents(result, batch.messageEventAppended);
    if (appendResult.changed) {
      result = appendResult.messages;
      changed = true;
    }

    /** 批量更新状态 */
    const statusResult = this.updateStatuses(result, batch.messageStatusChanged);
    if (statusResult.changed) {
      result = statusResult.messages;
      changed = true;
    }

    return changed ? result : (old ?? []);
  }

  /** 批量追加 events + 记录 _lastEventAt 用于 stuck-streaming 检测 */
  private appendEvents(
    messages: MessageDto[],
    events: StageBatch["messageEventAppended"],
  ): { messages: MessageDto[]; changed: boolean } {
    if (events.length === 0) return { messages, changed: false };
    const eventsByMessage = new Map<number, typeof events>();
    for (const event of events) {
      const arr = eventsByMessage.get(event.message_id) ?? [];
      arr.push(event);
      eventsByMessage.set(event.message_id, arr);
    }
    const now = Date.now();
    let changed = false;
    const result = messages.map((m) => {
      const newEvents = eventsByMessage.get(m.id);
      if (!newEvents) return m;
      changed = true;
      return { ...m, events: [...(m.events ?? []), ...newEvents.map((e) => e.event)], _lastEventAt: now };
    });
    return { messages: result, changed };
  }

  /** 批量更新状态 */
  private updateStatuses(
    messages: MessageDto[],
    statusChanges: StageBatch["messageStatusChanged"],
  ): { messages: MessageDto[]; changed: boolean } {
    if (statusChanges.length === 0) return { messages, changed: false };
    const statusByMessage = new Map<number, typeof statusChanges>();
    for (const event of statusChanges) {
      const arr = statusByMessage.get(event.message_id) ?? [];
      arr.push(event);
      statusByMessage.set(event.message_id, arr);
    }
    let changed = false;
    const result = messages.map((m) => {
      const updates = statusByMessage.get(m.id);
      if (!updates) return m;
      changed = true;
      const latest = updates[updates.length - 1];
      const endedAt = latest.ended_at ?? m.ended_at;
      return {
        ...m,
        status: latest.status,
        context: latest.context ?? m.context,
        content: latest.context?.context ?? m.content,
        ended_at: endedAt,
        updated_at: endedAt ?? new Date().toISOString(),
      };
    });
    return { messages: result, changed };
  }

  /**
   * 内容匹配替换：检查是否有 role="user" + status="sending" + content 相同的乐观消息。
   * 使用 findLastIndex 匹配最新的乐观消息，避免用户快速发送相同内容时只替换第一条。
   */
  private replaceOptimisticMessage(
    messages: MessageDto[],
    stageId: string,
    event: Extract<IssueRealtimeMessage["event"], { type: "user_called" }>,
  ): MessageDto[] | null {
    const eventContent = event.content?.trim();
    if (!eventContent) return null;
    const optimisticIndex = messages.findLastIndex(
      (m) => m.role === "user" && m.status === "sending" && m.content?.trim() === eventContent,
    );
    if (optimisticIndex === -1) return null;

    /** 替换乐观消息为服务端消息 */
    const result = messages.map((m, i) =>
      i === optimisticIndex
        ? createPlaceholderMessage(stageId, {
            id: event.message_id,
            role: event.role,
            from_role: event.role_name,
            client_id: event.client_id,
            status: event.status,
            content: event.content,
          })
        : m,
    );
    /** 清除 localStorage 中对应的 pending 消息 */
    removePendingMessage(stageId, messages[optimisticIndex].id);
    return result;
  }

  private flush(): void {
    this.scheduled = false;

    /** 先处理 activity_status 批量更新，再处理消息 batch */
    this.applyActivityStatus();

    for (const [stageId, batch] of this.batch) {
      this.queryClient.setQueryData(
        queryKeys.stages.messages(stageId),
        (old: MessageDto[] | undefined) => this.applyBatch(stageId, batch, old),
      );
    }

    this.batch.clear();

    // Stage transition 事件：invalidate 查询
    for (const { issueId, stageId } of this.pendingStageTransitions) {
      this.queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.stages.detail(stageId) });
      this.queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
    }
    this.pendingStageTransitions = [];
  }

  /** 组件卸载时调用，确保 pending 事件不丢失 */
  dispose(): void {
    if (this.batch.size > 0 || this.pendingStageTransitions.length > 0 || this.pendingActivityStatus.size > 0) {
      this.flush();
    }
  }
}

interface WsHandlers {
  mounted: () => boolean;
  onOpen: () => void;
  onMessage: (msg: WsServerMessage) => void;
  onClose: () => void;
  onError?: () => void;
}

function createWsConnection(url: string, handlers: WsHandlers): WebSocket {
  const ws = new WebSocket(url);
  ws.onopen = () => { if (handlers.mounted()) handlers.onOpen(); };
  ws.onmessage = (e) => {
    if (!handlers.mounted()) return;
    try { handlers.onMessage(JSON.parse(e.data)); }
    catch (err) { console.warn("[WebSocket] 消息解析失败:", err, e.data); }
  };
  ws.onclose = () => { if (handlers.mounted()) handlers.onClose(); };
  ws.onerror = () => { handlers.onError?.(); ws.close(); };
  return ws;
}

export function useIssueRealtime(issueId: string | null, currentStageId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; delay: number; start: number; count: number }>({ timer: null, delay: 1000, start: 0, count: 0 });
  const queryClient = useQueryClient();
  const batcherRef = useRef(new EventBatcher(queryClient));
  const setWsStatus = useConversationStore((state) => state.setWsStatus);
  const currentStageIdRef = useRef<string | null>(null);
  currentStageIdRef.current = currentStageId;

  useEffect(() => {
    if (!issueId) { setWsStatus("disconnected"); return; }
    let mounted = true;
    let activeWs: WebSocket | null = null;
    const t = timerRef.current;

    function connect() {
      if (!mounted) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      setWsStatus("reconnecting");
      t.start = performance.now();
      const ws = createWsConnection(
        `${proto}//${location.host}/issue-events?issue_id=${encodeURIComponent(issueId)}`,
        {
          mounted: () => mounted && activeWs === ws && wsRef.current === ws,
          onOpen: () => {
            if (t.timer) { clearTimeout(t.timer); t.timer = null; }
            if (t.count > 0) recordWsReconnect(performance.now() - t.start, t.count);
            t.count = 0; t.delay = 1000;
            queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
            const sid = currentStageIdRef.current;
            if (sid) queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(sid) });
            setWsStatus("connected");
          },
          onMessage: (msg) => batcherRef.current!.add(msg),
          onError: () => { if (mounted && activeWs === ws && wsRef.current === ws) setWsStatus("error"); },
          onClose: () => {
            if (!mounted || activeWs !== ws || wsRef.current !== ws) return;
            t.count++;
            recordWsDisconnect(`reconnect in ${t.delay}ms`, t.count);
            if (useConversationStore.getState().wsStatus !== "error") setWsStatus("disconnected");
            console.log(`[WebSocket] 连接关闭，${t.delay}ms 后重连`);
            t.timer = setTimeout(() => { t.delay = Math.min(t.delay * 2, 30000); connect(); }, t.delay);
          },
        },
      );
      activeWs = ws;
      wsRef.current = ws;
    }

    connect();
    return () => {
      mounted = false;
      batcherRef.current.dispose();
      if (t.timer) { clearTimeout(t.timer); t.timer = null; }
      if (activeWs) {
        const ws = activeWs; activeWs = null;
        if (wsRef.current === ws) wsRef.current = null;
        ws.close();
      }
    };
  }, [issueId, queryClient, setWsStatus]);

  return wsRef;
}
