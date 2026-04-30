import { featureRepoContextFields, hasFeatureRepoContext } from "./feature-workflow-state.js";

export function renderRepoContextCard(input) {
  const { card, editButton, feature, readonly, escapeHtml } = input;
  if (!card) return;
  if (!feature) {
    card.innerHTML = '<div class="meta">选择 Feature 后记录分支、worktree 和 PR，用于完成后安全清理。</div>';
    if (editButton) editButton.disabled = true;
    return;
  }
  const fields = featureRepoContextFields(feature);
  const empty = !hasFeatureRepoContext(feature);
  card.innerHTML = `
    <div class="repo-context-row"><span>分支</span><code>${escapeHtml(fields.branch_name || "未记录")}</code></div>
    <div class="repo-context-row"><span>Worktree</span><code>${escapeHtml(fields.worktree_path || "未记录")}</code></div>
    <div class="repo-context-row"><span>PR</span><code>${escapeHtml(fields.pr_url || "未记录")}</code></div>
    <div class="meta" style="margin-top: 8px;">${empty ? "完成/归档时不会猜测未记录的仓库资源。" : "完成/归档时仅清理这里记录且通过安全校验的仓库资源。"}</div>
  `;
  if (editButton) editButton.disabled = readonly;
}

export async function editRepoContext(input) {
  const { feature, api, onUpdated, showNotice } = input;
  if (!feature) return;
  const current = featureRepoContextFields(feature);
  const branchName = prompt("Feature 分支名（留空表示未记录）", current.branch_name);
  if (branchName === null) return;
  const worktreePath = prompt("Feature worktree 绝对路径（留空表示未记录）", current.worktree_path);
  if (worktreePath === null) return;
  const prUrl = prompt("Feature PR URL（留空表示未记录）", current.pr_url);
  if (prUrl === null) return;
  const updatedFeature = await api("PATCH", `/features/${feature.id}/repo-context`, {
    branch_name: branchName.trim(),
    worktree_path: worktreePath.trim(),
    pr_url: prUrl.trim(),
  });
  onUpdated(updatedFeature);
  showNotice("已记录 Feature 仓库上下文");
}
