import assert from "assert";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { ConversationStore } from "../../src/persistence/store";

const TEST_ROOT = path.join(__dirname, "..", "..", "data", "test-knowledge-doc-pr");
const TEST_DB = path.join(TEST_ROOT, "store.db");
const REPO_ROOT = path.join(TEST_ROOT, "repo");

fs.rmSync(TEST_ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(REPO_ROOT, "docs", "knowledge", "pending"), { recursive: true });

const store = new ConversationStore(TEST_DB);
try {
  store.createKnowledge({ id: "candidate-1", projectId: null, scopeType: "global", kind: "rule", title: "候选", content: "候选内容" });
  fs.writeFileSync(path.join(REPO_ROOT, "docs", "knowledge", "pending", "knowledge-1.md"), `---
id: knowledge-1
status: active
kind: rule
governance_level: L1
scope_type: global
scope_ref: null
project_id: null
title: 知识 1
change_request_id: request-1
---

## 内容

知识内容
`);
  store.createKnowledgeChangeRequest({ id: "request-1", type: "create", candidateId: "candidate-1", targetKnowledgeId: "knowledge-1", documentPath: "docs/knowledge/pending/knowledge-1.md", createdBy: "Implementation Snail", approvedBy: "Boss Snail" });

  const scriptPath = path.join(process.cwd(), ".meta", "scripts", "knowledge-doc-pr");
  const output = execFileSync(scriptPath, ["--db-path", TEST_DB, "--repo-root", REPO_ROOT, "--worktrees-root", path.join(TEST_ROOT, "worktrees"), "--request-id", "request-1", "--dry-run"], { encoding: "utf8" });
  const result = JSON.parse(output) as { ok: boolean; document_path: string; branch_name: string; dry_run: boolean };
  assert(result.ok, "script should report success");
  assert.equal(result.document_path, "docs/knowledge/knowledge-1.md", "script should map pending draft to final knowledge document path");
  assert.equal(result.branch_name, "knowledge/knowledge-1", "script should provide a deterministic knowledge branch");
  assert.equal(result.dry_run, true, "dry-run should avoid git and GitHub side effects");

  const request = store.listKnowledgeChangeRequests().find((item) => item.id === "request-1")!;
  assert.equal(request.document_path, "docs/knowledge/knowledge-1.md", "script should persist final document path on request");
  assert.equal(request.expected_document_hash?.length, 64, "script should persist expected document hash");
  assert.equal(request.pr_state, "none", "dry-run should not pretend a PR was opened");
} finally {
  store.close();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
}

console.log("knowledge-doc-pr script tests passed");
