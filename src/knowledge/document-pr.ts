import { execFileSync } from "child_process";
import path from "path";
import { logger } from "../logger";
import type { ConversationStore, KnowledgeChangeRequest } from "../persistence/store";

export interface KnowledgePrStatus {
  merged: boolean;
  closed: boolean;
  latestCommitSha?: string | null;
  mergeCommitSha?: string | null;
}

export interface KnowledgeDocumentPrOptions {
  dryRun: boolean;
  worktreesRoot?: string | null;
  prStatusResolver?: ((request: KnowledgeChangeRequest) => KnowledgePrStatus | null) | null;
}

export function createKnowledgeDocumentPullRequest(input: { store: ConversationStore; repoRoot: string; requestId: string; options: KnowledgeDocumentPrOptions }): void {
  /**
   * 审批后的 PR 创建是系统工作流责任，而不是交给某个 snail 手工补做。
   * review/merge 和部署重启仍由人卡点，但把 pending 草稿推进成可检视 PR 必须在审批路径内自动触发，
   * 否则知识会停在 pending_document，无法形成用户可执行的闭环。
   */
  const args = [path.join(process.cwd(), ".meta", "scripts", "knowledge-doc-pr"), "--request-id", input.requestId, "--db-path", input.store.databasePath(), "--repo-root", input.repoRoot];
  if (input.options.worktreesRoot) args.push("--worktrees-root", input.options.worktreesRoot);
  if (input.options.dryRun) args.push("--dry-run");
  execFileSync(args[0]!, args.slice(1), { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function refreshKnowledgeDocumentPrStates(input: { store: ConversationStore; repoRoot: string; options: KnowledgeDocumentPrOptions }): void {
  for (const request of input.store.listKnowledgeChangeRequests()) {
    if (!shouldRefreshPrStatus(request)) continue;
    const status = readKnowledgeDocumentPrStatus({ repoRoot: input.repoRoot, request, resolver: input.options.prStatusResolver ?? null });
    if (!status) continue;
    persistPrStatus(input.store, request, status);
  }
}

function shouldRefreshPrStatus(request: KnowledgeChangeRequest): boolean {
  return Boolean(request.pr_url || request.pr_number) && request.pr_state !== "merged" && request.pr_state !== "closed";
}

function persistPrStatus(store: ConversationStore, request: KnowledgeChangeRequest, status: KnowledgePrStatus): void {
  if (status.merged) {
    store.updateKnowledgeChangeRequestRepo({ id: request.id, prState: "merged", runtimeState: "pending_restart", requestState: "in_progress", latestCommitSha: status.latestCommitSha ?? request.latest_commit_sha, mergeCommitSha: status.mergeCommitSha ?? request.merge_commit_sha, actor: "startup-pr-refresh", eventType: "pr_merged" });
  } else if (status.closed) {
    store.updateKnowledgeChangeRequestRepo({ id: request.id, prState: "closed", runtimeState: "failed", requestState: "failed", actor: "startup-pr-refresh", eventType: "pr_closed" });
  }
}

function readKnowledgeDocumentPrStatus(input: { repoRoot: string; request: KnowledgeChangeRequest; resolver: ((request: KnowledgeChangeRequest) => KnowledgePrStatus | null) | null }): KnowledgePrStatus | null {
  if (input.resolver) return input.resolver(input.request);
  const ref = input.request.pr_number ? String(input.request.pr_number) : input.request.pr_url;
  if (!ref) return null;
  try {
    const raw = execFileSync("gh", ["pr", "view", ref, "--json", "state,merged,mergeCommit,headRefOid"], { cwd: input.repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const parsed = JSON.parse(raw) as { state?: string; merged?: boolean; mergeCommit?: { oid?: string | null } | null; headRefOid?: string | null };
    return { merged: parsed.merged === true, closed: parsed.state === "CLOSED" && parsed.merged !== true, mergeCommitSha: parsed.mergeCommit?.oid ?? null, latestCommitSha: parsed.headRefOid ?? null };
  } catch (error) {
    logger.warn("Failed to refresh knowledge document PR state", { requestId: input.request.id, prUrl: input.request.pr_url, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
