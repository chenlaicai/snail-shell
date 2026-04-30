import type { KnowledgeKind, KnowledgeScopeType, SnailName } from "../persistence/store";
import { getTaskPrompt } from "../meta";
import type { OpenAIClient } from "./openai";

export interface KnowledgeExtractionInput {
  message: {
    id: number;
    role: string;
    fromSnail: SnailName | null;
    toSnails: SnailName[];
    content: string;
  };
  context: {
    projectId: string;
    projectName: string;
    featureId: string;
    featureTitle: string;
    stageId: string;
    stageType: string;
    conversationId: string;
    conversationTitle: string;
  };
}

export interface ExtractedKnowledgeCandidate {
  title: string;
  content: string;
  rationale: string | null;
  kind: KnowledgeKind;
  scopeType: KnowledgeScopeType;
  scopeRef: string | null;
  quote: string | null;
}

export interface KnowledgeExtractionResult {
  candidates: ExtractedKnowledgeCandidate[];
}

export interface KnowledgeExtractor {
  extractKnowledge(input: KnowledgeExtractionInput): Promise<KnowledgeExtractionResult>;
}

export class OpenAIKnowledgeExtractor implements KnowledgeExtractor {
  constructor(private client: OpenAIClient) {}

  async extractKnowledge(input: KnowledgeExtractionInput): Promise<KnowledgeExtractionResult> {
    const raw = await this.client.createChatCompletion([
      { role: "system", content: getTaskPrompt("task.knowledge-extractor.system") },
      { role: "user", content: JSON.stringify(input, null, 2) },
    ]);
    return parseKnowledgeExtractionResult(raw);
  }
}

export function parseKnowledgeExtractionResult(raw: string): KnowledgeExtractionResult {
  const parsed = JSON.parse(extractJsonObject(raw)) as { candidates?: unknown };
  if (!Array.isArray(parsed.candidates)) return { candidates: [] };
  return { candidates: parsed.candidates.map(parseCandidate).filter((candidate): candidate is ExtractedKnowledgeCandidate => candidate !== null) };
}

function parseCandidate(value: unknown): ExtractedKnowledgeCandidate | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const title = stringValue(item.title);
  const content = stringValue(item.content);
  const kind = enumValue(item.kind, KNOWLEDGE_KINDS);
  const scopeType = enumValue(item.scope_type ?? item.scopeType, KNOWLEDGE_SCOPE_TYPES);
  if (!title || !content || !kind || !scopeType) return null;
  return {
    title: title.slice(0, 160),
    content,
    rationale: stringValue(item.rationale),
    kind,
    scopeType,
    scopeRef: stringValue(item.scope_ref ?? item.scopeRef),
    quote: stringValue(item.quote),
  };
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error("Knowledge extraction response did not contain a JSON object");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : null;
}

const KNOWLEDGE_KINDS = ["decision", "rule", "preference", "incident", "anti_pattern", "glossary", "open_question", "procedure", "fact", "pattern"] as const;
const KNOWLEDGE_SCOPE_TYPES = ["global", "project", "feature", "stage_type", "conversation", "snail", "code_area", "workflow"] as const;
