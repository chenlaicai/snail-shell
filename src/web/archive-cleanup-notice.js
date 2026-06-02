/**
 * Issue 归档清理通知构建工具。
 * 从 app.js 中提取，保持 app.js 行数在限制内。
 */

export function buildArchiveCleanupNotice(cleanup) {
  if (!cleanup?.steps?.length) return "Issue 已归档";
  const removed = cleanup.steps.filter((step) => step.status === "removed").map(cleanupStepLabel);
  const failed = cleanup.steps.filter((step) => step.status === "failed").map((step) => `${cleanupStepLabel(step)}：${step.message}`);
  if (failed.length > 0) return `Issue 已归档，清理未完全完成：${failed.join("；")}`;
  if (removed.length > 0) return `Issue 已归档，已清理${removed.join("、")}`;
  return "Issue 已归档，无需清理已记录的仓库资源";
}

function cleanupStepLabel(step) {
  return step.target === "worktree" ? "worktree" : "本地分支";
}
