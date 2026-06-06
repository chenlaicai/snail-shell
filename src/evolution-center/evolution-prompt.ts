import { buildConversationSystemPrompt } from "../roles";
import type { Conversation, ConversationStore } from "../persistence/store";
import type { CollaborationInvocationOptions } from "../message-bus/collaboration";
import type { AgentCapability } from "../agent/capability";
import type { EvolutionConfig, StageRoleDefinition } from "../shared/types";
import { SopSnapshotReader } from "../workspace-workflow/sop-snapshot-reader";

interface EvolutionContext {
  store: ConversationStore;
  conversation: Conversation;
  options: CollaborationInvocationOptions;
}

function requireNonNull<T>(value: T | null | undefined, message: string): NonNullable<T> {
  if (value === null || value === undefined) throw new Error(message);
  return value as NonNullable<T>;
}

function resolveEvolutionDependencies(ctx: EvolutionContext) {
  const { store, conversation } = ctx;
  const evolutionItem = requireNonNull(
    store.getEvolutionItem(requireNonNull(conversation.owner_id, "Evolution conversation is missing owner id")),
    `Evolution item not found: ${conversation.owner_id}`,
  );
  const workspaceId = requireNonNull(conversation.workspace_id, "Evolution conversation is missing workspace_id");
  const workspace = requireNonNull(store.getWorkspace(workspaceId), `Source workspace not found: ${workspaceId}`);
  const issue = requireNonNull(
    conversation.issue_id ? store.getIssue(conversation.issue_id) : null,
    `Evolution issue not found for conversation ${conversation.id}`,
  );
  const stage = conversation.stage_id ? store.getStage(conversation.stage_id) : null;
  if (!stage) throw new Error(`Evolution stage not found for conversation ${conversation.id}`);
  // 从 issue.sop_snapshot 读取 stage definition（snapshot 在 issue 创建时已存储）
  const reader = new SopSnapshotReader(issue.sop_snapshot);
  const stageDefinition = requireNonNull(
    reader.getSopStageDefinitionByKey(stage.type),
    `Evolution stage definition '${stage.type}' not found in SOP snapshot`,
  );
  return { evolutionItem, workspaceId, workspace, issue, stage, evolutionConfig: store.getEvolutionConfig(), stageDefinition };
}

function applyRoleBindings(roles: StageRoleDefinition[], config: EvolutionConfig | null): StageRoleDefinition[] {
  if (!config) return roles;
  return roles.map((r) => {
    const bindingValue = config.role_bindings[r.key];
    return bindingValue ? { ...r, snail_template_id: bindingValue } : r;
  });
}

export function buildEvolutionSystemPrompt(input: { store: ConversationStore; conversation: Conversation; options: CollaborationInvocationOptions }): { systemPrompt: string; capability: AgentCapability } {
  const ctx: EvolutionContext = { store: input.store, conversation: input.conversation, options: input.options };
  const deps = resolveEvolutionDependencies(ctx);
  const roleDefinitions = applyRoleBindings(
    input.store.listSopStageRoleDefinitions(deps.stageDefinition.id),
    deps.evolutionConfig,
  );
  const now = new Date().toISOString();
  return buildConversationSystemPrompt({
    workspace: deps.workspace,
    issue: deps.issue,
    stage: deps.stage,
    conversation: input.conversation,
    stageDefinition: { ...deps.stageDefinition, workspace_id: deps.workspaceId, created_at: now, updated_at: now },
    roleDefinitions,
    evolutionContext: { evolutionItem: deps.evolutionItem },
    activeRole: roleDefinitions.find((role) => role.name === input.options.activeRoleName),
    defaultRole: roleDefinitions.find((role) => role.name === input.conversation.default_role),
    runtime: input.options.runtime,
    snailDisplayName: input.options.snailDisplayName,
    remainingCollaborationRounds: input.options.remainingRounds,
    mentionAllowed: input.options.mentionAllowed,
    forcedWrapUp: input.options.forcedWrapUp,
    knowledgeLibrarySummaries: input.store.summaryKnowledgeLibrary(deps.workspaceId),
    participatingRoles: input.conversation.participating_roles.map((roleName: string) => roleDefinitions.find((role) => role.name === roleName)).filter(Boolean) as any,
  });
}
