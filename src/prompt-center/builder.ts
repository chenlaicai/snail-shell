import path from "path";
import type { StageDefinition } from "../meta";
import { selectFrame, renderFrame, type FrameMatchContext, type FrameDocument } from "./registry";
import type { Artifact, Conversation, Feature, KnowledgeGovernance, KnowledgeWithDetails, Project, Stage, StageType } from "../shared/types";
import type { SnailDefinition } from "../snails/registry";

export interface PromptBuildContext {
  project: Project;
  feature: Feature;
  stage: Stage;
  conversation: Conversation;
  stageDefinition: StageDefinition;
  activeSnail?: SnailDefinition;
  defaultSnail?: SnailDefinition;
  participatingSnails: SnailDefinition[];
  inputArtifacts?: Artifact[];
  knowledgeGovernanceContext?: {
    governance: KnowledgeGovernance;
    knowledge: KnowledgeWithDetails;
  };
  remainingCollaborationRounds?: number;
  mentionAllowed?: boolean;
  forcedWrapUp?: boolean;
}

export function buildConversationSystemPrompt(context: PromptBuildContext): string {
  const variables = buildTemplateVariables(context);
  const frameContext = buildFrameMatchContext(context);

  const frame = selectFrame(frameContext);
  if (!frame) {
    throw new Error("No matching frame found for current context");
  }

  return buildFromFrame(frame, frameContext, variables);
}

export function buildFromFrame(frame: FrameDocument, frameContext: FrameMatchContext, variables: Record<string, string>): string {
  return renderFrame(frame, frameContext, variables);
}

function buildFrameMatchContext(context: PromptBuildContext): FrameMatchContext {
  return {
    runtime: context.activeSnail?.runtime,
    stageType: context.stage.type as StageType,
    snailName: context.activeSnail?.name,
    conversationKind: context.conversation.kind,
    ownerType: context.conversation.owner_type,
    repoRelated: context.stageDefinition.repo_related === true,
  };
}

function buildTemplateVariables(context: PromptBuildContext): Record<string, string> {
  const historyScriptPath = path.join(process.cwd(), ".meta", "scripts", "conversation-history");
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
  return {
    ...buildProjectVariables(context),
    ...buildFeatureVariables(context),
    ...buildStageVariables(context),
    ...buildSnailVariables(context),
    ...buildConversationVariables(context),
    ...buildHistoryVariables(context, historyScriptPath, dbPath),
    ...buildGovernanceVariables(context),
  };
}

function buildProjectVariables(context: PromptBuildContext): Record<string, string> {
  return {
    project_name: context.project.name,
    project_summary: context.project.summary ?? "无",
  };
}

function buildFeatureVariables(context: PromptBuildContext): Record<string, string> {
  return {
    feature_title: context.feature.title,
    feature_summary: context.feature.summary ?? "无",
    feature_status: context.feature.status,
    feature_branch_name: context.feature.branch_name ?? "无",
    feature_worktree_path: context.feature.worktree_path ?? "无",
    feature_pr_url: context.feature.pr_url ?? "无",
  };
}

function buildStageVariables(context: PromptBuildContext): Record<string, string> {
  return {
    stage_title: context.stageDefinition.title,
    stage_input: context.stageDefinition.input.join(", ") || "无",
    stage_input_artifacts_block: buildStageInputArtifactsBlock(context.inputArtifacts ?? []),
    stage_output_summary: context.stageDefinition.output.summary,
    stage_required_artifacts: context.stageDefinition.output.required_artifacts.join(", ") || "无",
    stage_artifact_requirements_block: context.stageDefinition.output.artifact_requirements.map((item) => `- 产物要求: ${item}`).join("\n"),
    stage_acceptance_focus_block: context.stageDefinition.acceptance_focus.map((item) => `- 验收关注点: ${item}`).join("\n"),
  };
}

function buildStageInputArtifactsBlock(artifacts: Artifact[]): string {
  if (!artifacts.length) {
    return "- 上一 Stage 输出产物: 无";
  }
  return artifacts.map((artifact) => {
    const content = summarizeArtifactContent(artifact);
    const detail = content ? `\n  > ${content}` : "";
    return `- 上一 Stage 输出产物: ${artifact.artifact_type} | ${artifact.title} | 状态: ${artifact.status}${detail}`;
  }).join("\n");
}

function summarizeArtifactContent(artifact: Artifact): string {
  const raw = artifact.inline_content ?? artifact.external_ref ?? artifact.file_path ?? artifact.metadata ?? "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  const truncated = normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized;
  return truncated.replace(/\n/g, "\n  > ");
}

function buildSnailVariables(context: PromptBuildContext): Record<string, string> {
  const activeSnail = context.activeSnail;
  return {
    active_snail_name: activeSnail?.name ?? context.conversation.default_snail,
    default_snail_name: context.defaultSnail?.name ?? context.conversation.default_snail,
    participating_snails: context.participatingSnails.map((item) => item.name).join("、") || "无",
    remaining_rounds: String(context.remainingCollaborationRounds ?? 0),
    mention_allowed: context.mentionAllowed === false ? "否" : "是",
    forced_wrap_up_line: context.forcedWrapUp ? "- 当前处于最终收口阶段: 你必须直接整合已有讨论并给出结论，不允许再继续 mention 其他 Snail" : "",
    active_snail_identity_line: activeSnail ? `- 当前 Snail 身份: ${activeSnail.description}` : "",
    active_snail_capabilities_line: activeSnail ? `- 当前 Snail 能力预期: ${activeSnail.capability_expectations.join("、") || "无"}` : "",
    active_snail_working_rules_block: activeSnail?.working_rules.map((item) => `- 当前 Snail 工作规则: ${item}`).join("\n") ?? "",
    active_snail_preferred_artifacts_line: activeSnail ? `- 当前 Snail 偏好产物: ${activeSnail.preferred_artifact_types.join(", ") || "无"}` : "",
    participating_snail_roles_block: context.participatingSnails.map((snail) => `- 参与 Snail 角色: ${snail.name} | ${snail.description}`).join("\n"),
  };
}

function buildConversationVariables(context: PromptBuildContext): Record<string, string> {
  return {
    conversation_title: context.conversation.title,
    conversation_kind: context.conversation.kind,
    conversation_sources: context.conversation.from_conversation_ids.join(", ") || "无",
    conversation_summary: context.conversation.summary ?? "无",
  };
}

function buildHistoryVariables(context: PromptBuildContext, historyScriptPath: string, dbPath: string): Record<string, string> {
  return {
    history_script_path: historyScriptPath,
    db_path: dbPath,
    conversation_id: context.conversation.id,
    history_search_example: `${historyScriptPath} --mode search --db-path "${dbPath}" --conversation-id ${context.conversation.id} --query "关键词" --limit 5`,
    history_window_example: `${historyScriptPath} --mode window --db-path "${dbPath}" --conversation-id ${context.conversation.id} --anchor-message-id 123 --before 2 --after 2`,
    history_by_ids_example: `${historyScriptPath} --mode by-ids --db-path "${dbPath}" --conversation-id ${context.conversation.id} --message-ids 123,124`,
  };
}

function buildGovernanceVariables(context: PromptBuildContext): Record<string, string> {
  const gc = context.knowledgeGovernanceContext;
  if (!gc) {
    return {};
  }
  const { governance, knowledge } = gc;
  return {
    governance_id: governance.id,
    knowledge_id: knowledge.id,
    knowledge_title: knowledge.title,
    knowledge_kind: knowledge.kind,
    knowledge_scope: `${knowledge.scope_type}:${knowledge.scope_ref ?? "*"}`,
    knowledge_content: knowledge.content,
    knowledge_rationale: knowledge.rationale ?? "无",
    governance_entry_check_status: governance.entry_check_status,
    governance_dedupe_status: governance.dedupe_status,
    governance_scenario_type: governance.scenario_type,
    governance_disposition_status: governance.disposition_status,
    governance_artifact_type: governance.artifact_type,
    governance_related_knowledge_ids: governance.related_knowledge_ids.join(", ") || "无",
    knowledge_sources: knowledge.sources.map((source) => `${source.source_type}:${source.source_id}${source.quote ? ` | ${source.quote}` : ""}`).join("; ") || "无",
  };
}
