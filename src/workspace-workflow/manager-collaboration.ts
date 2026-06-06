/**
 * WorkspaceManager 的协作子系统：系统提示词构建、角色解析和 mention 解析。
 *
 * 从 manager.ts 拆出以满足文件行数限制（max 400）。
 */
import type { Conversation, ConversationStore, Issue, RoleName } from "../persistence/store";
import type { SopSnapshot } from "../shared/types";
import { SopSnapshotReader } from "./sop-snapshot-reader";
import { buildConversationSystemPrompt } from "../roles";
import type { AgentCapability } from "../agent/capability";
import { logger } from "../logger";
import type { CollaborationInvocationOptions, MentionResolution } from "../message-bus/collaboration";
import { structuredMentionsFromEvents } from "../message-bus/collaboration";
import { getInputContent, type MessageInputEvent } from "../message-bus/message-events";
import { dedupeMentions } from "../message-bus/mentions";
import { buildEvolutionSystemPrompt } from "../evolution-center/evolution-prompt";
import type { RoleDefinition } from "../roles";
import type { SnailDen } from "../snail-den";
import type { SystemAI } from "../snail-den/system-ai";
import { loadWorkspaceContext } from "./snail-loader";

/** resolveConversationSystemPrompt / resolveMentions 所需的外部依赖。 */
export interface CollaborationDeps {
  store: ConversationStore;
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
  const { store } = deps;
  const conversation = store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  if (conversation.owner_type === "evolution") {
    return buildEvolutionSystemPrompt({ store, conversation, options });
  }
  return buildWorkflowSystemPrompt(deps, conversationId, conversation, options);
}

function buildWorkflowSystemPrompt(
  deps: CollaborationDeps,
  conversationId: string,
  conversation: Conversation,
  options: CollaborationInvocationOptions,
): { systemPrompt: string; capability: AgentCapability } {
  const ctx = resolveWorkflowContext(deps, conversationId, conversation, options);
  const result = buildConversationSystemPrompt(ctx.promptInput);
  if (ctx.issue.sop_snapshot.sop_id) appendTransitionHint(deps.store, ctx.reader, ctx.stage, result);
  return result;
}

/** Resolve all context needed for building the workflow system prompt. */
function resolveWorkflowContext(deps: CollaborationDeps, conversationId: string, conversation: Conversation, options: CollaborationInvocationOptions) {
  const { store } = deps;
  if (!conversation.workspace_id || !conversation.issue_id || !conversation.stage_id) throw new Error("Conversation context is incomplete");
  const workspace = store.getWorkspace(conversation.workspace_id);
  const issue = store.getIssue(conversation.issue_id);
  const stage = store.getStage(conversation.stage_id);
  if (!workspace || !issue || !stage) throw new Error("Conversation context is incomplete");
  const reader = createSnapshotReader(issue);
  const stageDefinition = reader.getStageDefinition(stage.type, workspace.id);
  if (!stageDefinition) throw new Error(`Stage definition not found: ${stage.type}`);
  const roleDefinitions = reader.listRoleDefinitionsByStage(stage.type);
  const activeRole = resolveConversationRole(deps, conversationId, options.activeRoleName);
  const defaultRole = resolveConversationRole(deps, conversationId, conversation.default_role);
  const previousStage = store.listStagesByIssue(issue.id).find((s) => s.sequence === stage.sequence - 1);
  const participatingRoles = conversation.participating_roles.map((roleName) => resolveConversationRole(deps, conversationId, roleName)).filter(Boolean) as RoleDefinition[];
  const workspaceContext = loadWorkspaceContextSafe(workspace.workspace_root);
  return {
    issue, reader, stage,
    promptInput: {
      workspace, issue, stage: { id: stage.id, issue_id: stage.issue_id, type: stage.type, output_artifacts: stage.output_artifacts, input_artifacts: previousStage?.output_artifacts ?? {} },
      conversation, stageDefinition, roleDefinitions, activeRole, defaultRole,
      remainingCollaborationRounds: options.remainingRounds, mentionAllowed: options.mentionAllowed, forcedWrapUp: options.forcedWrapUp, runtime: options.runtime,
      snailDisplayName: resolveSnailDisplayName(deps, activeRole, options), participatingRoles,
      knowledgeLibrarySummaries: store.summaryKnowledgeLibrary(workspace.id),
      sharedHandbook: reader.getSop().shared_handbook, workspacePrompts: workspaceContext.prompts, workspaceSkills: workspaceContext.skills,
    },
  };
}

/**
 * 向系统提示词注入当前 stage 可用的转移目标和 gate 状态。
 * Why: 让 AI 知道可通过 stage_transition proposal 发起转移，
 * 以及当前验收清单的完成状态，便于判断是否建议转移。
 */
function appendTransitionHint(
  store: ConversationStore,
  reader: SopSnapshotReader,
  stage: { id: string; type: string },
  result: { systemPrompt: string; capability: AgentCapability },
): void {
  const edges = reader.getForwardTransitions(stage.type);
  if (edges.length === 0) {
    result.capability.systemReminder += `\n\n## Stage 转移\n当前 stage "${stage.type}" 无可用转移目标（终端阶段）。`;
    return;
  }
  const targets = edges.map((t) => t.to_stage_key).join(", ");
  let hint = `\n\n## 可用 Stage 转移\n当前 stage "${stage.type}" 可转移到: ${targets}。通过 stage_transition proposal 发起转移。`;

  // 注入 gate_evidence 状态，帮助 AI 判断是否满足转移条件
  const currentStage = store.getStage(stage.id);
  if (currentStage?.gate_evidence?.items?.length) {
    const items = currentStage.gate_evidence.items;
    const passed = items.filter((i) => i.status === "passed").length;
    const failed = items.filter((i) => i.status === "failed").length;
    const skipped = items.filter((i) => i.status === "skipped").length;
    hint += `\nGate 自检状态: ${passed} passed, ${failed} failed, ${skipped} skipped (共 ${items.length} 项)。`;
  } else {
    hint += "\nGate 自检状态: 尚未执行自检。建议在提议转移前完成验收清单自查。";
  }
  result.capability.systemReminder += hint;
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
 * 从 issue.sop_snapshot 读取角色定义，role_snail_mapping 应用模板绑定。
 * Evolution conversation 从 evolution config role_bindings 回退。
 */
export function resolveConversationRole(
  deps: CollaborationDeps,
  conversationId: string,
  roleName: RoleName,
): RoleDefinition | undefined {
  const { store } = deps;
  const ctx = resolveRoleContext(store, conversationId);
  if (!ctx) return undefined;

  const reader = new SopSnapshotReader(ctx.issue.sop_snapshot);
  const roleDef = reader.listRoleDefinitionsByStage(ctx.stage.type).find((r) => r.name === roleName);
  if (!roleDef) return undefined;

  return resolveTemplateId({ store: ctx.store, conversation: ctx.conversation, issue: ctx.issue, stageType: ctx.stage.type }, roleName, roleDef);
}

function resolveRoleContext(store: ConversationStore, conversationId: string): { store: ConversationStore; conversation: Conversation; issue: Issue; stage: { id: string; stage_definition_id: string; type: string } } | undefined {
  const conversation = store.getConversation(conversationId);
  if (!conversation?.stage_id || !conversation.issue_id) return undefined;
  const stage = store.getStage(conversation.stage_id);
  const issue = store.getIssue(conversation.issue_id);
  if (!stage || !issue) return undefined;
  return { store, conversation, issue, stage };
}

function resolveTemplateId(ctx: { store: ConversationStore; conversation: Conversation; issue: Issue; stageType: string }, roleName: RoleName, roleDef: RoleDefinition): RoleDefinition {
  const issueTemplateId = ctx.issue.role_snail_mapping?.[ctx.stageType]?.[roleDef.key] ?? ctx.issue.role_snail_mapping?.[ctx.stageType]?.[roleName];
  if (issueTemplateId) return { ...roleDef, snail_template_id: issueTemplateId };
  // TODO: 演化项创建时 role_snail_mapping 为空，需要从 evolution config fallback
  // 待演化项创建 API 支持 role_snail_mapping 后移除此 fallback
  return resolveEvolutionTemplateId(ctx.store, ctx.conversation, roleDef);
}

function resolveEvolutionTemplateId(store: ConversationStore, conversation: Conversation, roleDef: RoleDefinition): RoleDefinition {
  if (conversation.owner_type !== "evolution") return roleDef;
  const evolutionConfig = store.getEvolutionConfig();
  const evolutionTemplateId = evolutionConfig?.role_bindings?.[roleDef.key];
  return evolutionTemplateId ? { ...roleDef, snail_template_id: evolutionTemplateId } : roleDef;
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

/** Create SopSnapshotReader with error context for old issues without snapshot. */
function createSnapshotReader(issue: { id: string; sop_snapshot: SopSnapshot }): SopSnapshotReader {
  try {
    return new SopSnapshotReader(issue.sop_snapshot);
  } catch (err) {
    throw new Error(`Cannot build system prompt for issue ${issue.id}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}
