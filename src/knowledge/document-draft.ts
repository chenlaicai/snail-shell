import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { KnowledgeApprovalInput, KnowledgeWithDetails } from "../persistence/store";

export interface KnowledgeDocumentDraftResult {
  content: string;
  documentHash: string;
}

export function writeKnowledgeDocumentDraft(repoRoot: string, relativePath: string, content: string): void {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function renderKnowledgeDocumentDraft(input: { candidate: KnowledgeWithDetails; approval: KnowledgeApprovalInput; requestId: string; targetKnowledgeId: string }): KnowledgeDocumentDraftResult {
  const fields = draftFields(input.candidate, input.approval);
  const draft = `---
id: ${input.targetKnowledgeId}
status: active
kind: ${fields.kind}
governance_level: ${fields.governanceLevel}
scope_type: ${fields.scopeType}
scope_ref: ${yamlScalar(fields.scopeRef)}
project_id: ${yamlScalar(input.candidate.project_id)}
title: ${yamlScalar(fields.title)}
created_by: ${yamlScalar(input.candidate.created_by ?? input.approval.reviewer)}
approved_by: ${yamlScalar(input.approval.reviewer)}
approved_at: ${yamlScalar(new Date().toISOString())}
source_candidate_id: ${input.candidate.id}
change_request_id: ${input.requestId}
introduced_by_pr: null
prompt:
  allow_prompt_injection: false
  mode: reference_only
  stage_types: []
  snail_names: []
  priority: 0
  token_budget: null
sources:
${renderKnowledgeDocumentSources(input.candidate)}---

## 内容

${fields.content}

## 理由

${fields.rationale}
`;
  return { content: draft, documentHash: createHash("sha256").update(draft).digest("hex") };
}

function draftFields(candidate: KnowledgeWithDetails, approval: KnowledgeApprovalInput) {
  const updates = approval.updates ?? {};
  return {
    title: updates.title ?? candidate.title,
    content: updates.content ?? candidate.content,
    rationale: updates.rationale ?? candidate.rationale ?? "由知识候选审批生成，等待 PR review 补充设计意图。",
    scopeType: updates.scope_type ?? candidate.scope_type,
    scopeRef: updates.scope_ref ?? candidate.scope_ref,
    kind: updates.kind ?? candidate.kind,
    governanceLevel: updates.governance_level ?? defaultGovernanceLevel(candidate.governance_level),
  };
}

function defaultGovernanceLevel(level: string): string {
  return level === "L0" ? "L1" : level;
}

function renderKnowledgeDocumentSources(candidate: KnowledgeWithDetails): string {
  if (!candidate.sources.length) return "";
  return candidate.sources.map((source) => `  - type: ${source.source_type}\n    id: ${yamlScalar(source.source_id)}\n    quote: ${yamlScalar(source.quote ?? "")}`).join("\n") + "\n";
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined || value === "") return "null";
  return JSON.stringify(String(value));
}
