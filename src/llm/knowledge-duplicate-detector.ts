import type { KnowledgeDuplicateCandidate, KnowledgeKind, KnowledgeScopeType } from "../persistence/knowledge-types";
import type { OpenAIClient } from "./openai";
import { logger } from "../logger";

export interface KnowledgeDuplicateDetectionInput {
  candidate: {
    project_id: string | null;
    scope_type: KnowledgeScopeType;
    scope_ref: string | null;
    kind: KnowledgeKind;
    title: string;
    content: string;
    rationale: string | null;
  };
  existing: KnowledgeDuplicateCandidate[];
}

export interface KnowledgeDuplicateDetectionResult {
  duplicateId: string | null;
  reason: string | null;
}

export interface KnowledgeDuplicateDetector {
  detectDuplicate(input: KnowledgeDuplicateDetectionInput): Promise<KnowledgeDuplicateDetectionResult>;
}

export class OpenAIKnowledgeDuplicateDetector implements KnowledgeDuplicateDetector {
  constructor(private client: OpenAIClient) {}

  async detectDuplicate(input: KnowledgeDuplicateDetectionInput): Promise<KnowledgeDuplicateDetectionResult> {
    if (!input.existing.length) return { duplicateId: null, reason: null };
    const content = await this.client.createChatCompletion([
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ]);
    return parseDuplicateDetectionResult(content, input.existing);
  }
}

function buildSystemPrompt(): string {
  return [
    "你负责判断 Snail Shell 新提取的知识候选是否与已有知识语义重复。",
    "只有当新候选和某条已有知识表达的是同一条可复用规则、事实、偏好、决策或反模式时，才判定重复。",
    "允许措辞、标题、详略、顺序不同；不要要求文本完全一致。",
    "如果只是主题相近、同属一个领域、范围不同、约束对象不同、结论不同或新增了独立约束，必须判定不重复。",
    "只输出 JSON：{\"duplicate_id\": string|null, \"reason\": string|null}。",
  ].join("\n");
}

function buildUserPrompt(input: KnowledgeDuplicateDetectionInput): string {
  return JSON.stringify({
    new_candidate: input.candidate,
    existing_knowledge: input.existing.map((item) => ({
      id: item.id,
      status: item.status,
      governance_level: item.governance_level,
      title: item.title,
      content: item.content,
      rationale: item.rationale,
    })),
  }, null, 2);
}

function parseDuplicateDetectionResult(content: string, existing: KnowledgeDuplicateCandidate[]): KnowledgeDuplicateDetectionResult {
  try {
    const parsed = JSON.parse(content) as { duplicate_id?: unknown; reason?: unknown };
    const duplicateId = typeof parsed.duplicate_id === "string" ? parsed.duplicate_id : null;
    const validIds = new Set(existing.map((item) => item.id));
    if (duplicateId && validIds.has(duplicateId)) {
      return { duplicateId, reason: typeof parsed.reason === "string" ? parsed.reason : null };
    }
    return { duplicateId: null, reason: typeof parsed.reason === "string" ? parsed.reason : null };
  } catch (error) {
    logger.warn("Failed to parse knowledge duplicate detection result", {
      error: error instanceof Error ? error.message : String(error),
      rawContent: content.substring(0, 300),
    });
    return { duplicateId: null, reason: null };
  }
}
