export function canRestartFeatureDevelopment(feature, stage) {
  if (!feature || !stage) return false;
  if (feature.current_stage?.id && feature.current_stage.id !== stage.id) return false;
  if (stage.type === "development" && stage.status === "in_progress") return true;
  return feature.status === "waiting_merge" && stage.type === "review" && stage.status === "completed";
}
