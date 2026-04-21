import type {
  Artifact,
  Conversation,
  KnowledgeAuthority,
  KnowledgeCouncilView,
  KnowledgeProposal,
  KnowledgeScope,
  KnowledgeType,
  MessageWithParts,
  Stage,
} from "../persistence/store";
import { joinPartTextByType } from "../project/message-parts";
import type { OpenAIClient } from "./openai";

export interface KnowledgeProposalGenerationInput {
  project: {
    id: string;
    name: string;
    kind: string;
  };
  stage: Stage;
  conversations: Array<Conversation & { messages: MessageWithParts[] }>;
  artifacts: Artifact[];
  formalArtifacts: Artifact[];
}

export interface KnowledgeProposalGenerator {
  generateKnowledgeProposals(input: KnowledgeProposalGenerationInput): Promise<Omit<KnowledgeProposal, "id" | "project_id" | "stage_id" | "knowledge_entry_id" | "created_at" | "updated_at" | "decided_at">[]>;
}

interface RawKnowledgeProposal {
  title?: string;
  summary?: string;
  knowledge_type?: KnowledgeType;
  rationale?: string;
  applicability?: string;
  evidence?: {
    conversation_ids?: string[];
    artifact_ids?: string[];
    formal_artifact_ids?: string[];
  };
  review?: {
    suggested_scope?: KnowledgeScope;
    suggested_authority?: KnowledgeAuthority;
    confidence?: number;
    reviewer_mode?: "single_model" | "ephemeral_council";
    why_include?: string[];
    why_not_include?: string[];
    risk_if_wrong?: string;
    council_views?: KnowledgeCouncilView[];
  };
}

type SanitizedKnowledgeProposal = Omit<KnowledgeProposal, "id" | "project_id" | "stage_id" | "knowledge_entry_id" | "created_at" | "updated_at" | "decided_at">;

const COUNCIL_REVIEWERS = [
  { reviewer: "Design Review", focus: "关注是否形成稳定原则或边界" },
  { reviewer: "Implementation Review", focus: "关注是否能转成执行协议或工程 guardrail" },
  { reviewer: "Acceptance Review", focus: "关注是否具有验收、风险和复用价值" },
] as const;

export class OpenAIKnowledgeProposalGenerator implements KnowledgeProposalGenerator {
  constructor(private client: OpenAIClient) {}

  async generateKnowledgeProposals(input: KnowledgeProposalGenerationInput): Promise<SanitizedKnowledgeProposal[]> {
    const councilViews = await maybeGenerateCouncilViews(this.client, input);
    const response = await this.client.createChatCompletion([
      {
        role: "system",
        content: buildProposalSystemPrompt(),
      },
      {
        role: "user",
        content: buildKnowledgeProposalPrompt(input, councilViews),
      },
    ]);

    return normalizeKnowledgeProposalOutput(response, input, councilViews);
  }
}

function buildProposalSystemPrompt(): string {
  return [
    "你是 Snail Shell 内置的阶段知识提炼模块。",
    "你的任务是在 stage 完成后，从本轮 conversation 和 artifact 中识别值得提交给用户确认的知识提案。",
    "知识提案不是工作总结，必须只输出具有复用价值的原则、协议或经验。",
    "只允许使用以下 knowledge_type: principle, protocol, experience。",
    "只允许使用以下 suggested_scope: system, cross_project, project_local。",
    "只允许使用以下 suggested_authority: mandatory, recommended, reference。",
    "只允许使用以下 reviewer_mode: single_model, ephemeral_council。",
    "如果本轮没有足够稳定、足够通用或足够重要的知识，不要勉强输出。",
    "输出必须是 JSON 数组，不要输出 markdown，不要输出解释。",
    "每个元素必须包含: title, summary, knowledge_type, rationale, applicability, evidence, review。",
    "evidence 中的 conversation_ids、artifact_ids、formal_artifact_ids 必须只引用输入中真实存在的 id。",
    "review 中必须包含: suggested_scope, suggested_authority, confidence, reviewer_mode, why_include, why_not_include, risk_if_wrong。",
    "当输入包含 council views 时，只有在这些视角确实提供了互补判断时，reviewer_mode 才能设置为 ephemeral_council。",
    "最多输出 5 条，优先保留最值得沉淀的条目。",
  ].join("\n");
}

async function maybeGenerateCouncilViews(client: OpenAIClient, input: KnowledgeProposalGenerationInput): Promise<KnowledgeCouncilView[]> {
  if (!shouldUseCouncilReview(input)) {
    return [];
  }

  const prompts = COUNCIL_REVIEWERS.map((reviewer) => client.createChatCompletion([
    {
      role: "system",
      content: [
        `你正在参与 Snail Shell 的后台临时知识评审。`,
        `你的身份是 ${reviewer.reviewer}。`,
        `你的关注点是：${reviewer.focus}。`,
        "请只输出一个 JSON 对象，字段必须包含 reviewer, focus, stance, notes。",
        "stance 只允许 support, caution, neutral。notes 为 1 到 3 条简短判断。",
      ].join("\n"),
    },
    {
      role: "user",
      content: buildCouncilPrompt(input),
    },
  ]));

  const responses = await Promise.all(prompts);
  return responses.map(parseCouncilView).filter((item): item is KnowledgeCouncilView => Boolean(item));
}

function shouldUseCouncilReview(input: KnowledgeProposalGenerationInput): boolean {
  if (input.stage.type === "publish") {
    return true;
  }

  return input.formalArtifacts.length > 1 || input.conversations.length > 1;
}

function buildCouncilPrompt(input: KnowledgeProposalGenerationInput): string {
  return [
    `Project: ${input.project.name} (${input.project.kind})`,
    `Stage: ${input.stage.type}`,
    `Formal artifacts: ${input.formalArtifacts.map((item) => `${item.artifact_type}:${item.title}`).join(" | ") || "无"}`,
    `Conversation summaries: ${input.conversations.map((item) => `${item.title}:${item.summary ?? "无"}`).join(" | ") || "无"}`,
  ].join("\n");
}

function buildKnowledgeProposalPrompt(input: KnowledgeProposalGenerationInput, councilViews: KnowledgeCouncilView[]): string {
  const artifactLines = input.artifacts.map((artifact) => {
    const formalMark = input.formalArtifacts.some((item) => item.id === artifact.id) ? "formal" : "process";
    return `- ${artifact.id} | ${artifact.artifact_type} | ${formalMark} | ${artifact.title}`;
  });

  const conversationLines = input.conversations.map((conversation) => {
    const transcript = conversation.messages.map((message) => buildTranscriptLine(message)).join("\n");
    return [`- ${conversation.id} | ${conversation.kind} | ${conversation.title}`, `  summary: ${conversation.summary ?? "无"}`, transcript || "  - 无消息"].join("\n");
  });

  const councilLines = councilViews.map((view) => `- ${view.reviewer} | ${view.focus} | ${view.stance} | ${view.notes.join(" / ")}`);

  return [
    `Project: ${input.project.name} (${input.project.kind})`,
    `Project ID: ${input.project.id}`,
    `Stage: ${input.stage.type}`,
    `Stage ID: ${input.stage.id}`,
    `Stage formal artifact ids: ${input.stage.formal_artifacts.join(", ") || "无"}`,
    "Artifacts:",
    artifactLines.join("\n") || "- 无",
    "Conversations:",
    conversationLines.join("\n") || "- 无",
    "Council Views:",
    councilLines.join("\n") || "- 无",
  ].join("\n\n");
}

function buildTranscriptLine(message: MessageWithParts): string {
  const speaker = message.role === "user" ? "用户" : (message.producer_snail ?? message.role);
  const content = joinPartTextByType(message.parts, ["content", "tool_use", "system_event"]).replace(/\s+/g, " ").trim();
  return `  - ${speaker}: ${clipText(content, 220) || "(空)"}`;
}

function normalizeKnowledgeProposalOutput(
  response: string,
  input: KnowledgeProposalGenerationInput,
  councilViews: KnowledgeCouncilView[]
): SanitizedKnowledgeProposal[] {
  const parsed = parseJsonArray(response);
  const context = buildNormalizationContext(input, councilViews);
  return parsed.slice(0, 5).map((item) => sanitizeProposal(item, context)).filter((item): item is SanitizedKnowledgeProposal => Boolean(item));
}

function buildNormalizationContext(input: KnowledgeProposalGenerationInput, councilViews: KnowledgeCouncilView[]) {
  return {
    validConversationIds: new Set(input.conversations.map((item) => item.id)),
    validArtifactIds: new Set(input.artifacts.map((item) => item.id)),
    validFormalArtifactIds: new Set(input.formalArtifacts.map((item) => item.id)),
    sourceStageType: input.stage.type,
    councilViews,
  };
}

function parseJsonArray(response: string): RawKnowledgeProposal[] {
  try {
    const parsed = JSON.parse(response);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseCouncilView(response: string): KnowledgeCouncilView | null {
  try {
    const parsed = JSON.parse(response) as Partial<KnowledgeCouncilView>;
    if (!parsed.reviewer || !parsed.focus || !parsed.stance || !Array.isArray(parsed.notes)) {
      return null;
    }
    return {
      reviewer: parsed.reviewer,
      focus: parsed.focus,
      stance: parsed.stance,
      notes: parsed.notes.map((item: string) => item.trim()).filter(Boolean).slice(0, 3),
    };
  } catch {
    return null;
  }
}

function sanitizeProposal(
  item: RawKnowledgeProposal,
  context: {
    validConversationIds: Set<string>;
    validArtifactIds: Set<string>;
    validFormalArtifactIds: Set<string>;
    sourceStageType: Stage["type"];
    councilViews: KnowledgeCouncilView[];
  }
): SanitizedKnowledgeProposal | null {
  const knowledgeType = normalizeKnowledgeType(item.knowledge_type);
  const baseFields = getBaseProposalFields(item);
  if (!baseFields || !knowledgeType) {
    return null;
  }

  return {
    source_stage_type: context.sourceStageType,
    title: baseFields.title,
    summary: baseFields.summary,
    knowledge_type: knowledgeType,
    status: "pending_review",
    rationale: baseFields.rationale,
    applicability: baseFields.applicability,
    evidence: buildEvidence(item, context),
    review: buildReview(item, context.councilViews),
  };
}

function getBaseProposalFields(item: RawKnowledgeProposal): { title: string; summary: string; rationale: string; applicability: string } | null {
  const title = item.title?.trim();
  const summary = item.summary?.trim();
  const rationale = item.rationale?.trim();
  const applicability = item.applicability?.trim();
  if (!title || !summary || !rationale || !applicability) {
    return null;
  }
  return { title, summary, rationale, applicability };
}

function buildEvidence(
  item: RawKnowledgeProposal,
  context: {
    validConversationIds: Set<string>;
    validArtifactIds: Set<string>;
    validFormalArtifactIds: Set<string>;
  }
) {
  return {
    conversation_ids: (item.evidence?.conversation_ids ?? []).filter((id) => context.validConversationIds.has(id)),
    artifact_ids: (item.evidence?.artifact_ids ?? []).filter((id) => context.validArtifactIds.has(id)),
    formal_artifact_ids: (item.evidence?.formal_artifact_ids ?? []).filter((id) => context.validFormalArtifactIds.has(id)),
  };
}

function buildReview(item: RawKnowledgeProposal, councilViews: KnowledgeCouncilView[]) {
  const review = item.review;
  return {
    suggested_scope: normalizeScope(review?.suggested_scope),
    suggested_authority: normalizeAuthority(review?.suggested_authority),
    confidence: normalizeConfidence(review?.confidence),
    reviewer_mode: normalizeReviewerMode(review?.reviewer_mode, councilViews),
    why_include: normalizeStringArray(review?.why_include),
    why_not_include: normalizeStringArray(review?.why_not_include),
    risk_if_wrong: review?.risk_if_wrong?.trim() || "沉淀范围或约束级别可能判断过重。",
    council_views: councilViews,
  };
}

function normalizeReviewerMode(
  value: "single_model" | "ephemeral_council" | undefined,
  councilViews: KnowledgeCouncilView[]
): "single_model" | "ephemeral_council" {
  if (value === "ephemeral_council" && councilViews.length > 0) {
    return value;
  }
  return "single_model";
}

function normalizeKnowledgeType(value: string | undefined): KnowledgeType | null {
  if (value === "principle" || value === "protocol" || value === "experience") {
    return value;
  }
  return null;
}

function normalizeScope(value: string | undefined): KnowledgeScope {
  if (value === "system" || value === "cross_project" || value === "project_local") {
    return value;
  }
  return "project_local";
}

function normalizeAuthority(value: string | undefined): KnowledgeAuthority {
  if (value === "mandatory" || value === "recommended" || value === "reference") {
    return value;
  }
  return "reference";
}

function normalizeConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeStringArray(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => item.trim()).filter(Boolean).slice(0, 5);
}

function clipText(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}
