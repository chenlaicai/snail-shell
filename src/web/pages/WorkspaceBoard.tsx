import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import { Dialog } from "../components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

const PRIORITY_BG: Record<string, string> = {
  design: "var(--color-accent-purple)",
  development: "var(--color-accent-blue)",
  review: "var(--color-warning-soft)",
  done: "var(--color-accent-cyan)",
  low: "var(--color-text-grey)",
};

const STAGE_TAG_STYLE: Record<string, React.CSSProperties> = {
  design: { background: "rgba(167, 139, 250, 0.15)", color: "var(--color-accent-purple)" },
  development: { background: "rgba(96, 165, 250, 0.12)", color: "var(--color-accent-blue)" },
  review: { background: "rgba(251, 191, 36, 0.12)", color: "var(--color-warning-soft)" },
  done: { background: "rgba(6, 182, 212, 0.12)", color: "var(--color-accent-cyan)" },
};

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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<IssueDetailDto | null>(null);

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
    if (!newTitle.trim()) { showToast("标题不能为空", true); return; }
    try {
      const result = await api("POST /api/workspaces/:workspaceId/issues", { params: { workspaceId: workspaceId! }, body: { title: newTitle.trim(), summary: newSummary.trim() } });
      setCreateDialogOpen(false);
      setNewTitle("");
      setNewSummary("");
      reload();
      navigate(`/ws/${workspaceId}/issue/${result.issue.id}`);
    } catch (err: unknown) {
      showToast(`创建 Issue 失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  function confirmArchive(issue: IssueDetailDto) {
    if (issue.closed_at) return;
    setArchiveTarget(issue);
    setArchiveDialogOpen(true);
  }

  async function handleArchiveIssue() {
    if (!archiveTarget) return;
    const issueId = archiveTarget.id;
    try {
      await api("POST /api/issues/:issueId/archive", { params: { issueId } });
      showToast("Issue 已归档");
      setArchiveDialogOpen(false);
      setArchiveTarget(null);
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

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;
  if (!workspace) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">工作区不存在</div>;

  const groups: Record<string, IssueDetailDto[]> = { pending: [], in_progress: [], completed: [] };
  for (const issue of workspace.issues ?? []) {
    groups[classifyIssue(issue)].push(issue);
  }

  const activeCount = groups.pending.length + groups.in_progress.length;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="workspaces">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{workspace.name}</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{activeCount} 个 Issue</span>
          </div>
          <div className="flex gap-1.5">
            <button className="flex items-center gap-[5px] py-[5px] px-2.5 rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-bg-elevated)] text-[var(--color-accent)] text-[11px] cursor-pointer transition-all duration-120 hover:bg-[rgba(108,141,250,0.08)]" onClick={() => setCreateDialogOpen(true)}>
              + 新 Issue
            </button>
            <button className="flex items-center gap-[5px] py-[5px] px-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border-muted)] bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] text-[11px] cursor-pointer transition-all duration-120 hover:border-[var(--color-border-default)] hover:text-[var(--color-text-primary)]" onClick={handleReloadConfig}>
              刷新配置
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 px-6 grid grid-cols-1 lg:grid-cols-3 gap-5 items-start [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--color-border-muted)] [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb:hover]:bg-[var(--color-border-default)]">
          {STATUS_GROUPS.map((group) => (
            <div key={group.key} className="min-w-0">
              <div className="flex items-center gap-2 py-1.5 mb-2.5 sticky top-0 bg-[var(--color-bg-base)] z-10">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">{group.label}</span>
                <span className="text-[10px] text-[var(--color-text-grey)] ml-0.5">{groups[group.key].length}</span>
                <span className="flex-1 h-px bg-[var(--color-border-muted)]" />
              </div>
              {groups[group.key].map((issue) => (
                <TaskCard
                  key={issue.id}
                  issue={issue}
                  onClick={() => navigate(`/ws/${workspaceId}/issue/${issue.id}`)}
                  onArchive={() => confirmArchive(issue)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} title="新建 Issue">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm, 8px)" }}>
          <Input
            placeholder="Issue 标题"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
          />
          <Textarea
            placeholder="Issue 摘要（可选）"
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
            rows={3}
          />
          <div style={{ display: "flex", gap: "var(--space-sm, 8px)", justifyContent: "flex-end" }}>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>取消</Button>
            <Button onClick={handleCreateIssue}>创建</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={archiveDialogOpen} onClose={() => setArchiveDialogOpen(false)} title="归档 Issue">
        <p style={{ margin: "0 0 var(--space-md, 12px)" }}>
          确定归档 Issue「{archiveTarget?.title}」？
        </p>
        <div style={{ display: "flex", gap: "var(--space-sm, 8px)", justifyContent: "flex-end" }}>
          <Button variant="outline" onClick={() => setArchiveDialogOpen(false)}>取消</Button>
          <Button variant="destructive" onClick={handleArchiveIssue}>归档</Button>
        </div>
      </Dialog>
    </div>
  );
}

function TaskCard({ issue, onClick, onArchive }: { issue: IssueDetailDto; onClick: () => void; onArchive: () => void }) {
  const waitStr = formatWaitTime(issue.current_stage?.created_at || issue.created_at);
  const isCompleted = !!issue.closed_at;
  const priorityKey = stageTagClass(issue) || "low";
  const stageKey = stageTagClass(issue);

  return (
    <div
      className={`task-card flex gap-2.5 py-3 px-3.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] mb-1.5 cursor-pointer transition-all duration-150 relative hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-active)]${isCompleted ? " opacity-60 border-transparent bg-[rgba(8,15,28,0.88)] hover:opacity-90 data-[completed]:hover:opacity-85" : ""}`}
      data-completed={isCompleted ? "true" : undefined}
      onClick={onClick}
    >
      {isCompleted ? (
        <div className="w-4 h-4 rounded-full bg-[rgba(6,182,212,0.12)] border-[1.5px] border-[var(--color-accent-cyan)] flex items-center justify-center shrink-0 mt-0.5 [&_svg]:w-2.5 [&_svg]:h-2.5 [&_svg]:stroke-[var(--color-accent-cyan)]">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      ) : (
        <div
          className="w-[3px] rounded-sm shrink-0 self-stretch"
          style={{ background: PRIORITY_BG[priorityKey], opacity: priorityKey === "done" ? 0.4 : undefined }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`task-title text-[13px] font-semibold text-[var(--color-text-primary)] flex-1 whitespace-nowrap overflow-hidden text-ellipsis${isCompleted ? " !text-[var(--color-text-muted)]" : ""}`}>{issue.title}</span>
          <span className="text-[10px] text-[var(--color-text-grey)] font-mono shrink-0">#{issue.id.slice(-6)}</span>
        </div>
        {!isCompleted && issue.summary && (
          <div className="text-xs text-[var(--color-text-muted)] leading-normal mb-2 line-clamp-2">{issue.summary}</div>
        )}
        <div className="flex items-center gap-2.5 text-[11px] text-[var(--color-text-grey)]">
          <span
            className="text-[9px] py-px px-1 rounded-[3px] font-medium"
            style={STAGE_TAG_STYLE[stageKey]}
          >{stageLabel(issue)}</span>
          {!isCompleted && (
            <button
              className="issue-archive-button"
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
            >
              归档
            </button>
          )}
          {isCompleted ? (
            <span className="text-[10px] text-[var(--color-text-grey)]">
              {new Date(issue.closed_at!).getMonth() + 1} 月 {new Date(issue.closed_at!).getDate()} 日
            </span>
          ) : (
            <>
              {waitStr && (
                <span className="flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  <span>等待 {waitStr}</span>
                </span>
              )}
              {issue.current_stage?.active_roles?.[0] && (
                <span className="flex items-center gap-1">
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
