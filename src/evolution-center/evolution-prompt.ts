import { buildConversationSystemPrompt, type RoleRegistry } from "../roles";
import type { Conversation, ConversationStore } from "../persistence/store";
import type { CollaborationInvocationOptions } from "../message-bus/collaboration";
import type { AgentCapability } from "../agent/capability";

export function buildEvolutionSystemPrompt(input: { store: ConversationStore; roleRegistry: RoleRegistry; conversation: Conversation; options: CollaborationInvocationOptions }): { systemPrompt: string; capability: AgentCapability } {
  const evolutionItemId = input.conversation.owner_id;
  if (!evolutionItemId) throw new Error("Evolution conversation is missing owner id");
  const evolutionItem = input.store.getEvolutionItem(evolutionItemId);
  if (!evolutionItem) throw new Error(`Evolution item not found: ${evolutionItemId}`);

  // 从 DB 加载 Evolution Center 项目及关联的 Feature/Stage/Role
  const workspace = input.store.getWorkspace("evolution-center");
  if (!workspace) throw new Error("Evolution Center workspace not found in DB — check seed initialization");

  const feature = input.conversation.feature_id ? input.store.getFeature(input.conversation.feature_id) : null;
  if (!feature) throw new Error(`Evolution feature not found for conversation ${input.conversation.id}`);

  const stage = input.conversation.stage_id ? input.store.getStage(input.conversation.stage_id) : null;
  if (!stage) throw new Error(`Evolution stage not found for conversation ${input.conversation.id}`);

  const stageDefinition = input.store.getStageDefinitionByKey("evolution-center", "development");
  if (!stageDefinition) throw new Error("Evolution Center stage definition not found in DB");

  const roleDefinitions = input.store.listRoleDefinitionsByWorkspace("evolution-center");

  const activeRole = roleDefinitions.find((role) => role.name === input.options.activeRoleName);

  return buildConversationSystemPrompt({
    workspace: workspace,
    feature,
    stage,
    conversation: input.conversation,
    stageDefinition,
    roleDefinitions,
    evolutionContext: { evolutionItem },
    activeRole,
    defaultRole: roleDefinitions.find((role) => role.name === input.conversation.default_role),
    runtime: input.options.runtime,
    snailDisplayName: input.options.snailDisplayName,
    remainingCollaborationRounds: input.options.remainingRounds,
    mentionAllowed: input.options.mentionAllowed,
    forcedWrapUp: input.options.forcedWrapUp,
    knowledgeLibrarySummaries: input.store.summaryKnowledgeLibrary(workspace.id),
    participatingRoles: input.conversation.participating_roles.map((roleName: string) => roleDefinitions.find((role) => role.name === roleName)).filter(Boolean) as any,
  });
}
