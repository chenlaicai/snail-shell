#!/usr/bin/env node

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { ConversationStore, type KnowledgeChangeRequest } from "../persistence/store";

interface ParsedArgs {
  requestId: string;
  dbPath: string;
  repoRoot: string;
  worktreesRoot: string;
  dryRun: boolean;
  syncMerged: boolean;
}

interface PreparedRequest {
  requestId: string;
  targetKnowledgeId: string;
  branchName: string;
  worktreePath: string;
  finalDocumentPath: string;
  document: string;
  documentHash: string;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const store = new ConversationStore(args.dbPath);
  try {
    const result = args.syncMerged ? syncMergedKnowledgeDocPr(args, store) : openKnowledgeDocPr(args, store);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    store.close();
  }
}

function openKnowledgeDocPr(args: ParsedArgs, store: ConversationStore): Record<string, unknown> {
  const prepared = prepareKnowledgeDocPrRequest(args, store);
  if (!args.dryRun) createPullRequestWorktree(args, prepared);
  /**
   * PR 必须从知识文档 worktree 的分支发起；调用脚本的服务仓库可能停在 feature 分支或已有 PR，
   * 如果复用 repoRoot 的 cwd，request 会绑定到错误 head，后续 merged 门禁就无法追踪真实文档变更。
   */
  const prUrl = args.dryRun ? null : gh(prepared.worktreePath, ["pr", "create", "--head", prepared.branchName, "--base", "main", "--title", `落地知识文档：${prepared.targetKnowledgeId}`, "--body", prBody(prepared.requestId, prepared.finalDocumentPath)]).trim();
  const updated = store.updateKnowledgeChangeRequestRepo({ id: prepared.requestId, prState: args.dryRun ? "none" : "open", runtimeState: args.dryRun ? undefined : "pending_restart", requestState: "in_progress", documentPath: prepared.finalDocumentPath, branchName: prepared.branchName, worktreePath: prepared.worktreePath, prUrl, prNumber: prNumber(prUrl), latestCommitSha: args.dryRun ? null : git(prepared.worktreePath, ["rev-parse", "HEAD"]).trim(), expectedDocumentHash: prepared.documentHash, actor: "knowledge-doc-pr", eventType: args.dryRun ? "pr_dry_run" : "pr_opened" });
  return { ok: true, action: "open", request_id: updated.id, branch_name: updated.branch_name, worktree_path: updated.worktree_path, document_path: updated.document_path, pr_url: updated.pr_url, dry_run: args.dryRun };
}

function syncMergedKnowledgeDocPr(args: ParsedArgs, store: ConversationStore): Record<string, unknown> {
  const request = store.listKnowledgeChangeRequests().find((item) => item.id === args.requestId);
  if (!request) fail(`Knowledge change request not found: ${args.requestId}`);
  if (!args.dryRun && !request.pr_number && !request.pr_url) fail("Knowledge change request has no PR to sync");
  if (!request.document_path) fail("Knowledge change request missing final document path");
  const pr = args.dryRun ? { merged: true, mergeCommit: "dry-run-merge" } : readMergedPullRequest(args.repoRoot, request.pr_number ?? request.pr_url!);
  if (!pr.merged) fail("Knowledge document PR is not merged");
  const documentPath = path.join(args.repoRoot, request.document_path);
  if (!fs.existsSync(documentPath)) fail(`Merged knowledge document not found: ${request.document_path}`);
  const expectedDocumentHash = createHash("sha256").update(fs.readFileSync(documentPath, "utf8")).digest("hex");
  const updated = store.updateKnowledgeChangeRequestRepo({ id: request.id, prState: "merged", runtimeState: "pending_restart", requestState: "in_progress", mergeCommitSha: pr.mergeCommit, expectedDocumentHash, actor: "knowledge-doc-pr", eventType: args.dryRun ? "pr_merge_dry_run" : "pr_merged" });
  return { ok: true, action: "sync-merged", request_id: updated.id, pr_state: updated.pr_state, runtime_state: updated.runtime_state, merge_commit_sha: updated.merge_commit_sha, expected_document_hash: updated.expected_document_hash, dry_run: args.dryRun };
}

export function prepareKnowledgeDocPrRequest(args: ParsedArgs, store: { listKnowledgeChangeRequests(): KnowledgeChangeRequest[] }): PreparedRequest {
  const request = store.listKnowledgeChangeRequests().find((item) => item.id === args.requestId);
  if (!request) fail(`Knowledge change request not found: ${args.requestId}`);
  if (!request.target_knowledge_id) fail("Knowledge change request missing target_knowledge_id");
  if (!request.document_path) fail("Knowledge change request missing pending document path");
  const pendingPath = path.join(args.repoRoot, request.document_path);
  if (!fs.existsSync(pendingPath)) fail(`Pending knowledge document not found: ${request.document_path}`);
  const document = fs.readFileSync(pendingPath, "utf8");
  return { requestId: request.id, targetKnowledgeId: request.target_knowledge_id, branchName: `knowledge/${request.target_knowledge_id}`, worktreePath: path.join(args.worktreesRoot, request.target_knowledge_id), finalDocumentPath: `docs/knowledge/${request.target_knowledge_id}.md`, document, documentHash: createHash("sha256").update(document).digest("hex") };
}

function createPullRequestWorktree(args: ParsedArgs, prepared: PreparedRequest): void {
  git(args.repoRoot, ["fetch", "origin", "main"]);
  if (!fs.existsSync(args.worktreesRoot)) fs.mkdirSync(args.worktreesRoot, { recursive: true });
  if (!fs.existsSync(prepared.worktreePath)) git(args.repoRoot, ["worktree", "add", "-b", prepared.branchName, prepared.worktreePath, "origin/main"]);
  const finalPath = path.join(prepared.worktreePath, prepared.finalDocumentPath);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.writeFileSync(finalPath, prepared.document, "utf8");
  git(prepared.worktreePath, ["add", prepared.finalDocumentPath]);
  git(prepared.worktreePath, ["commit", "-m", `落地知识文档 ${prepared.requestId}`]);
  git(prepared.worktreePath, ["push", "-u", "origin", prepared.branchName]);
}

function parseArgs(argv: string[]): ParsedArgs {
  const getValue = (name: string): string => {
    const index = argv.indexOf(name);
    return index === -1 || index === argv.length - 1 ? "" : argv[index + 1] ?? "";
  };
  const requestId = getValue("--request-id");
  if (!requestId) fail("--request-id is required");
  const repoRoot = path.resolve(getValue("--repo-root") || process.cwd());
  return { requestId, repoRoot, dbPath: getValue("--db-path") || process.env.DB_PATH || path.join(repoRoot, "data", "snail-shell.db"), worktreesRoot: path.resolve(getValue("--worktrees-root") || path.join(repoRoot, "..", "snail-shell-worktrees")), dryRun: argv.includes("--dry-run"), syncMerged: argv.includes("--sync-merged") };
}

function prBody(requestId: string, documentPath: string): string {
  return `## Summary\n- 落地知识变更请求 ${requestId}\n- 新增知识文档 ${documentPath}\n\nImplementation Snail`;
}

function prNumber(url: string | null): number | null {
  const match = /\/pull\/(\d+)/.exec(url ?? "");
  return match ? Number(match[1]) : null;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gh(cwd: string, args: string[]): string {
  return execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function readMergedPullRequest(repoRoot: string, prRef: number | string): { merged: boolean; mergeCommit: string | null } {
  const raw = gh(repoRoot, ["pr", "view", String(prRef), "--json", "merged,mergeCommit"]);
  const parsed = JSON.parse(raw) as { merged?: boolean; mergeCommit?: { oid?: string | null } | null };
  return { merged: parsed.merged === true, mergeCommit: parsed.mergeCommit?.oid ?? null };
}

function fail(message: string): never {
  throw new Error(message);
}

main();
