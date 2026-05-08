import type { KnowledgeCandidateContentUpdate, KnowledgeDuplicateCandidate, KnowledgeKind, KnowledgeScopeType } from "../persistence/knowledge-types";
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
  mergedCandidate: KnowledgeCandidateContentUpdate | null;
}

export interface KnowledgeDuplicateDetector {
  detectDuplicate(input: KnowledgeDuplicateDetectionInput): Promise<KnowledgeDuplicateDetectionResult>;
}

export class OpenAIKnowledgeDuplicateDetector implements KnowledgeDuplicateDetector {
  constructor(private client: OpenAIClient) {}

  async detectDuplicate(input: KnowledgeDuplicateDetectionInput): Promise<KnowledgeDuplicateDetectionResult> {
    if (!input.existing.length) return { duplicateId: null, reason: null, mergedCandidate: null };
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
    "如果重复命中的是 candidate，必须输出 merged_candidate，对两份候选做语义合并，保留更清晰、完整、准确的约束；不要机械拼接，也不要直接用新候选覆盖旧候选。",
    "如果重复命中的是 active、deprecated、archived 等已治理知识，merged_candidate 必须为 null，因为已治理内容不能由候选流程自动改写。",
    "只输出 JSON：{\"duplicate_id\": string|null, \"reason\": string|null, \"merged_candidate\": {\"title\": string, \"content\": string, \"rationale\": string|null}|null}。",
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
    const parsed = JSON.parse(content) as { duplicate_id?: unknown; reason?: unknown; merged_candidate?: unknown };
    const duplicateId = typeof parsed.duplicate_id === "string" ? parsed.duplicate_id : null;
    const duplicate = duplicateId ? existing.find((item) => item.id === duplicateId) : null;
    if (duplicate) {
      return {
        duplicateId,
        reason: typeof parsed.reason === "string" ? parsed.reason : null,
        mergedCandidate: duplicate.status === "candidate" ? parseMergedCandidate(parsed.merged_candidate) : null,
      };
    }
    return { duplicateId: null, reason: typeof parsed.reason === "string" ? parsed.reason : null, mergedCandidate: null };
  } catch (error) {
    logger.warn("Failed to parse knowledge duplicate detection result", {
      error: error instanceof Error ? error.message : String(error),
      rawContent: content.substring(0, 300),
    });
    return { duplicateId: null, reason: null, mergedCandidate: null };
  }
}

function parseMergedCandidate(value: unknown): KnowledgeCandidateContentUpdate | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const title = stringValue(payload.title);
  const content = stringValue(payload.content);
  if (!title || !content) return null;
  return {
    title,
    content,
    rationale: typeof payload.rationale === "string" && payload.rationale.trim() ? payload.rationale.trim() : null,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
