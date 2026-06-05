import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import type { WorkspaceDetailDto, IssueDetailDto } from "../../types";

const STATUS_GROUPS = [
  { key: "pending", label: "待处理" },
  { key: "in_progress", label: "AI 工作中" },
  { key: "completed", label: "已完成" },
];

function classifyIssue(issue: IssueDetailDto): string {
  if (issue.closed_at) return "completed";
  if (issue.current_stage?.status === "in_progress") return "in_progress";
  return "pending";
}

function stageTagClass(issue: IssueDetailDto): string {
  const type = issue.current_stage?.type;
  if (type === "design") return "design";
  if (type === "development") return "development";
  if (type === "review") return "review";
  if (issue.closed_at) return "done";
  return "";
}

function stageLabel(issue: IssueDetailDto): string {
  const type = issue.current_stage?.type;
  if (type === "design") return "design";
  if (type === "development") return "development";
  if (type === "review") return "review";
  if (issue.closed_at) return "done";
  return "pending";
}

function formatWaitTime(dateStr?: string): string {
  if (!dateStr) return "";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  if (diffMs < 0) return "";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

export function WorkspaceBoard() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<WorkspaceDetailDto | null>(null);
  const [loading, setLoading] = useState(true);

  function reload() {
    if (!workspaceId) return;
    setLoading(true);
    api("GET /api/workspaces/:workspaceId", { params: { workspaceId: workspaceId! } })
      .then(setWorkspace)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, [workspaceId]);

  async function handleCreateIssue() {
    if (!workspaceId) return;
    const title = prompt("Issue 标题")?.trim();
    if (!title) return;
    const summary = prompt("Issue 摘要（可选）") || "";
    try {
      const result = await api("POST /api/workspaces/:workspaceId/issues", { params: { workspaceId: workspaceId! }, body: { title, summary } });
      reload();
      navigate(`/ws/${workspaceId}/issue/${result.issue.id}`);
    } catch (err: unknown) {
      showToast(`创建 Issue 失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  async function handleArchiveIssue(issueId: string) {
    const issue = workspace?.issues.find((i) => i.id === issueId);
    if (!issue || issue.closed_at) return;
    if (!confirm(`归档 Issue「${issue.title}」？`)) return;
    try {
      await api("POST /api/issues/:issueId/archive", { params: { issueId } });
      showToast("Issue 已归档");
      reload();
    } catch (err: unknown) {
      showToast(`归档失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  async function handleReloadConfig() {
    if (!workspaceId) return;
    try {
      await api("POST /api/workspaces/:workspaceId/load-snail", { params: { workspaceId: workspaceId! } });
      showToast("已从 .snail 目录重新加载配置");
      reload();
    } catch (err: unknown) {
      showToast(`加载失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  if (loading) return <div className="task-board-empty">加载中...</div>;
  if (!workspace) return <div className="task-board-empty">工作区不存在</div>;

  const groups: Record<string, IssueDetailDto[]> = { pending: [], in_progress: [], completed: [] };
  for (const issue of workspace.issues ?? []) {
    groups[classifyIssue(issue)].push(issue);
  }

  const activeCount = groups.pending.length + groups.in_progress.length;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="workspaces">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">{workspace.name}</span>
            <span className="board-subtitle">{activeCount} 个 Issue</span>
          </div>
          <div className="board-actions">
            <button className="board-btn board-btn-primary" onClick={handleCreateIssue}>
              + 新 Issue
            </button>
            <button className="board-btn" onClick={handleReloadConfig}>
              刷新配置
            </button>
          </div>
        </div>
        <div className="task-list">
          {STATUS_GROUPS.map((group) => (
            <div key={group.key} className="task-group">
              <div className="task-group-header">
                <span className="task-group-title">{group.label}</span>
                <span className="task-group-count">{groups[group.key].length}</span>
                <span className="task-group-line" />
              </div>
              {groups[group.key].map((issue) => (
                <TaskCard
                  key={issue.id}
                  issue={issue}
                  onClick={() => navigate(`/ws/${workspaceId}/issue/${issue.id}`)}
                  onArchive={() => handleArchiveIssue(issue.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskCard({ issue, onClick, onArchive }: { issue: IssueDetailDto; onClick: () => void; onArchive: () => void }) {
  const waitStr = formatWaitTime(issue.current_stage?.created_at || issue.created_at);

  return (
    <div className={`task-card${issue.closed_at ? " completed" : ""}`} onClick={onClick}>
      {issue.closed_at ? (
        <div className="task-completed-check">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      ) : (
        <div className={`task-priority ${stageTagClass(issue) || "low"}`} />
      )}
      <div className="task-body">
        <div className="task-top-row">
          <span className="task-title">{issue.title}</span>
          <span className="task-id">#{issue.id.slice(-6)}</span>
        </div>
        {!issue.closed_at && issue.summary && (
          <div className="task-summary">{issue.summary}</div>
        )}
        <div className="task-meta">
          <span className={`task-stage-tag ${stageTagClass(issue)}`}>{stageLabel(issue)}</span>
          {!issue.closed_at && (
            <button
              className="issue-archive-button"
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
            >
              归档
            </button>
          )}
          {issue.closed_at ? (
            <span className="task-time">
              {new Date(issue.closed_at).getMonth() + 1} 月 {new Date(issue.closed_at).getDate()} 日
            </span>
          ) : (
            <>
              {waitStr && (
                <span className="task-meta-item">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  <span>等待 {waitStr}</span>
                </span>
              )}
              {issue.current_stage?.active_roles?.[0] && (
                <span className="task-meta-item">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  <span>{issue.current_stage.active_roles[0]}</span>
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
