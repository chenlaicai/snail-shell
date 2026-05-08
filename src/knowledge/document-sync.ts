import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { ConversationStore, KnowledgeDocumentSyncInput } from "../persistence/store";
import type { KnowledgeKind, KnowledgeScopeType, KnowledgeStatus, KnowledgeUsagePolicyInput } from "../persistence/knowledge-types";

const KNOWLEDGE_STATUSES = new Set(["active", "deprecated", "superseded", "archived"]);
const KNOWLEDGE_KINDS = new Set(["decision", "rule", "preference", "incident", "anti_pattern", "glossary", "open_question", "procedure", "fact", "pattern"]);
const SCOPE_TYPES = new Set(["global", "project", "feature", "stage_type", "conversation", "snail", "code_area", "workflow"]);

export interface KnowledgeDocumentSyncResult {
  scanned: number;
  synced: number;
  deactivated: number;
}

export function syncKnowledgeDocuments(store: ConversationStore, repoRoot = process.cwd()): KnowledgeDocumentSyncResult {
  const docsRoot = path.join(repoRoot, "docs", "knowledge");
  const inputs = fs.existsSync(docsRoot) ? collectMarkdownFiles(docsRoot).filter((filePath) => path.basename(filePath) !== "README.md").map((filePath) => parseKnowledgeDocument(filePath, repoRoot)) : [];
  const result = store.syncKnowledgeDocuments(inputs);
  return { scanned: inputs.length, synced: result.synced, deactivated: result.deactivated };
}

export function parseKnowledgeDocument(filePath: string, repoRoot = process.cwd()): KnowledgeDocumentSyncInput {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = splitFrontmatter(raw, filePath);
  const frontmatter = parseYamlLikeFrontmatter(parsed.frontmatter);
  const content = section(parsed.body, "内容") || stringField(frontmatter, "content") || parsed.body.trim();
  const rationale = section(parsed.body, "理由") || nullableStringField(frontmatter, "rationale");
  const id = requiredString(frontmatter, "id", filePath);
  const status = enumField(frontmatter, "status", KNOWLEDGE_STATUSES, filePath) as Exclude<KnowledgeStatus, "candidate" | "pending_document" | "rejected">;
  const kind = enumField(frontmatter, "kind", KNOWLEDGE_KINDS, filePath) as KnowledgeKind;
  const scopeType = enumField(frontmatter, "scope_type", SCOPE_TYPES, filePath) as KnowledgeScopeType;
  const relativePath = path.relative(repoRoot, filePath);
  return {
    item: {
      id,
      projectId: nullableStringField(frontmatter, "project_id"),
      scopeType,
      scopeRef: nullableStringField(frontmatter, "scope_ref"),
      kind,
      status,
      governanceLevel: stringField(frontmatter, "governance_level") as any || "L1",
      title: requiredString(frontmatter, "title", filePath),
      content,
      rationale,
      createdBy: nullableStringField(frontmatter, "created_by"),
      approvedBy: nullableStringField(frontmatter, "approved_by"),
      approvedAt: nullableStringField(frontmatter, "approved_at"),
      metadata: JSON.stringify({
        source_candidate_id: nullableStringField(frontmatter, "source_candidate_id"),
        change_request_id: nullableStringField(frontmatter, "change_request_id"),
        introduced_by_pr: nullableStringField(frontmatter, "introduced_by_pr"),
        document_path: relativePath,
      }),
      sources: parseSources(frontmatter),
    },
    documentPath: relativePath,
    documentHash: createHash("sha256").update(raw).digest("hex"),
    usagePolicy: parsePrompt(frontmatter),
    changeRequestId: nullableStringField(frontmatter, "change_request_id"),
  };
}

function collectMarkdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const itemPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(itemPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [itemPath] : [];
  }).sort();
}

function splitFrontmatter(raw: string, filePath: string): { frontmatter: string; body: string } {
  if (!raw.startsWith("---\n")) throw new Error(`Knowledge document missing frontmatter: ${filePath}`);
  const end = raw.indexOf("\n---", 4);
  if (end < 0) throw new Error(`Knowledge document frontmatter is not closed: ${filePath}`);
  return { frontmatter: raw.slice(4, end), body: raw.slice(end + 4).trim() };
}

function parseYamlLikeFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const parsed = parseFrontmatterLine(lines, index);
    index = parsed.nextIndex;
    if (parsed.key) result[parsed.key] = parsed.value;
  }
  return result;
}

function parseFrontmatterLine(lines: string[], index: number): { key: string | null; value: unknown; nextIndex: number } {
  const line = lines[index] ?? "";
  if (!line.trim()) return { key: null, value: null, nextIndex: index + 1 };
  const match = /^(\w[\w_]*):\s*(.*)$/.exec(line);
  if (!match) return { key: null, value: null, nextIndex: index + 1 };
  const key = match[1]!;
  const value = match[2]!;
  if (value !== "") return { key, value: parseScalar(value), nextIndex: index + 1 };
  const block: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length && /^\s+/.test(lines[nextIndex] ?? "")) block.push(lines[nextIndex++]!);
  return { key, value: parseNestedBlock(block), nextIndex };
}

function parseNestedBlock(lines: string[]): unknown {
  const trimmed = lines.map((line) => line.replace(/^\s{2}/, ""));
  if (trimmed.every((line) => line.trim().startsWith("- "))) {
    return trimmed.map((line) => parseInlineObject(line.trim().slice(2)));
  }
  const record: Record<string, unknown> = {};
  for (const line of trimmed) {
    const match = /^(\w[\w_]*):\s*(.*)$/.exec(line.trim());
    if (match) record[match[1]!] = parseScalar(match[2]!);
  }
  return record;
}

function parseInlineObject(value: string): unknown {
  if (!value.includes(":")) return parseScalar(value);
  const record: Record<string, unknown> = {};
  const match = /^(\w[\w_]*):\s*(.*)$/.exec(value);
  if (match) record[match[1]!] = parseScalar(match[2]!);
  return record;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "[]") return [];
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function requiredString(record: Record<string, unknown>, key: string, filePath: string): string {
  const value = stringField(record, key);
  if (!value) throw new Error(`Knowledge document ${filePath} missing required field: ${key}`);
  return value;
}

function enumField(record: Record<string, unknown>, key: string, allowed: Set<string>, filePath: string): string {
  const value = requiredString(record, key, filePath);
  if (!allowed.has(value)) throw new Error(`Knowledge document ${filePath} has invalid ${key}: ${value}`);
  return value;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableStringField(record: Record<string, unknown>, key: string): string | null {
  return stringField(record, key);
}

function section(body: string, title: string): string | null {
  const regex = new RegExp(`(^|\\n)## ${title}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = regex.exec(body);
  return match?.[2]?.trim() || null;
}

function parsePrompt(record: Record<string, unknown>): KnowledgeUsagePolicyInput | null {
  const prompt = record.prompt;
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return null;
  const input = prompt as Record<string, unknown>;
  return {
    allowPromptInjection: Boolean(input.allow_prompt_injection),
    promptMode: stringField(input, "mode") as any || "reference_only",
    stageTypes: Array.isArray(input.stage_types) ? input.stage_types.filter((item): item is any => typeof item === "string") : [],
    snailNames: Array.isArray(input.snail_names) ? input.snail_names.filter((item): item is any => typeof item === "string") : [],
    priority: typeof input.priority === "number" ? input.priority : 0,
    tokenBudget: typeof input.token_budget === "number" ? input.token_budget : null,
  };
}

function parseSources(record: Record<string, unknown>): Array<{ id: string; sourceType: any; sourceId: string; quote?: string | null }> {
  const sources = record.sources;
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return [];
    const item = source as Record<string, unknown>;
    return [{ id: `${requiredString(record, "id", "knowledge document")}:source:${index}`, sourceType: stringField(item, "type") ?? "external", sourceId: stringField(item, "id") ?? "manual", quote: stringField(item, "quote") }];
  });
}
