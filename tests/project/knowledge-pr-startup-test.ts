import assert from "assert";
import fs from "fs";
import path from "path";
import { ProjectManager } from "../../src/project/manager";
import { ConversationStore } from "../../src/persistence/store";
import { SnailRegistry } from "../../src/snails";

const TEST_ROOT = path.join(__dirname, "..", "..", "data", "test-knowledge-pr-startup");
const TEST_DB = path.join(TEST_ROOT, "store.db");
const TEST_REPO_ROOT = path.join(TEST_ROOT, "repo");
const prStatusByUrl = new Map<string, { merged: boolean; closed: boolean; latestCommitSha?: string | null; mergeCommitSha?: string | null }>();

fs.rmSync(TEST_ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(TEST_REPO_ROOT, "docs", "knowledge"), { recursive: true });

function manager(store: ConversationStore): ProjectManager {
  return new ProjectManager(
    store,
    { resolve: () => { throw new Error("agent should not be invoked"); }, list: () => [] },
    new SnailRegistry(),
    { generateConversationSummary: async () => "summary", generateMessageContextSummary: async (input) => input.context.slice(0, input.targetChars) },
    { extractMentions: async () => ({ mentions: [] }) },
    { repoRoot: TEST_REPO_ROOT, knowledgeDocPr: { dryRun: true, prStatusResolver: (request) => request.pr_url ? prStatusByUrl.get(request.pr_url) ?? null : null } }
  );
}

try {
  const store = new ConversationStore(TEST_DB);
  const project = store.createProject("knowledge-pr-startup-project", "system_self", "Snail Shell", "test");
  const request = store.createKnowledgeChangeRequest({ id: "request-merged-check", type: "create", targetKnowledgeId: "knowledge-merged-check", documentPath: "docs/knowledge/knowledge-merged-check.md", expectedDocumentHash: "0".repeat(64), prUrl: "https://github.com/chenlaicai/snail-shell/pull/999", prNumber: 999, createdBy: "Boss Snail", approvedBy: "Boss Snail" });
  fs.writeFileSync(path.join(TEST_REPO_ROOT, request.document_path!), `---
id: knowledge-merged-check
status: active
kind: rule
governance_level: L1
scope_type: project
scope_ref: ${project.id}
project_id: ${project.id}
title: 本地正式文档不能单独生效
change_request_id: request-merged-check
---

## 内容

PR 未确认 merged 时，即使本地存在正式文档也不能 runtime active。
`);

  const firstManager = manager(store);
  assert(!store.getKnowledge("knowledge-merged-check"), "startup must not activate a final document before PR status is confirmed merged");

  prStatusByUrl.set(request.pr_url!, { merged: true, closed: false, latestCommitSha: "head-sha", mergeCommitSha: "merge-sha" });
  const secondManager = manager(store);
  const activated = store.getKnowledge("knowledge-merged-check");
  assert.equal(activated?.runtime_state, "active", "startup should activate the document after PR status is confirmed merged");
  const updated = store.listKnowledgeChangeRequests().find((item) => item.id === request.id)!;
  assert.equal(updated.pr_state, "merged", "startup should persist merged PR state before document sync");
  assert.equal(updated.merge_commit_sha, "merge-sha", "startup should persist merge commit sha from PR status");
  assert.equal(updated.expected_document_hash, updated.synced_document_hash, "startup should persist final document hash after activation");

  void firstManager;
  void secondManager;
  store.close();
} finally {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
}

console.log("knowledge PR startup tests passed");
