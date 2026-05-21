import { featureRepoContextFields, hasFeatureRepoContext } from "./feature-workflow-state.js";

/**
 * 渲染 Repository Context 卡片。现在从 stage.output_artifacts 读取而非 feature 表。
 */
export function renderRepoContextCard(input) {
  const { card, editButton, stage, readonly, escapeHtml } = input;
  if (!card) return;
  if (!stage) {
    card.innerHTML = `
      <div class="repo-context-row"><span>分支</span><code>未记录</code></div>
      <div class="repo-context-row"><span>Worktree</span><code>未记录</code></div>
      <div class="repo-context-row"><span>PR</span><code>未记录</code></div>
      <div class="meta" style="margin-top: 8px;">选择 Stage 后记录仓库上下文。</div>
    `;
    if (editButton) editButton.disabled = true;
    return;
  }
  const fields = featureRepoContextFields(stage);
  const empty = !hasFeatureRepoContext(stage);
  card.innerHTML = `
    <div class="repo-context-row"><span>分支</span><code>${escapeHtml(fields.branch_name || "未记录")}</code></div>
    <div class="repo-context-row"><span>Worktree</span><code>${escapeHtml(fields.worktree_path || "未记录")}</code></div>
    <div class="repo-context-row"><span>PR</span><code>${escapeHtml(fields.pr_url || "未记录")}</code></div>
    <div class="meta" style="margin-top: 8px;">${empty ? "完成/归档时不会猜测未记录的仓库资源。" : "完成/归档时仅清理这里记录且通过安全校验的仓库资源。"}</div>
  `;
  if (editButton) editButton.disabled = readonly;
}

/**
 * 通过 stage.output_artifacts 编辑 repo context。
 * 使用统一 key-value 方式写入 output_artifacts，不再依赖 feature/repo-context API。
 */
export async function editRepoContext(input) {
  const { stage, api, onUpdated, showNotice } = input;
  if (!stage) return;
  const current = stage.output_artifacts ?? {};
  const branchName = prompt("Feature 分支名（留空表示未记录）", current["branch_name"] || "");
  if (branchName === null) return;
  const worktreePath = prompt("Feature worktree 绝对路径（留空表示未记录）", current["worktree_path"] || "");
  if (worktreePath === null) return;
  const prUrl = prompt("Feature PR URL（留空表示未记录）", current["pr_url"] || "");
  if (prUrl === null) return;

  const updatedArtifacts = { ...current };
  const setField = (key, value) => {
    const trimmed = value.trim();
    if (trimmed) updatedArtifacts[key] = trimmed;
    else delete updatedArtifacts[key];
  };
  setField("branch_name", branchName);
  setField("worktree_path", worktreePath);
  setField("pr_url", prUrl);

  const updatedStage = await api("PATCH", `/stages/${stage.id}`, { output_artifacts: updatedArtifacts });
  onUpdated(updatedStage);
  showNotice("已记录 Stage 仓库上下文");
}
