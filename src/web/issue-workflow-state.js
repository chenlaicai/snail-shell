/** 允许打回到 design 的 stage 类型。 */
const BOUNCE_TO_DESIGN_SOURCES = ["development", "review"];

/** 允许打回到 review 的 stage 类型。 */
const BOUNCE_TO_REVIEW_SOURCES = ["merge"];

export function canRestartIssueDevelopment(issue, stage) {
  if (!issue || !stage) return false;
  if (issue.current_stage?.id && issue.current_stage.id !== stage.id) return false;
  if (stage.type === "design" && stage.status === "in_progress") return true;
  // development/review completed → can bounce back to design
  if (BOUNCE_TO_DESIGN_SOURCES.includes(stage.type) && stage.status === "completed" && !issue.closed_at) return true;
  // merge completed → can bounce back to review
  if (BOUNCE_TO_REVIEW_SOURCES.includes(stage.type) && stage.status === "completed" && !issue.closed_at) return true;
  return false;
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
