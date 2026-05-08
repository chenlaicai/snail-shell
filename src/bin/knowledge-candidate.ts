#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { ConversationStore, type CreateKnowledgeInput, type KnowledgeKind, type KnowledgeScopeType } from "../persistence/store";
import type { KnowledgeSourceType } from "../persistence/knowledge-types";
import { loadLlmConfig, OpenAIClient, OpenAIKnowledgeDuplicateDetector, type KnowledgeDuplicateDetectionResult } from "../llm";

type SourceInput = {
  source_type?: KnowledgeSourceType;
  source_id?: string;
  quote?: string | null;
};

type CandidateInput = {
  project_id?: string | null;
  scope_type: KnowledgeScopeType;
  scope_ref?: string | null;
  kind: KnowledgeKind;
  title: string;
  content: string;
  rationale?: string | null;
  created_by?: string | null;
  metadata?: Record<string, unknown> | null;
  sources?: SourceInput[];
};

type ParsedArgs = {
  dbPath: string;
  inputPath: string | null;
};

const SCOPE_TYPES = new Set(["global", "project", "feature", "stage_type", "conversation", "snail", "code_area", "workflow"]);
const KINDS = new Set(["decision", "rule", "preference", "incident", "anti_pattern", "glossary", "open_question", "procedure", "fact", "pattern"]);
const SOURCE_TYPES = new Set(["message", "artifact", "conversation", "stage", "feature", "project", "pull_request", "review_comment", "test_failure", "external"]);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = parseCandidateInput(readInput(args.inputPath));
  const store = new ConversationStore(args.dbPath);
  try {
    const createInput = toCreateKnowledgeInput(input);
    const duplicate = await detectDuplicate(store, createInput);
    const result = store.createOrMergeKnowledgeCandidate(createInput, duplicate.duplicateId, duplicate.mergedCandidate);
    process.stdout.write(`${JSON.stringify({ ok: true, knowledge_id: result.knowledge.id, status: result.knowledge.status, action: result.action, duplicate_of: result.duplicate_of, duplicate_reason: duplicate.reason }, null, 2)}\n`);
  } finally {
    store.close();
  }
}

async function detectDuplicate(store: ConversationStore, input: CreateKnowledgeInput): Promise<KnowledgeDuplicateDetectionResult> {
  const existing = store.listKnowledgeDuplicateCandidates(input);
  if (!existing.length) return { duplicateId: null, reason: null, mergedCandidate: null };
  const llmConfig = loadLlmConfig();
  if (llmConfig.provider !== "openai") throw new Error(`Unsupported llm provider: ${llmConfig.provider}`);
  const detector = new OpenAIKnowledgeDuplicateDetector(new OpenAIClient({
    apiKey: llmConfig.openai.api_key,
    model: llmConfig.openai.model,
    baseUrl: llmConfig.openai.base_url,
    timeoutMs: llmConfig.openai.timeout_ms,
  }));
  /**
   * 候选知识由 LLM 生成，重复通常表现为语义等价而非文本一致。
   * 因此脚本必须在同范围候选集中调用 LLM 判断；存储层只接收明确 duplicateId 并复核边界，不能再用字符串一致性冒充查重。
   */
  return detector.detectDuplicate({
    candidate: {
      project_id: input.projectId ?? null,
      scope_type: input.scopeType,
      scope_ref: input.scopeRef ?? null,
      kind: input.kind,
      title: input.title,
      content: input.content,
      rationale: input.rationale ?? null,
    },
    existing,
  });
}

function parseArgs(argv: string[]): ParsedArgs {
  const getValue = (name: string): string => {
    const index = argv.indexOf(name);
    return index >= 0 && index < argv.length - 1 ? argv[index + 1] ?? "" : "";
  };
  return {
    dbPath: getValue("--db-path") || process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db"),
    inputPath: getValue("--input") || null,
  };
}

function readInput(inputPath: string | null): string {
  const raw = inputPath ? fs.readFileSync(inputPath, "utf8") : fs.readFileSync(0, "utf8");
  if (!raw.trim()) throw new Error("knowledge candidate input is required");
  return raw;
}

function parseCandidateInput(raw: string): CandidateInput {
  const parsed = JSON.parse(raw) as Partial<CandidateInput>;
  const validation = validateCandidateInput(parsed);
  if (validation) throw new Error(validation);
  return parsed as CandidateInput;
}

function validateCandidateInput(input: Partial<CandidateInput>): string | null {
  if (!stringValue(input.title)) return "title is required";
  if (!stringValue(input.content)) return "content is required";
  if (!enumValue(input.scope_type, SCOPE_TYPES)) return "scope_type is invalid";
  if (!enumValue(input.kind, KINDS)) return "kind is invalid";
  if (input.sources !== undefined && !Array.isArray(input.sources)) return "sources must be an array";
  const invalidSource = input.sources?.find((source) => source.source_type !== undefined && !enumValue(source.source_type, SOURCE_TYPES));
  if (invalidSource) return "source_type is invalid";
  return null;
}

function toCreateKnowledgeInput(input: CandidateInput): CreateKnowledgeInput {
  return {
    id: randomUUID(),
    projectId: input.project_id ?? null,
    scopeType: input.scope_type,
    scopeRef: input.scope_ref ?? null,
    kind: input.kind,
    status: "candidate",
    governanceLevel: "L0",
    title: input.title.trim(),
    content: input.content.trim(),
    rationale: input.rationale?.trim() || null,
    createdBy: input.created_by?.trim() || "knowledge-candidate-script",
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    sources: (input.sources ?? []).map((source) => ({
      id: randomUUID(),
      sourceType: source.source_type ?? "external",
      sourceId: source.source_id || "manual",
      quote: source.quote ?? null,
    })),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function enumValue(value: unknown, allowed: Set<string>): string | null {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
