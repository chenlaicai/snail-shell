export function canRestartFeatureDevelopment(feature, stage) {
  if (!feature || !stage) return false;
  if (feature.current_stage?.id && feature.current_stage.id !== stage.id) return false;
  if (stage.type === "development" && stage.status === "in_progress") return true;
  return feature.status === "waiting_merge" && stage.type === "review" && stage.status === "completed";
}

export function featureRepoContextFields(feature) {
  return {
    branch_name: feature?.branch_name || "",
    worktree_path: feature?.worktree_path || "",
    pr_url: feature?.pr_url || "",
  };
}

export function hasFeatureRepoContext(feature) {
  const fields = featureRepoContextFields(feature);
  return Boolean(fields.branch_name || fields.worktree_path || fields.pr_url);
}
