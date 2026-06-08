/**
 * IssueBoard — 看板视图
 *
 * 灵感来源 Linear 的 issue board：左侧导航 + 右侧看板列
 * 支持 Backlog / Todo / In Progress / Done 四列
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { issueQueries } from "../queries/issue.queries";
import { Button } from "@/components/ui/button";
import { StatusBadge, type IssueStatus } from "@/components/ui/status-badge";
import { PriorityIndicator } from "@/components/ui/priority";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Issue, Stage, StageStatus } from "@/issue/types.js";

// ─── 看板列定义 ─────────────────────────────────────────

const columns: { status: IssueStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "todo", label: "Todo" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

// ─── 模拟数据（真实 API 接入前用于展示） ─────────────────

const MOCK_WORKSPACE_ID = "ws-001";

interface MockIssue extends Issue {
  priority: "urgent" | "high" | "medium" | "low" | "none";
  assignees: string[];
  labels: string[];
  stageStatus: StageStatus | null;
  stageTitle: string | null;
  issueNumber: string;
  boardStatus: IssueStatus;
}

const mockIssues: MockIssue[] = [
  {
    id: "iss-001", workspace_id: MOCK_WORKSPACE_ID, title: "优化 Agent 上下文窗口管理",
    summary: "当前上下文截断策略过于简单，需要智能摘要机制",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-06-07T10:00:00Z", updated_at: "2026-06-08T08:30:00Z",
    priority: "high", assignees: ["Agent-Arch", "Dev-Lead"],
    labels: ["architecture", "performance"], stageStatus: "in_progress",
    stageTitle: "设计阶段", issueNumber: "SS-142", boardStatus: "in_progress",
  },
  {
    id: "iss-002", workspace_id: MOCK_WORKSPACE_ID, title: "实现 SOP 版本回滚功能",
    summary: "支持将 SOP 回滚到指定历史版本",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-06-06T14:00:00Z", updated_at: "2026-06-08T07:00:00Z",
    priority: "medium", assignees: ["Backend-Dev"],
    labels: ["feature"], stageStatus: null, stageTitle: null,
    issueNumber: "SS-141", boardStatus: "todo",
  },
  {
    id: "iss-003", workspace_id: MOCK_WORKSPACE_ID, title: "Conversation 事件流增加重试机制",
    summary: "WebSocket 断连后事件流丢失，需要持久化 + 重放",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-06-05T09:00:00Z", updated_at: "2026-06-07T16:00:00Z",
    priority: "urgent", assignees: ["Agent-Arch"],
    labels: ["bug", "reliability"], stageStatus: "in_progress",
    stageTitle: "实现阶段", issueNumber: "SS-140", boardStatus: "in_progress",
  },
  {
    id: "iss-004", workspace_id: MOCK_WORKSPACE_ID, title: "添加 Workspace 成员管理 API",
    summary: "支持邀请、移除成员，以及角色权限配置",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-06-04T11:00:00Z", updated_at: "2026-06-06T10:00:00Z",
    priority: "medium", assignees: ["Backend-Dev", "Dev-Lead"],
    labels: ["feature", "api"], stageStatus: null, stageTitle: null,
    issueNumber: "SS-139", boardStatus: "todo",
  },
  {
    id: "iss-005", workspace_id: MOCK_WORKSPACE_ID, title: "UI: Dark Mode 主题变量统一",
    summary: "将散落的颜色值收敛到 CSS 变量体系",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-06-03T08:00:00Z", updated_at: "2026-06-05T14:00:00Z",
    priority: "low", assignees: ["Frontend-Dev"],
    labels: ["ui", "refactor"], stageStatus: null, stageTitle: null,
    issueNumber: "SS-138", boardStatus: "backlog",
  },
  {
    id: "iss-006", workspace_id: MOCK_WORKSPACE_ID, title: "MCP Server 热重载支持",
    summary: "修改 MCP 配置后无需重启即可生效",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-06-02T15:00:00Z", updated_at: "2026-06-04T09:00:00Z",
    priority: "medium", assignees: ["Agent-Arch"],
    labels: ["feature", "dx"], stageStatus: "completed",
    stageTitle: "验收阶段", issueNumber: "SS-137", boardStatus: "done",
  },
  {
    id: "iss-007", workspace_id: MOCK_WORKSPACE_ID, title: "Stage Gate 验证逻辑增强",
    summary: "支持自定义验证脚本和外部 API 回调",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-06-01T10:00:00Z", updated_at: "2026-06-03T12:00:00Z",
    priority: "high", assignees: ["Backend-Dev"],
    labels: ["feature", "sop"], stageStatus: null, stageTitle: null,
    issueNumber: "SS-136", boardStatus: "backlog",
  },
  {
    id: "iss-008", workspace_id: MOCK_WORKSPACE_ID, title: "修复消息排序在并发场景下的竞态问题",
    summary: "高并发时 seq 排序偶尔错乱",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-05-30T16:00:00Z", updated_at: "2026-06-02T11:00:00Z",
    priority: "high", assignees: ["Backend-Dev", "Agent-Arch"],
    labels: ["bug"], stageStatus: "completed", stageTitle: "已完成",
    issueNumber: "SS-135", boardStatus: "done",
  },
  {
    id: "iss-009", workspace_id: MOCK_WORKSPACE_ID, title: "集成 GitHub Webhook 自动创建 Issue",
    summary: "监听 PR / Issue 事件自动在 workspace 创建对应工作项",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-05-28T09:00:00Z", updated_at: "2026-06-01T15:00:00Z",
    priority: "low", assignees: [],
    labels: ["feature", "integration"], stageStatus: null, stageTitle: null,
    issueNumber: "SS-134", boardStatus: "backlog",
  },
  {
    id: "iss-010", workspace_id: MOCK_WORKSPACE_ID, title: "Agent 间协作协议文档编写",
    summary: "为 snail agent 间的通信协议编写开发者文档",
    sop_snapshot: {} as never, role_snail_mapping: {},
    created_at: "2026-05-25T14:00:00Z", updated_at: "2026-05-30T10:00:00Z",
    priority: "none", assignees: ["Agent-Arch"],
    labels: ["docs"], stageStatus: null, stageTitle: null,
    issueNumber: "SS-133", boardStatus: "backlog",
  },
];

// ─── 主页面 ─────────────────────────────────────────────

export function IssueBoard() {
  const navigate = useNavigate();
  const [activeWorkspace] = useState(MOCK_WORKSPACE_ID);
  const [filter, setFilter] = useState("");

  // 真实 API: const { data: issues = [], isLoading } = useQuery(issueQueries.list(activeWorkspace));
  const issues = mockIssues;
  const isLoading = false;

  const filtered = filter
    ? issues.filter(
        (i) =>
          i.title.toLowerCase().includes(filter.toLowerCase()) ||
          i.issueNumber.toLowerCase().includes(filter.toLowerCase())
      )
    : issues;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">
        加载中...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="issue-board">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
        <div className="flex items-baseline gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Issues</span>
          <span className="text-[11px] text-[var(--color-text-grey)]">{issues.length} 项</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter issues..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 w-48 rounded-md border border-[var(--color-border-muted)] bg-[var(--color-bg-surface)] px-2.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-grey)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <Button size="sm" className="h-7 text-xs">
            + New Issue
          </Button>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-4 min-h-0">
        <div className="flex gap-3 h-full min-w-max">
          {columns.map((col) => {
            const columnIssues = filtered.filter((i) => i.boardStatus === col.status);
            return (
              <BoardColumn
                key={col.status}
                label={col.label}
                status={col.status}
                count={columnIssues.length}
                issues={columnIssues}
                onIssueClick={(id) => navigate(`/issues/${id}`)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── 看板列 ─────────────────────────────────────────────

function BoardColumn({
  label,
  status,
  count,
  issues,
  onIssueClick,
}: {
  label: string;
  status: IssueStatus;
  count: number;
  issues: MockIssue[];
  onIssueClick: (id: string) => void;
}) {
  return (
    <div className="flex flex-col w-[300px] shrink-0">
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 pb-2 mb-1">
        <StatusBadge status={status} />
        <span className="text-[11px] text-[var(--color-text-grey)]">{count}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} onClick={() => onIssueClick(issue.id)} />
        ))}
        {issues.length === 0 && (
          <div className="text-center text-[11px] text-[var(--color-text-grey)] py-8">
            No issues
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Issue 卡片 ─────────────────────────────────────────

function IssueCard({ issue, onClick }: { issue: MockIssue; onClick: () => void }) {
  return (
    <div
      className="group rounded-lg border border-[var(--color-border-muted)] bg-[var(--color-bg-surface)] p-3 cursor-pointer transition-colors hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-bg-elevated)]"
      onClick={onClick}
    >
      {/* Top row: number + priority */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] text-[var(--color-text-grey)] font-mono">{issue.issueNumber}</span>
        <PriorityIndicator priority={issue.priority} />
        {issue.labels.length > 0 && (
          <div className="flex gap-1 ml-auto">
            {issue.labels.slice(0, 2).map((label) => (
              <Badge key={label} variant="outline" className="text-[9px] px-1.5 py-0 border-[var(--color-border-muted)] text-[var(--color-text-grey)]">
                {label}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Title */}
      <div className="text-[13px] font-medium text-[var(--color-text-primary)] mb-2 line-clamp-2 leading-snug">
        {issue.title}
      </div>

      {/* Stage indicator */}
      {issue.stageTitle && (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
          <span className="text-[10px] text-[var(--color-text-grey)]">{issue.stageTitle}</span>
        </div>
      )}

      {/* Bottom row: assignees */}
      <div className="flex items-center justify-between">
        {issue.assignees.length > 0 ? (
          <AvatarGroup names={issue.assignees} max={2} size="sm" />
        ) : (
          <span className="text-[10px] text-[var(--color-text-grey)]">Unassigned</span>
        )}
        <span className="text-[10px] text-[var(--color-text-grey)] opacity-0 group-hover:opacity-100 transition-opacity">
          {formatRelativeTime(issue.updated_at)}
        </span>
      </div>
    </div>
  );
}

// ─── 工具函数 ───────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
