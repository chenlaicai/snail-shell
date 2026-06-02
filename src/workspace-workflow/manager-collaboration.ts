/**
 * WorkspaceManager 的协作子系统：系统提示词构建、角色解析和 mention 解析。
 *
 * 从 manager.ts 拆出以满足文件行数限制（max 400）。
 */
import type { Conversation, ConversationStore, RoleName } from "../persistence/store";
import { buildConversationSystemPrompt } from "../roles";
import type { AgentCapability } from "../agent/capability";
import { logger } from "../logger";
import type { CollaborationInvocationOptions, MentionResolution } from "../message-bus/collaboration";
import { structuredMentionsFromEvents } from "../message-bus/collaboration";
import { getInputContent, type MessageInputEvent } from "../message-bus/message-events";
import { dedupeMentions } from "../message-bus/mentions";
import { buildEvolutionSystemPrompt } from "../evolution-center/evolution-prompt";
import type { RoleDefinition } from "../roles";
import type { RoleRegistry } from "../roles/registry";
import type { SnailDen } from "../snail-den";
import type { SystemAI } from "../snail-den/system-ai";
import { loadWorkspaceContext } from "./snail-loader";

/** resolveConversationSystemPrompt / resolveMentions 所需的外部依赖。 */
export interface CollaborationDeps {
  store: ConversationStore;
  roleRegistry: RoleRegistry;
  systemAI: SystemAI;
  snailDen: SnailDen;
}

/**
 * 为指定 conversation 构建系统提示词。
 * 根据 conversation.owner_type 分派到普通工作流或演进中心提示词构建。
 */
export function resolveConversationSystemPrompt(
  deps: CollaborationDeps,
  conversationId: string,
  options: CollaborationInvocationOptions,
): { systemPrompt: string; capability: AgentCapability } {
  const { store, roleRegistry } = deps;
  const conversation = store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  if (conversation.owner_type === "evolution") {
    return buildEvolutionSystemPrompt({ store, roleRegistry, conversation, options });
  }
  return buildWorkflowSystemPrompt(deps, conversationId, conversation, options);
}

function buildWorkflowSystemPrompt(
  deps: CollaborationDeps,
  conversationId: string,
  conversation: Conversation,
  options: CollaborationInvocationOptions,
): { systemPrompt: string; capability: AgentCapability } {
  const { store } = deps;
  if (!conversation.workspace_id || !conversation.issue_id || !conversation.stage_id) {
    throw new Error("Conversation context is incomplete");
  }
  const workspace = store.getWorkspace(conversation.workspace_id);
  const issue = store.getIssue(conversation.issue_id);
  const stage = store.getStage(conversation.stage_id);
  if (!workspace || !issue || !stage) throw new Error("Conversation context is incomplete");
  const stageDefinition = store.getStageDefinition(stage.stage_definition_id);
  if (!stageDefinition) throw new Error(`Stage definition not found: ${stage.stage_definition_id}`);

  const roleDefinitions = store.listRoleDefinitionsByStageAndWorkspace(stage.stage_definition_id, stage.workspace_id);
  const activeRole = resolveConversationRole(deps, conversationId, options.activeRoleName);
  const defaultRole = resolveConversationRole(deps, conversationId, conversation.default_role);
  const previousStage = store.listStagesByIssue(issue.id).find((s) => s.sequence === stage.sequence - 1);
  const participatingRoles = conversation.participating_roles
    .map((roleName) => resolveConversationRole(deps, conversationId, roleName))
    .filter(Boolean) as RoleDefinition[];
  const workspaceContext = loadWorkspaceContextSafe(workspace.workspace_root);

  const result = buildConversationSystemPrompt({
    workspace,
    issue,
    stage: { id: stage.id, issue_id: stage.issue_id, type: stage.type, output_artifacts: stage.output_artifacts, input_artifacts: previousStage?.output_artifacts ?? {} },
    conversation,
    stageDefinition,
    roleDefinitions,
    activeRole,
    defaultRole,
    remainingCollaborationRounds: options.remainingRounds,
    mentionAllowed: options.mentionAllowed,
    forcedWrapUp: options.forcedWrapUp,
    runtime: options.runtime,
    snailDisplayName: resolveSnailDisplayName(deps, activeRole, options),
    participatingRoles,
    knowledgeLibrarySummaries: store.summaryKnowledgeLibrary(workspace.id),
    workspacePrompts: workspaceContext.prompts,
    workspaceSkills: workspaceContext.skills,
  });

  appendTransitionHint(store, issue, stage, result);

  return result;
}

/**
 * 向系统提示词注入当前 stage 可用的转移目标。
 * Why: 让 AI 知道可通过 stage_transition proposal 发起转移。
 */
function appendTransitionHint(
  store: ConversationStore,
  issue: { adopted_sop_id: string | null },
  stage: { type: string },
  result: { systemPrompt: string; capability: AgentCapability },
): void {
  if (!issue.adopted_sop_id) return;
  const edges = store.getForwardTransitions(issue.adopted_sop_id, stage.type);
  if (edges.length === 0) return;
  result.capability.systemReminder += `\n\n## 可用 Stage 转移\n当前 stage "${stage.type}" 可转移到: ${edges.map((t) => t.to_stage_key).join(", ")}。通过 stage_transition proposal 发起转移。`;
}

/** 安全加载 workspace 上下文，.snail 目录不存在时返回空数组。 */
function loadWorkspaceContextSafe(workspaceRoot: string): { prompts: any[]; skills: any[] } {
  try {
    return loadWorkspaceContext(workspaceRoot, { loadSopDefinitions: false });
  } catch {
    return { prompts: [], skills: [] };
  }
}

/**
 * 解析当前响应 Snail 的可展示名称。
 *
 * 优先从 activeRole 的 snail_template_id 查询 SnailTemplate.name；
 * 回退到 options 中已有的 snailDisplayName；
 * 最终回退到 AgentRuntime 字符串。
 *
 * 为什么需要此函数：签名模板要求 `by <角色>（<Snail 名称>）`，
 * 但之前该值从未注入系统提示词，导致 AI 猜测签名内容。
 */
export function resolveSnailDisplayName(
  deps: CollaborationDeps,
  activeRole: RoleDefinition | undefined,
  options: CollaborationInvocationOptions,
): string {
  if (activeRole?.snail_template_id) {
    const template = deps.snailDen.getTemplate(activeRole.snail_template_id);
    if (template) return template.name;
  }
  return options.snailDisplayName ?? options.runtime ?? "unknown";
}

/**
 * 解析 conversation 上下文中指定 roleName 的 RoleDefinition。
 * Issue 级 role_snail_mapping 优先于工作区模板。
 */
export function resolveConversationRole(
  deps: CollaborationDeps,
  conversationId: string,
  roleName: RoleName,
): RoleDefinition | undefined {
  const { store, roleRegistry } = deps;
  const conversation = store.getConversation(conversationId);
  if (!conversation?.stage_id) return undefined;
  const stage = store.getStage(conversation.stage_id);
  if (!stage) return undefined;
  const roleDef = roleRegistry.getByStageDefinitionName(stage.workspace_id, stage.stage_definition_id, roleName);
  if (!roleDef) return undefined;
  if (conversation.issue_id) {
    const issue = store.getIssue(conversation.issue_id);
    const templateId = issue?.role_snail_mapping?.[stage.id]?.[roleName];
    if (templateId) return { ...roleDef, snail_template_id: templateId };
  }
  return roleDef;
}

/**
 * 解析消息中的 @mention，优先使用结构化数据，仅在消息包含 @ 时回退到 LLM 提取。
 */
export async function resolveMentions(
  deps: CollaborationDeps,
  conversationId: string,
  events: MessageInputEvent[],
  isAgentMessage: boolean = false,
): Promise<MentionResolution> {
  const { store, systemAI } = deps;
  const conversation = store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

  const structuredMentions = structuredMentionsFromEvents(conversation, events);
  const messageText = getInputContent(events);
  logger.debug(`[resolveMentions] structured=${structuredMentions.length}, hasAt=${messageText.includes("@")}, isAgent=${isAgentMessage}`);

  if (structuredMentions.length > 0 || !messageText.trim()) {
    return { mentions: dedupeMentions(structuredMentions), messageText };
  }

  if (!messageText.includes("@")) return { mentions: [], messageText };

  try {
    const fallback = await systemAI.extractMentions({
      messageText,
      participatingRoles: conversation.participating_roles
        .map((roleName) => resolveConversationRole(deps, conversationId, roleName)?.name ?? roleName)
        .map((name) => ({ name })),
    });
    logger.debug(`[resolveMentions] LLM fallback extracted ${fallback.mentions.length} mentions`);
    return {
      messageText,
      mentions: dedupeMentions(
        fallback.mentions
          .filter((item) => conversation.participating_roles.includes(item.role))
          .map((item) => ({ roleName: item.role, raw: item.raw, source: "llm_fallback" as const })),
      ),
    };
  } catch (error) {
    logger.warn("[resolveMentions] LLM mention extraction failed, falling back to structured mentions only", { error });
    return { mentions: [], messageText };
  }
}
