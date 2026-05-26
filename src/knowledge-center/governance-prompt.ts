import { buildConversationSystemPrompt, type RoleRegistry } from "../roles";
import type { Conversation, ConversationStore } from "../persistence/store";
import type { CollaborationInvocationOptions } from "../message-bus/collaboration";
import type { AgentCapability } from "../agent/capability";

export function buildKnowledgeGovernanceSystemPrompt(input: { store: ConversationStore; roleRegistry: RoleRegistry; conversation: Conversation; options: CollaborationInvocationOptions }): { systemPrompt: string; capability: AgentCapability } {
  const governanceId = input.conversation.owner_id;
  if (!governanceId) throw new Error("Knowledge governance conversation is missing owner id");
  const governance = input.store.getKnowledgeGovernance(governanceId);
  if (!governance) throw new Error(`Knowledge governance not found: ${governanceId}`);
  const knowledge = input.store.getKnowledge(governance.knowledge_id);
  if (!knowledge) throw new Error(`Knowledge not found: ${governance.knowledge_id}`);

  // 从 DB 加载 Knowledge Center 项目及关联的 Feature/Stage/Role
  const project = input.store.getProject("knowledge-center");
  if (!project) throw new Error("Knowledge Center project not found in DB — check seed initialization");

  const feature = input.conversation.feature_id ? input.store.getFeature(input.conversation.feature_id) : null;
  if (!feature) throw new Error(`Governance feature not found for conversation ${input.conversation.id}`);

  const stage = input.conversation.stage_id ? input.store.getStage(input.conversation.stage_id) : null;
  if (!stage) throw new Error(`Governance stage not found for conversation ${input.conversation.id}`);

  const stageDefinition = input.store.getStageDefinition("knowledge-center-development");
  if (!stageDefinition) throw new Error("Knowledge Center stage definition not found in DB");

  const roleDefinitions = input.store.listRoleDefinitionsByProject("knowledge-center");

  return buildConversationSystemPrompt({
    project,
    feature,
    stage,
    conversation: input.conversation,
    stageDefinition,
    roleDefinitions,
    knowledgeGovernanceContext: { governance, knowledge },
    activeRole: roleDefinitions.find((role) => role.name === input.options.activeRoleName),
    defaultRole: roleDefinitions.find((role) => role.name === input.conversation.default_role),
    runtime: input.options.runtime,
    remainingCollaborationRounds: input.options.remainingRounds,
    mentionAllowed: input.options.mentionAllowed,
    forcedWrapUp: input.options.forcedWrapUp,
    knowledgeLibrarySummaries: input.store.getKnowledgeLibraryKindSummaries("knowledge-center"),
    participatingRoles: input.conversation.participating_roles.map((roleName: string) => roleDefinitions.find((role) => role.name === roleName)).filter(Boolean) as any,
  });
}
