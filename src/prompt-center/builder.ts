import path from "path";
import { getFrame, renderFrame, type FrameMatchContext, type FrameDocument } from "./registry";
import type { Conversation, Feature, KnowledgeGovernance, KnowledgeWithDetails, Project, ProjectStageDefinition, StageRoleDefinition, StageType } from "../shared/types";
import type { AgentRuntime } from "../shared/types";
import type { RoleDefinition } from "../roles";

export interface PromptBuildContext {
  project: Project;
  feature: Feature;
  stage: { type: StageType; output_artifacts: string[]; input_artifacts?: string[] };
  conversation: Conversation;
  stageDefinition: ProjectStageDefinition;
  roleDefinitions: StageRoleDefinition[];
  activeRole?: RoleDefinition;
  defaultRole?: RoleDefinition;
  participatingRoles: RoleDefinition[];
  runtime?: AgentRuntime;
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

  const frameId = context.conversation.owner_type === "knowledge_governance" ? "F-02" : "F-01";
  const frame = getFrame(frameId);

  return buildFromFrame(frame, frameContext, variables);
}

export function buildFromFrame(frame: FrameDocument, frameContext: FrameMatchContext, variables: Record<string, string>): string {
  return renderFrame(frame, frameContext, variables);
}

function buildFrameMatchContext(context: PromptBuildContext): FrameMatchContext {
  return {
    runtime: context.runtime,
    stageType: context.stage.type as StageType,
    roleName: context.activeRole?.name,
    conversationKind: context.conversation.kind,
    ownerType: context.conversation.owner_type,
  };
}

function buildTemplateVariables(context: PromptBuildContext): Record<string, string> {
  const historyScriptPath = path.join(process.cwd(), ".meta", "scripts", "conversation-history");
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
  return {
    ...buildProjectVariables(context),
    ...buildFeatureVariables(context),
    ...buildStageVariables(context),
    ...buildRoleVariables(context),
    ...buildConversationVariables(context),
    ...buildHistoryVariables(context, historyScriptPath, dbPath),
    ...buildGovernanceVariables(context),
  };
}

function buildProjectVariables(context: PromptBuildContext): Record<string, string> {
  return {
    project_id: context.project.id,
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
  const inputArtifacts = context.stage.input_artifacts ?? [];
  const outputArtifacts = context.stage.output_artifacts;
  return {
    stage_title: context.stageDefinition.title,
    stage_input: context.stageDefinition.input_description ?? "无",
    stage_input_description: context.stageDefinition.input_description ?? "无",
    stage_output_summary: outputArtifacts.join(", ") || "无",
    stage_required_artifacts: context.stageDefinition.output_description ?? "无",
    stage_output_description: context.stageDefinition.output_description ?? "无",
    stage_acceptance_focus_block: context.stageDefinition.acceptance_focus.map((item) => `- 验收关注点: ${item}`).join("\n"),
    stage_artifact_requirements_block: context.stageDefinition.acceptance_focus.map((item) => `- ${item}`).join("\n"),
    stage_output_artifacts: outputArtifacts.join(", ") || "无",
    stage_input_artifacts: inputArtifacts.join(", ") || "无",
    stage_input_artifacts_block: inputArtifacts.length ? inputArtifacts.map((item) => `- ${item}`).join("\n") : "- 无",
  };
}

function buildRoleVariables(context: PromptBuildContext): Record<string, string> {
  const activeRole = context.activeRole;
  return {
    active_role_name: activeRole?.name ?? context.conversation.default_role,
    default_role_name: context.defaultRole?.name ?? context.conversation.default_role,
    participating_roles: context.participatingRoles.map((item) => item.name).join("、") || "无",
    remaining_rounds: String(context.remainingCollaborationRounds ?? 0),
    mention_allowed: context.mentionAllowed === false ? "否" : "是",
    forced_wrap_up_line: context.forcedWrapUp ? "- 当前处于最终收口阶段: 你必须直接整合已有讨论并给出结论，不允许再继续 mention 其他 Role" : "",
    active_role_identity_line: activeRole ? `- 当前 Role 身份: ${activeRole.description}` : "",
    active_role_working_rules_block: activeRole?.working_rules.map((item) => `- 当前 Role 工作规则: ${item}`).join("\n") ?? "",
    participating_role_details_block: context.participatingRoles.map((role) => `- 参与 Role: ${role.name} | ${role.description}`).join("\n"),
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
