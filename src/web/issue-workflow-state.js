/**
 * 从 SOP 转移图判断当前 stage 是否有可用出边。
 * @param {object} issue - Issue 对象，需包含 adopted_sop_id
 * @param {object} stage - 当前 Stage 对象
 * @param {Array} transitions - SOP 转移边列表（从 GET /sops/:sopId 获取）
 */
export function canTransitionFrom(issue, stage, transitions) {
  if (!issue || !stage || !transitions) return false;
  if (issue.closed_at) return false;
  return transitions.some((t) => t.from_stage_key === stage.type);
}

/**
 * 从 stage 的 output_artifacts Record 中提取 repo context 字段。
 * 现在返回完整的 output_artifacts map，不再硬编码三个字段。
 * 保留 branch_name/worktree_path/pr_url 的提取用于兼容旧调用。
 */
export function issueRepoContextFields(stage) {
  const artifacts = stage?.output_artifacts ?? {};
  return {
    ...artifacts,
    branch_name: artifacts["branch_name"] || "",
    worktree_path: artifacts["worktree_path"] || "",
    pr_url: artifacts["pr_url"] || "",
  };
}

/**
 * 返回 output_artifacts 中所有独立的 key-value 对。
 * 用于渲染完整的 Issue Context 卡片。
 */
export function issueAllArtifacts(stage) {
  const artifacts = stage?.output_artifacts ?? {};
  if (typeof artifacts !== "object") return {};
  return artifacts;
}

export function hasIssueRepoContext(stage) {
  const artifacts = stage?.output_artifacts ?? {};
  if (typeof artifacts !== "object") return false;
  return Object.keys(artifacts).length > 0;
}
