export function canRestartFeatureDevelopment(feature, stage) {
  if (!feature || !stage) return false;
  if (feature.current_stage?.id && feature.current_stage.id !== stage.id) return false;
  if (stage.type === "development" && stage.status === "in_progress") return true;
  return feature.status === "waiting_merge" && stage.type === "review" && stage.status === "completed";
}

/**
 * 从 stage 的 output_artifacts Record 中提取 repo context 字段。
 * 现在返回完整的 output_artifacts map，不再硬编码三个字段。
 * 保留 branch_name/worktree_path/pr_url 的提取用于兼容旧调用。
 */
export function featureRepoContextFields(stage) {
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
 * 用于渲染完整的 Feature Context 卡片。
 */
export function featureAllArtifacts(stage) {
  const artifacts = stage?.output_artifacts ?? {};
  if (typeof artifacts !== "object") return {};
  return artifacts;
}

export function hasFeatureRepoContext(stage) {
  const artifacts = stage?.output_artifacts ?? {};
  if (typeof artifacts !== "object") return false;
  return Object.keys(artifacts).length > 0;
}
