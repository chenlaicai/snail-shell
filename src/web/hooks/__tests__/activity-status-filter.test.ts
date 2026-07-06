import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { EventBatcher } from "../useWebSocket";
import { applyActivityStatusChange } from "../useWorkspaceRealtime";
import { queryKeys } from "../../queries/keys";
import type { IssueDetailDto, WsServerMessage, ActivityStatus } from "../../types";

function createIssueDetail(overrides: Partial<IssueDetailDto> = {}): IssueDetailDto {
  return {
    id: "issue-1",
    title: "Test Issue",
    workspace_id: "ws-1",
    workspace_path: "/test",
    status: "open",
    activity_status: "ai_running",
    closed_at: null,
    close_summary: null,
    current_stage_id: "stage-1",
    sop_id: "sop-1",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    stages: [],
    current_stage: {
      id: "stage-1",
      issue_id: "issue-1",
      key: "design",
      title: "Design",
      status: "active",
      sequence: 1,
      created_at: "2026-07-01T00:00:00Z",
    },
    ...overrides,
  } as IssueDetailDto;
}

/**
 * 创建携带 activity_status 的 WsServerMessage。
 * activity_status 是 IssueRealtimeMessage 的顶层字段，每条 issue-level WS 消息都携带。
 */
function createWsMessage(
  issueId: string,
  activityStatus: ActivityStatus,
): WsServerMessage {
  return {
    type: "issue_event",
    issue_id: issueId,
    activity_status: activityStatus,
    event: {
      type: "message_started",
      stage_id: "stage-1",
      message_id: 1,
      role: "assistant",
      role_name: "developer",
      client_id: null,
      status: "streaming",
    },
  } as WsServerMessage;
}

describe("EventBatcher.applyActivityStatus — closed_at 过滤", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("issue 已有 closed_at 时，跳过 activity_status 更新（detail cache）", () => {
    const issueId = "issue-1";
    const issue = createIssueDetail({ closed_at: "2026-07-03T12:00:00Z", activity_status: "ai_running" });
    queryClient.setQueryData(queryKeys.issues.detail(issueId), issue);

    const batcher = new EventBatcher(queryClient);
    batcher.add(createWsMessage(issueId, "completed"));

    // 手动 flush（通过 dispose 触发）
    batcher.dispose();

    const updated = queryClient.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
    // activity_status 不应被更新为 completed
    expect(updated?.activity_status).toBe("ai_running");
  });

  it("issue 已有 closed_at 时，跳过 activity_status 更新（workspace list cache）", () => {
    const issueId = "issue-1";
    const workspaceId = "ws-1";
    const issue = createIssueDetail({ closed_at: "2026-07-03T12:00:00Z", activity_status: "ai_running" });
    queryClient.setQueryData(queryKeys.issues.detail(issueId), issue);
    queryClient.setQueryData(queryKeys.workspaces.issues(workspaceId), [issue]);

    const batcher = new EventBatcher(queryClient);
    batcher.add(createWsMessage(issueId, "completed"));
    batcher.dispose();

    const list = queryClient.getQueryData<IssueDetailDto[]>(queryKeys.workspaces.issues(workspaceId));
    expect(list?.[0].activity_status).toBe("ai_running");
  });

  it("issue 无 closed_at 时，正常更新 activity_status（detail cache）", () => {
    const issueId = "issue-1";
    const issue = createIssueDetail({ closed_at: null, activity_status: "ai_running" });
    queryClient.setQueryData(queryKeys.issues.detail(issueId), issue);

    const batcher = new EventBatcher(queryClient);
    batcher.add(createWsMessage(issueId, "completed"));
    batcher.dispose();

    const updated = queryClient.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
    expect(updated?.activity_status).toBe("completed");
  });

  it("detail cache 不存在时，updater 为 no-op（不写入数据）", () => {
    const issueId = "issue-1";

    const batcher = new EventBatcher(queryClient);
    batcher.add(createWsMessage(issueId, "completed"));
    batcher.dispose();

    // detail cache 不存在，currentDetail?.closed_at 为 undefined（falsy），不触发跳过
    // 但 setQueryData 的 updater 返回 old（undefined）=> undefined，不写入有效数据
    const detail = queryClient.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
    expect(detail).toBeUndefined();
  });
});

describe("applyActivityStatusChange — closed_at 过滤", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("issue 已有 closed_at 时，跳过 activity_status 更新", () => {
    const issueId = "issue-1";
    const workspaceId = "ws-1";
    const issue = createIssueDetail({ closed_at: "2026-07-03T12:00:00Z", activity_status: "ai_running" });
    queryClient.setQueryData(queryKeys.issues.detail(issueId), issue);
    queryClient.setQueryData(queryKeys.workspaces.issues(workspaceId), [issue]);

    applyActivityStatusChange(queryClient, workspaceId, issueId, "completed");

    const detail = queryClient.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
    expect(detail?.activity_status).toBe("ai_running");

    const list = queryClient.getQueryData<IssueDetailDto[]>(queryKeys.workspaces.issues(workspaceId));
    expect(list?.[0].activity_status).toBe("ai_running");
  });

  it("issue 无 closed_at 时，正常更新 activity_status", () => {
    const issueId = "issue-1";
    const workspaceId = "ws-1";
    const issue = createIssueDetail({ closed_at: null, activity_status: "ai_running" });
    queryClient.setQueryData(queryKeys.issues.detail(issueId), issue);
    queryClient.setQueryData(queryKeys.workspaces.issues(workspaceId), [issue]);

    applyActivityStatusChange(queryClient, workspaceId, issueId, "completed");

    const detail = queryClient.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
    expect(detail?.activity_status).toBe("completed");

    const list = queryClient.getQueryData<IssueDetailDto[]>(queryKeys.workspaces.issues(workspaceId));
    expect(list?.[0].activity_status).toBe("completed");
  });

  it("detail cache 不存在时，updater 为 no-op（不写入数据）", () => {
    const issueId = "issue-1";
    const workspaceId = "ws-1";

    applyActivityStatusChange(queryClient, workspaceId, issueId, "completed");

    // detail cache 不存在，currentDetail?.closed_at 为 undefined（falsy），不触发跳过
    // 但 setQueryData 的 updater 返回 old（undefined）=> undefined，不写入有效数据
    const detail = queryClient.getQueryData<IssueDetailDto>(queryKeys.issues.detail(issueId));
    expect(detail).toBeUndefined();
  });
});
