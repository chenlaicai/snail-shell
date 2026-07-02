import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queries/keys";
import { getLogger } from "../lib/logger";
import type { IssueDetailDto, ActivityStatus, WorkspaceWsMessage } from "../types";

const log = getLogger("WorkspaceWebSocket");

/** staleTime 与 client.ts 保持一致 */
const STALE_TIME = 30_000;

/** WebSocket 连接状态 */
export type WsStatus = "connecting" | "connected" | "disconnected" | "error";

function clearTimer(timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
  if (timer.current) { clearTimeout(timer.current); timer.current = null; }
}

/**
 * 断连后数据一致性补偿：检查 workspace issues 查询的 dataUpdatedAt，
 * 如果数据超过 staleTime 则 refetch，避免断连期间的数据变化丢失。
 */
function refetchStaleWorkspaceQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
): void {
  const now = Date.now();
  const issuesQuery = queryClient.getQueryState(queryKeys.workspaces.issues(workspaceId));
  if (issuesQuery?.dataUpdatedAt && now - issuesQuery.dataUpdatedAt > STALE_TIME) {
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
  }
}

/** 处理 activity_status_changed 事件：更新 issue detail + workspace issues 缓存 */
function applyActivityStatusChange(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string, issueId: string, activityStatus: ActivityStatus,
): void {
  queryClient.setQueryData(
    queryKeys.issues.detail(issueId),
    (old: IssueDetailDto | null | undefined) => old ? { ...old, activity_status: activityStatus } : old,
  );
  queryClient.setQueriesData(
    { queryKey: queryKeys.workspaces.issues(workspaceId), exact: false },
    (old: IssueDetailDto[] | undefined) => old?.map(issue =>
      issue.id === issueId ? { ...issue, activity_status: activityStatus } : issue,
    ),
  );
}

/**
 * Workspace 级实时 hook：监听 workspace 内所有 issue 的 activity_status 变化。
 * 用于 IssueBoard 和 IssueList 页面，单个 WebSocket 连接覆盖整个 workspace。
 * 返回当前 WebSocket 连接状态，供 UI 层降级决策。
 */
export function useWorkspaceRealtime(workspaceId: string | null): WsStatus {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WsStatus>("connecting");
  const hasDisconnected = useRef(false);

  useEffect(() => {
    if (!workspaceId) return;
    let mounted = true;
    let activeWs: WebSocket | null = null;
    const guard = (ws: WebSocket) => mounted && activeWs === ws && wsRef.current === ws;

    function connect() {
      if (!mounted) return;
      setStatus("connecting");
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/workspace-events?workspace_id=${encodeURIComponent(workspaceId)}`);

      ws.onopen = () => {
        if (!guard(ws)) return;
        log.info("connected", workspaceId);
        clearTimer(reconnectTimer);
        if (hasDisconnected.current) {
          // 断连重连后，检查并 refetch 过期数据，避免断连期间数据变化丢失
          refetchStaleWorkspaceQueries(queryClient, workspaceId);
          hasDisconnected.current = false;
        }
        reconnectDelay.current = 1000;
        setStatus("connected");
      };

      ws.onmessage = (e) => {
        if (!guard(ws)) return;
        try {
          const msg: WorkspaceWsMessage = JSON.parse(e.data);
          if (msg.type === "activity_status_changed" && msg.issue_id && msg.activity_status) {
            applyActivityStatusChange(queryClient, workspaceId, msg.issue_id, msg.activity_status);
          }
        } catch (err) { log.warn("消息解析失败:", err, e.data); }
      };

      ws.onclose = () => {
        if (!guard(ws)) return;
        hasDisconnected.current = true;
        log.warn(`disconnected, reconnecting in ${reconnectDelay.current}ms`);
        setStatus(prev => prev === "error" ? "error" : "disconnected");
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
          connect();
        }, reconnectDelay.current);
      };

      ws.onerror = () => { log.error("error"); setStatus("error"); ws.close(); };
      activeWs = ws;
      wsRef.current = ws;
    }

    connect();
    return () => {
      mounted = false;
      clearTimer(reconnectTimer);
      if (activeWs) { const ws = activeWs; activeWs = null; if (wsRef.current === ws) wsRef.current = null; ws.close(); }
    };
  }, [workspaceId, queryClient]);

  return status;
}
