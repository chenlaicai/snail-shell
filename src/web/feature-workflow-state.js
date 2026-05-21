export function canRestartFeatureDevelopment(feature, stage) {
  if (!feature || !stage) return false;
  if (feature.current_stage?.id && feature.current_stage.id !== stage.id) return false;
  if (stage.type === "development" && stage.status === "in_progress") return true;
  return feature.status === "waiting_merge" && stage.type === "review" && stage.status === "completed";
}

/**
 * 从 stage 的 output_artifacts Record 中提取 repo context 字段。
 * 替代之前直接读取 feature.branch_name / worktree_path / pr_url 的方式。
 */
export function featureRepoContextFields(stage) {
  const artifacts = stage?.output_artifacts ?? {};
  return {
    branch_name: artifacts["branch_name"] || "",
    worktree_path: artifacts["worktree_path"] || "",
    pr_url: artifacts["pr_url"] || "",
  };
}

export function hasFeatureRepoContext(stage) {
  const fields = featureRepoContextFields(stage);
  return Boolean(fields.branch_name || fields.worktree_path || fields.pr_url);
}
