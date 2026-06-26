import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConversationStore } from "../stores/conversationStore";
import { queryKeys } from "../queries/keys";
import type { IssueRealtimeMessage, IssueDetailDto, MessageDto, WsServerMessage } from "../types";

/** 创建占位 MessageDto——用于 WebSocket message_started 和乐观发送 */
export function createPlaceholderMessage(
  stageId: string,
  opts: { id: number; role: MessageDto["role"]; from_role?: string | null; client_id?: string | null; status?: MessageDto["status"]; content?: string }
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
    created_at: new Date().toISOString(),
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
  private scheduled = false;

  constructor(private queryClient: ReturnType<typeof useQueryClient>) {}

  add(msg: WsServerMessage): void {
    if (msg.type === "heartbeat") return;
    const { event } = msg;
    const stageId = event.stage_id;

    // 实时更新 activity_status
    this.updateIssueActivityStatus(msg.issue_id, msg.activity_status);

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

  private updateIssueActivityStatus(issueId: string, activityStatus: IssueDetailDto["activity_status"]): void {
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

    // 1. 添加占位消息（message_started + user_called）
    //    前置插入以保持 DESC 顺序（后端 listByStage 返回 id DESC）
    for (const event of [...batch.messageStarted, ...batch.userCalled]) {
      // 防止重复插入：WebSocket 可能重发相同事件（网络抖动、重连后重放等）
      if (result.some((m) => m.id === event.message_id)) continue;
      result = [createPlaceholderMessage(stageId, {
        id: event.message_id, role: event.role, from_role: event.role_name,
        client_id: event.client_id, status: event.status,
      }), ...result];
    }

    // 2. 批量追加 events
    if (batch.messageEventAppended.length > 0) {
      const eventsByMessage = new Map<number, typeof batch.messageEventAppended>();
      for (const event of batch.messageEventAppended) {
        const arr = eventsByMessage.get(event.message_id) ?? [];
        arr.push(event);
        eventsByMessage.set(event.message_id, arr);
      }
      result = result.map((m) => {
        const newEvents = eventsByMessage.get(m.id);
        if (!newEvents) return m;
        return { ...m, events: [...(m.events ?? []), ...newEvents.map((e) => e.event)] };
      });
    }

    // 3. 批量更新状态
    if (batch.messageStatusChanged.length > 0) {
      const statusByMessage = new Map<number, typeof batch.messageStatusChanged>();
      for (const event of batch.messageStatusChanged) {
        const arr = statusByMessage.get(event.message_id) ?? [];
        arr.push(event);
        statusByMessage.set(event.message_id, arr);
      }
      result = result.map((m) => {
        const updates = statusByMessage.get(m.id);
        if (!updates) return m;
        const latest = updates[updates.length - 1];
        return {
          ...m,
          status: latest.status,
          context: latest.context ?? m.context,
          content: latest.context?.context ?? m.content,
          updated_at: new Date().toISOString(),
        };
      });
    }

    return result;
  }

  private flush(): void {
    this.scheduled = false;

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
    if (this.batch.size > 0 || this.pendingStageTransitions.length > 0) {
      this.flush();
    }
  }
}

interface WsHandlers {
  mounted: () => boolean;
  onOpen: () => void;
  onMessage: (msg: WsServerMessage) => void;
  onClose: () => void;
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
  ws.onerror = () => ws.close();
  return ws;
}

function clearTimer(timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
  if (timer.current) {
    clearTimeout(timer.current);
    timer.current = null;
  }
}

export function useIssueRealtime(issueId: string | null, currentStageId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const queryClient = useQueryClient();
  const batcherRef = useRef(new EventBatcher(queryClient));
  const setWsStatus = useConversationStore((state) => state.setWsStatus);
  const currentStageIdRef = useRef<string | null>(null);
  currentStageIdRef.current = currentStageId;

  useEffect(() => {
    if (!issueId) { setWsStatus("disconnected"); return; }
    let mounted = true;
    let activeWs: WebSocket | null = null;

    function connect() {
      if (!mounted) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      setWsStatus("reconnecting");
      const ws = createWsConnection(
        `${proto}//${location.host}/issue-events?issue_id=${encodeURIComponent(issueId)}`,
        {
          mounted: () => mounted && activeWs === ws && wsRef.current === ws,
          onOpen: () => {
            clearTimer(reconnectTimer);
            queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
            const currentStageId = currentStageIdRef.current;
            if (currentStageId) queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(currentStageId) });
            setWsStatus("connected");
            reconnectDelay.current = 1000;
          },
          onMessage: (msg) => batcherRef.current!.add(msg),
          onClose: () => {
            if (!mounted || activeWs !== ws || wsRef.current !== ws) return;
            setWsStatus("disconnected");
            console.log(`[WebSocket] 连接关闭，${reconnectDelay.current}ms 后重连`);
            reconnectTimer.current = setTimeout(() => {
              reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
              connect();
            }, reconnectDelay.current);
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
      clearTimer(reconnectTimer);
      if (activeWs) {
        const ws = activeWs;
        activeWs = null;
        if (wsRef.current === ws) wsRef.current = null;
        ws.close();
      }
    };
  }, [issueId, queryClient, setWsStatus]);

  return wsRef;
}
