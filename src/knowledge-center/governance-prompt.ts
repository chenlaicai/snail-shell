import { buildConversationSystemPrompt, type RoleRegistry } from "../roles";
import type { Conversation, ConversationStore, Feature, Project, Stage } from "../persistence/store";
import type { CollaborationInvocationOptions } from "../message-bus/collaboration";

export function buildKnowledgeGovernanceSystemPrompt(input: { store: ConversationStore; roleRegistry: RoleRegistry; conversation: Conversation; options: CollaborationInvocationOptions }): string {
  const governanceId = input.conversation.owner_id;
  if (!governanceId) throw new Error("Knowledge governance conversation is missing owner id");
  const governance = input.store.getKnowledgeGovernance(governanceId);
  if (!governance) throw new Error(`Knowledge governance not found: ${governanceId}`);
  const knowledge = input.store.getKnowledge(governance.knowledge_id);
  if (!knowledge) throw new Error(`Knowledge not found: ${governance.knowledge_id}`);
  /**
   * 治理对话的数据已经在 knowledge_governance_* 专用表中独立存储；这里的 project/feature/stage 只是为了复用
   * 现有 prompt 模板的流程语义，不能反向写入项目管理表或被当作真实 Project Feature。
   */
  const syntheticProject = { id: "knowledge-center", kind: "system_self", name: "Knowledge Center", summary: "Snail Shell 知识中心治理空间", status: "active", created_at: governance.created_at, updated_at: governance.updated_at } as Project;
  const syntheticFeature = { id: governance.id, project_id: syntheticProject.id, title: `知识治理：${knowledge.title}`, summary: "围绕单条候选知识完成入口校验、查重定性、裁决去向和必要 PR 处理", status: "active", created_at: governance.created_at, updated_at: governance.updated_at, closed_at: governance.closed_at } as Feature;
  const syntheticStage = { id: governance.id, project_id: syntheticProject.id, feature_id: syntheticFeature.id, stage_definition_id: "knowledge-center-development", type: "development", sequence: 1, status: governance.closed_at ? "completed" : "in_progress", output_artifacts: governance.governance_pr_url ? { governance_pr_url: governance.governance_pr_url } : {} as Record<string, string>, entered_at: governance.created_at, left_at: governance.closed_at } as Stage;
  const syntheticRoles = [
    { id: "knowledge-center-development-boss", project_id: syntheticProject.id, stage_definition_id: "knowledge-center-development", name: "Boss Role", snail_template_id: null, is_primary: 1, description: "", working_rules: [], created_at: governance.created_at, updated_at: governance.updated_at },
    { id: "knowledge-center-development-implementation", project_id: syntheticProject.id, stage_definition_id: "knowledge-center-development", name: "知识执行者", snail_template_id: "opencode-default", is_primary: 0, description: "", working_rules: [], created_at: governance.created_at, updated_at: governance.updated_at },
  ];
  return buildConversationSystemPrompt({
    project: syntheticProject,
    feature: syntheticFeature,
    stage: syntheticStage,
    conversation: input.conversation,
    stageDefinition: {
      id: "knowledge-center-development",
      project_id: syntheticProject.id,
      key: "development",
      title: "知识治理",
      sequence: 1,
      input_description: null,
      output_description: "完成候选知识治理，必要时提交系统提示词、skill、文档、代码或检查器 PR，并回写治理去向。",
      acceptance_focus: ["候选来源和事实被查证", "入口校验、查重、裁决去向已回写", "候选不会绕过治理自动生效"],
      created_at: governance.created_at,
      updated_at: governance.updated_at,
    },
    roleDefinitions: [...syntheticRoles],
    knowledgeGovernanceContext: { governance, knowledge },
    activeRole: syntheticRoles.find((role) => role.name === input.options.activeRoleName),
    defaultRole: syntheticRoles.find((role) => role.name === input.conversation.default_role),
    runtime: input.options.runtime,
    remainingCollaborationRounds: input.options.remainingRounds,
    mentionAllowed: input.options.mentionAllowed,
    forcedWrapUp: input.options.forcedWrapUp,
    participatingRoles: input.conversation.participating_roles.map((roleName: string) => syntheticRoles.find((role) => role.name === roleName)).filter(Boolean) as any,
  });
}
