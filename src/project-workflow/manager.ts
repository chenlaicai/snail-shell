import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { SnailAgentResolver } from "../agent/resolver";
import type {
  Conversation,
  ConversationKind,
  ConversationStore,
  CreateKnowledgeInput,
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  Feature,
  KnowledgeApprovalInput,
  KnowledgeListFilters,
  KnowledgeSearchResult,
  KnowledgeWithDetails,
  MessageWithEvents,
  Project,
  RecordKnowledgeUseInput,
  RoleName,
  Stage,
} from "../persistence/store";
import { buildConversationSystemPrompt } from "../roles";
import type { AgentCapability } from "../agent/capability";
import { logger } from "../logger";
import type { CollaborationInvocationOptions, MentionResolution } from "../message-bus/collaboration";
import type { BossMentionItem, ConversationDetail, ConversationDispatchState, ConversationHistorySearchPage, ConversationHistoryWindow, ConversationMessagesPage, FeatureDetail, ConversationRecentMessagesSnapshot, ProjectDetail, ProjectManagerDeps, ProjectSummary, StageDetail } from "./manager-types";
import { buildBossMentionItem, buildConversationBadgePayload, sumBossPendingCount } from "./manager-events";
import * as managerQueries from "./manager-queries";
export type { BossMentionItem, ConversationDetail, ConversationDispatchState, ConversationHistorySearchPage, ConversationHistoryWindow, ConversationMessagesPage, ProjectDetail, ProjectManagerDeps, ProjectSummary, StageDetail, FeatureDetail } from "./manager-types";
import { sendStructuredMessage as sendStructuredMessageWithCollaboration, structuredMentionsFromEvents } from "../message-bus/collaboration";
import { ConversationQueue } from "./conversation-queue";
import { MessageInterruptRegistry } from "../message-bus/message-interrupt";
import { advanceFeatureWorkflow, createFeatureWorkflow, createInitialWorkflow, createStageConversation, restartFeatureDevelopmentWorkflow } from "./workflow";
import { resolveProjectRoot } from "./default-project-dir";
import { buildMessagePreview, buildPlainTextEvent, getInputContent, type MessageInputEvent } from "../message-bus/message-events";
import { dedupeMentions } from "../message-bus/mentions";
import { cleanupFeatureRepoContext, type RepoCleanupResult } from "./repo-cleanup";
import { recoverOrphanedStreamingAssistantMessages, type StartupRecoveryResult } from "./startup-recovery";
import { buildKnowledgeGovernanceSystemPrompt } from "../knowledge-center/governance-prompt";
import type { RoleDefinition } from "../roles";
import * as knowledgeCenter from "../knowledge-center/knowledge-service";

/**
 * 非 boss role 之间的最大协作轮次，超过后强制由 default_role 收口。
 * 设为 30 是为了支持复杂任务下更长的多 role 循环讨论，同时保留收口上限，避免协作链无限延伸。
 */
const MAX_COLLABORATION_ROUNDS = 30;

// 构建 agent 上下文时默认包含的最近用户消息窗口数
// 设为 3 是为了提供足够的对话上下文，同时控制 prompt 长度
const DEFAULT_AGENT_HISTORY_USER_MESSAGE_LIMIT = 3;

export class ProjectManager extends EventEmitter {
  private readonly conversationQueue = new ConversationQueue();
  private readonly messageInterrupts = new MessageInterruptRegistry();
  private readonly repoRoot: string;
  private readonly startupRecovery: Promise<StartupRecoveryResult>;

  private readonly defaultSopKey?: string;

  constructor(
    private store: ConversationStore,
    private agentResolver: SnailAgentResolver,
    private deps: ProjectManagerDeps,
    options: { repoRoot?: string; defaultSopKey?: string } = {}
  ) {
    super();
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.defaultSopKey = options.defaultSopKey;
    // TODO: 临时关闭摘要生成，当前依赖 agent 端状态记录；待 agent 端摘要能力稳定后恢复
    this.startupRecovery = recoverOrphanedStreamingAssistantMessages({ store: this.store, summaryGenerator: null });
  }

  async waitForStartupRecovery(): Promise<StartupRecoveryResult> {
    return this.startupRecovery;
  }

  createProject(name: string, input: { summary?: string; projectRoot?: string; sopId?: string; roleBindings: Record<string, string> }): { project: Project; feature: Feature; stage: Stage; conversation: Conversation } {
    const projectId = randomUUID();
    const resolvedRoot = resolveProjectRoot(projectId, input.projectRoot || undefined);
    const result = createInitialWorkflow(
      { store: this.store, roleRegistry: this.deps.roleRegistry },
      { name, summary: input.summary, projectRoot: resolvedRoot, projectId, sopId: input.sopId, roleBindings: input.roleBindings, defaultSopKey: this.defaultSopKey },
    );
    logger.info("ProjectManager initialized project workflow", { projectId: result.project.id, featureId: result.feature.id, stageId: result.stage.id, conversationId: result.conversation.id });
    return result;
  }

  listProjects(limit = 50, offset = 0): ProjectSummary[] {
    return this.store.listProjects(limit, offset).map((project) => ({
      ...project,
      conversation_count: this.store.listConversationsByProject(project.id).length,
      stage_count: this.store.listStages(project.id).length,
      feature_count: this.store.listFeatures(project.id).length,
      boss_pending_count: sumBossPendingCount(this.store.listConversationsByProject(project.id), (conversationId) => this.store.listBossPendingDispatches(conversationId).length),
    }));
  }

  getProject(projectId: string): ProjectDetail | null {
    const project = this.store.getProject(projectId);
    if (!project) return null;
    const stages = this.store.listStages(projectId);
    const features = this.store.listFeatures(projectId).map((feature) => this.buildFeatureDetail(feature));
    return {
      ...project,
      conversation_count: this.store.listConversationsByProject(projectId).length,
      stage_count: stages.length,
      feature_count: features.length,
      features,
      boss_pending_count: sumBossPendingCount(this.store.listConversationsByProject(project.id), (conversationId) => this.store.listBossPendingDispatches(conversationId).length),
    };
  }

  createFeature(projectId: string, title: string, summary?: string, adoptedSopId?: string): { feature: Feature; stage: Stage; conversation: Conversation } {
    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const result = createFeatureWorkflow({ store: this.store, roleRegistry: this.deps.roleRegistry }, { project, title, summary, adoptedSopId });
    logger.info("ProjectManager created feature workflow", { projectId, featureId: result.feature.id, stageId: result.stage.id, conversationId: result.conversation.id });
    return result;
  }

  getFeature(featureId: string): FeatureDetail | null { const feature = this.store.getFeature(featureId); return feature ? this.buildFeatureDetail(feature) : null; }

  listFeatures(projectId: string): FeatureDetail[] {
    return this.store.listFeatures(projectId).map((feature) => this.buildFeatureDetail(feature));
  }

  listStages(projectId: string): StageDetail[] {
    return this.store.listStages(projectId).map((stage) => this.buildStageDetail(stage));
  }

  getStage(stageId: string): StageDetail | null {
    const stage = this.store.getStage(stageId);
    return stage ? this.buildStageDetail(stage) : null;
  }

  advanceFeature(featureId: string) {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
    const project = this.store.getProject(feature.project_id);
    if (!project) {
      throw new Error(`Project not found: ${feature.project_id}`);
    }

    const activeStage = this.store.getActiveStage(featureId);
    if (!activeStage) {
      throw new Error(`No active stage found for feature: ${featureId}`);
    }

    this.assertStageCanAdvance(activeStage.id);
    const result = advanceFeatureWorkflow({ store: this.store, roleRegistry: this.deps.roleRegistry }, project, feature, activeStage);
    logger.info("ProjectManager advanced feature", {
      projectId: project.id,
      featureId,
      completedStageId: result.completed_stage.id,
      nextStageId: result.next_stage?.id ?? null,
      nextConversationId: result.conversation?.id ?? null,
    });
    return this.buildFeatureAdvanceResult(result);
  }

  restartFeatureDevelopment(featureId: string, stageId: string) {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
    const project = this.store.getProject(feature.project_id);
    if (!project) throw new Error(`Project not found: ${feature.project_id}`);
    const restartStage = this.getRestartSourceStage(featureId, stageId);

    const result = restartFeatureDevelopmentWorkflow({ store: this.store, roleRegistry: this.deps.roleRegistry }, project, feature, restartStage);
    logger.info("ProjectManager restarted feature development", { projectId: project.id, featureId, completedStageId: result.completed_stage.id, nextStageId: result.next_stage?.id, nextConversationId: result.conversation?.id });
    return this.buildFeatureAdvanceResult(result);
  }

  private getRestartSourceStage(featureId: string, stageId: string): Stage {
    const stages = this.store.listStagesByFeature(featureId);
    const latestStage = stages[stages.length - 1];
    if (!latestStage || latestStage.id !== stageId) throw new Error("Development cycle restart stage does not match latest feature stage");
    if (latestStage.type !== "review" && latestStage.type !== "development") throw new Error("Only development or review stages can restart development");
    return latestStage;
  }

  setFeatureTaskAnchor(featureId: string, taskAnchor: string): Feature {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
    return this.store.updateFeature(featureId, { task_anchor: taskAnchor });
  }

  setFeatureRoleSnail(featureId: string, stageId: string, roleName: string, snailTemplateId: string): Feature {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
    const stage = this.store.getStage(stageId);
    if (!stage || stage.feature_id !== featureId) throw new Error(`Stage not found or does not belong to feature: ${stageId}`);
    const template = this.deps.snailDen.getTemplate(snailTemplateId);
    if (!template) throw new Error(`Snail template not found: ${snailTemplateId}`);
    const roles = this.store.listRoleDefinitionsByStageAndProject(stage.stage_definition_id, stage.project_id);
    if (!roles.some((r) => r.name === roleName)) throw new Error(`Invalid role '${roleName}' for stage '${stageId}'`);
    const updated = { ...feature.role_snail_mapping };
    if (!updated[stageId]) updated[stageId] = {};
    updated[stageId][roleName] = snailTemplateId;
    return this.store.updateFeature(featureId, { role_snail_mapping: updated });
  }

  completeFeature(featureId: string): { feature: Feature; cleanup: RepoCleanupResult } {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
    const activeStage = this.store.getActiveStage(featureId);
    const cleanup = cleanupFeatureRepoContext(activeStage?.output_artifacts ?? {}, { repoRoot: this.repoRoot });
    const completedFeature = this.store.updateFeature(featureId, { closed_at: new Date().toISOString() });
    logger.info("ProjectManager completed feature", { featureId, cleanup });
    return { feature: completedFeature, cleanup };
  }

  archiveFeature(featureId: string): { feature: Feature; cleanup: RepoCleanupResult } {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    const activeStage = this.store.getActiveStage(featureId);
    const cleanup = cleanupFeatureRepoContext(activeStage?.output_artifacts ?? {}, { repoRoot: this.repoRoot });
    const archivedFeature = this.store.updateFeature(featureId, { closed_at: feature.closed_at ?? new Date().toISOString() });
    logger.info("ProjectManager archived feature", { featureId, cleanup });
    return { feature: archivedFeature, cleanup };
  }

  updateStage(stageId: string, updates: Partial<Pick<Stage, "status" | "output_artifacts" | "entered_at" | "left_at">>): Stage {
    this.assertStageFeatureWritable(stageId);
    return this.store.updateStage(stageId, updates);
  }

  createConversation(
    input: { projectId: string; featureId: string; stageId: string; title: string; kind: ConversationKind; fromConversationIds?: string[]; summary?: string }
  ): Conversation {
    const project = this.store.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }
    const feature = this.store.getFeature(input.featureId);
    if (!feature) {
      throw new Error(`Feature not found: ${input.featureId}`);
    }
    this.assertFeatureWritable(feature);
    const conversation = createStageConversation(
      { store: this.store, roleRegistry: this.deps.roleRegistry },
      input
    );
    logger.info("ProjectManager created conversation", { conversationId: conversation.id, projectId: input.projectId, featureId: input.featureId, stageId: input.stageId, roleName: conversation.default_role });
    return conversation;
  }

  listProjectConversations(projectId: string): ConversationDetail[] { return this.store.listConversationsByProject(projectId).map((conversation) => this.buildConversationDetail(conversation)); }

  listStageConversations(stageId: string): ConversationDetail[] {
    return this.store.listConversationsByStage(stageId).map((conversation) => this.buildConversationDetail(conversation));
  }

  listFeatureConversations(featureId: string): ConversationDetail[] {
    return this.store.listConversationsByFeature(featureId).map((conversation) => this.buildConversationDetail(conversation));
  }

  getConversation(conversationId: string): ConversationDetail | null {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) return null;
    return this.buildConversationDetail(conversation);
  }

  async sendMessage(conversationId: string, userContent: string): Promise<{ messageIds: number[] }> {
    return this.sendStructuredMessage(conversationId, [buildPlainTextEvent(userContent)]);
  }

  async sendStructuredMessage(
    conversationId: string,
    userParts: MessageInputEvent[],
    fromRole: RoleName = "Boss Role",
    quotedMessageId: number | null = null,
    askerRole: RoleName | null = null,
    clientId: string | null = null
  ): Promise<{ messageIds: number[] }> {
    this.assertConversationFeatureWritable(conversationId);
    return this.conversationQueue.enqueue(conversationId, async () => {
      const result = await sendStructuredMessageWithCollaboration(
        {
          store: this.store,
          emitAgentEvent: (targetConversationId: string, event: Record<string, unknown>) => this.emit("agent-event", targetConversationId, event),
          buildConversationSystemPrompt: (targetConversationId: string, options: CollaborationInvocationOptions) => this.buildConversationSystemPrompt(targetConversationId, options),
          resolveMentions: (targetConversationId, events, isAgentReply) => this.resolveMentions(targetConversationId, events, isAgentReply),
          refreshConversationSummary: (targetConversationId: string) => this.refreshConversationSummary(targetConversationId),
          // TODO: 临时关闭摘要生成，当前依赖 agent 端状态记录；待 agent 端摘要能力稳定后恢复
          messageContextSummaryGenerator: null,
          resolveRole: (roleName: RoleName) => this.resolveConversationRole(conversationId, roleName),
          resolveRuntimeByRole: (role) => {
            const templateId = role.snail_template_id ?? this.deps.roleRegistry.getSnailTemplateId(role.project_id, role.id);
            if (!templateId) throw new Error(`No snail template for role: ${role.name}`);
            const instance = this.deps.snailDen.getSnailRuntime(templateId);
            return instance.runtime;
          },
          resolveModelForRole: (role) => {
            const templateId = role.snail_template_id ?? this.deps.roleRegistry.getSnailTemplateId(role.project_id, role.id);
            return templateId ? this.deps.snailDen.getTemplate(templateId)?.model : undefined;
          },
          resolveContextWindowForRole: (role) => {
            const templateId = role.snail_template_id ?? this.deps.roleRegistry.getSnailTemplateId(role.project_id, role.id);
            return templateId ? this.deps.snailDen.getTemplate(templateId)?.contextWindow ?? undefined : undefined;
          },
          resolveTimeoutForRole: (role) => {
            const templateId = role.snail_template_id ?? this.deps.roleRegistry.getSnailTemplateId(role.project_id, role.id);
            return templateId ? this.deps.snailDen.getTemplate(templateId)?.invocationTimeoutMs ?? undefined : undefined;
          },
          lookupOrCreateSnailAgentSession: (targetConversationId: string, roleName: string, role) => {
            const existing = this.store.getCurrentSnailAgentSession(targetConversationId, roleName);
            const templateId = role.snail_template_id ?? this.deps.roleRegistry.getSnailTemplateId(role.project_id, role.id);
            if (!templateId) throw new Error(`No snail template for role: ${roleName}`);
            const template = this.deps.snailDen.getTemplate(templateId);
            if (!template) throw new Error(`Snail template not found: ${templateId}`);
            if (existing && existing.runtime === template.runtime && existing.model === template.model) return existing;
            return this.store.createSnailAgentSession({
              id: `${targetConversationId}:${roleName}:${Date.now()}`,
              conversationId: targetConversationId,
              roleName,
              runtime: template.runtime,
              model: template.model,
              contextProvider: template.contextProvider,
            });
          },
          updateSnailAgentSessionExternalId: (sessionId: string, externalSessionId: string | null) => {
            this.store.updateSnailAgentSessionExternalId(sessionId, externalSessionId);
          },
          createInterruptController: () => this.messageInterrupts.createRunController(),
          bindInterruptMessage: (targetConversationId: string, messageId: number, controller: AbortController) => this.messageInterrupts.bindMessage(targetConversationId, messageId, controller),
          finishInterruptMessage: (targetConversationId: string, messageId: number) => this.messageInterrupts.finishMessage(targetConversationId, messageId),
        },
        conversationId,
        userParts,
        MAX_COLLABORATION_ROUNDS,
        { fromRole, quotedMessageId, askerRole, clientId }
      );
      this.emitConversationBadgeUpdate(conversationId);
      return result;
    });
  }

  async sendConversationMessage(conversationId: string, input: { content?: string; events?: MessageInputEvent[]; fromRole?: RoleName; quotedMessageId?: number | null; clientId?: string | null }): Promise<{ messageIds: number[] } | { error: { message: string } }> {
    try {
      const events = input.events ?? (input.content ? [buildPlainTextEvent(input.content)] : []);
      if (events.length === 0) {
        return { error: { message: "No content provided" } };
      }
      const result = await this.sendStructuredMessage(
        conversationId,
        events,
        input.fromRole ?? "Boss Role",
        input.quotedMessageId ?? null,
        null,
        input.clientId ?? null
      );
      return result;
    } catch (err: any) {
      return { error: { message: err.message } };
    }
  }

  interruptMessage(conversationId: string, messageId: number): { interrupted: boolean } {
    this.assertConversationFeatureWritable(conversationId);
    const message = this.store.getMessage(messageId, conversationId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    if (message.role !== "assistant") throw new Error(`Message is not interruptible: ${messageId}`);
    return { interrupted: this.messageInterrupts.interrupt(conversationId, messageId) };
  }

  /** 中断所有正在运行的 agent 任务，用于服务关闭时清理残留子进程。 */
  interruptAllRunningMessages(): void {
    this.messageInterrupts.interruptAll();
  }

  getConversationMessages(conversationId: string, limit = 100, offset = 0): MessageWithEvents[] {
    return managerQueries.getConversationMessages(this.store, conversationId, limit, offset);
  }

  getRecentConversationMessages(conversationId: string, limit = DEFAULT_AGENT_HISTORY_USER_MESSAGE_LIMIT): ConversationRecentMessagesSnapshot {
    return managerQueries.getRecentConversationMessages(this.store, conversationId, limit);
  }

  getConversationEventsAfter(conversationId: string, afterEventId: number): ReturnType<ConversationStore["getMessageEventsAfter"]> {
    return managerQueries.getConversationEventsAfter(this.store, conversationId, afterEventId);
  }

  getLastConversationEventId(conversationId: string): number {
    return managerQueries.getLastConversationEventId(this.store, conversationId);
  }

  getConversationEventsBetween(conversationId: string, afterEventId: number, untilEventId: number): ReturnType<ConversationStore["getMessageEventsAfter"]> {
    return managerQueries.getConversationEventsBetween(this.store, conversationId, afterEventId, untilEventId);
  }

  getConversationMessagesByIds(conversationId: string, messageIds: number[]): MessageWithEvents[] {
    return managerQueries.getConversationMessagesByIds(this.store, conversationId, messageIds);
  }

  getConversationMessageWindow(conversationId: string, anchorMessageId: number, before = 2, after = 2): ConversationHistoryWindow {
    return managerQueries.getConversationMessageWindow({ store: this.store, conversationId, anchorMessageId, before, after });
  }

  getConversationMessagesPage(conversationId: string, options: { limit?: number; offset?: number; before?: number } = {}): ConversationMessagesPage {
    return managerQueries.getConversationMessagesPage(this.store, conversationId, options);
  }

  getConversationDispatchState(conversationId: string): ConversationDispatchState {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const grouped = this.store.listDispatchInboxGroups(conversationId);

    return {
      dispatches: this.store.listDispatches(conversationId),
      inbox_groups: grouped.map((group) => this.attachDispatchGroupPreviews(conversationId, group)),
    };
  }

  getBossMentions(conversationId: string): BossMentionItem[] {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    return this.store.listBossPendingDispatches(conversationId)
      .map((dispatch) => buildBossMentionItem(dispatch, this.store.getMessagesByIds(conversationId, [dispatch.message_id])[0]))
      .filter((item) => item.preview || item.message_id);
  }

  acknowledgeBossMentions(conversationId: string): BossMentionItem[] {
    const mentions = this.getBossMentions(conversationId);
    this.store.markConversationDispatchesSeen(conversationId, mentions.map((item) => item.dispatch_id));
    this.emitConversationBadgeUpdate(conversationId);
    return mentions;
  }

  searchConversationHistory(conversationId: string, query: string, limit = 5, offset = 0): ConversationHistorySearchPage {
    return managerQueries.searchConversationHistory({ store: this.store, conversationId, query, limit, offset });
  }

  listRoles() { return this.deps.roleRegistry.list(); }
  listSops(scope?: "global" | "project") { return this.store.listSops(scope); }
  getSop(sopId: string) { return this.store.getSop(sopId); }
  listSopRoleDefinitions(sopId: string) { return this.store.listSopRoleDefinitions(sopId); }
  listSopStageDefinitions(sopId: string) { return this.store.listSopStageDefinitions(sopId); }
  listProjectSops(projectId: string) { return this.store.listProjectSops(projectId); }
  createProjectSop(input: { projectId: string; sopId: string; isDefault: boolean; roleBindings: Record<string, string> }) { const r = this.store.createProjectSop({ id: randomUUID(), ...input }); this.deps.roleRegistry.reloadFromStore(); return r; }
  updateProjectSop(projectId: string, sopId: string, updates: { isDefault?: boolean; roleBindings?: Record<string, string> }) { const r = this.store.updateProjectSop(projectId, sopId, updates); this.deps.roleRegistry.reloadFromStore(); return r; }
  deleteProjectSop(projectId: string, sopId: string) { const r = this.store.deleteProjectSop(projectId, sopId); this.deps.roleRegistry.reloadFromStore(); return r; }

  createKnowledge(input: Omit<CreateKnowledgeInput, "id">): KnowledgeWithDetails { return knowledgeCenter.createKnowledge(this.store, input); }
  listKnowledgeGovernance(limit = 50, offset = 0) { return knowledgeCenter.listKnowledgeGovernance(this.store, limit, offset); }
  getKnowledgeGovernance(id: string) { return knowledgeCenter.getKnowledgeGovernance(this.store, id); }
  updateKnowledgeGovernance(id: string, input: any) { return knowledgeCenter.updateKnowledgeGovernance(this.store, id, input); }

  listKnowledge(filters: KnowledgeListFilters = {}): KnowledgeSearchResult[] {
    return knowledgeCenter.listKnowledge(this.store, filters);
  }

  getKnowledge(id: string): KnowledgeWithDetails | null {
    return knowledgeCenter.getKnowledge(this.store, id);
  }

  approveKnowledge(id: string, input: KnowledgeApprovalInput): KnowledgeWithDetails {
    return knowledgeCenter.approveKnowledge(this.store, id, input);
  }

  rejectKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
    return knowledgeCenter.rejectKnowledge(this.store, id, reviewer, comment);
  }

  deprecateKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
    return knowledgeCenter.deprecateKnowledge(this.store, id, reviewer, comment);
  }

  archiveKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
    return knowledgeCenter.archiveKnowledge(this.store, id, reviewer, comment);
  }

  listKnowledgeUses(id: string) {
    return knowledgeCenter.listKnowledgeUses(this.store, id);
  }

  recordKnowledgeUse(input: Omit<RecordKnowledgeUseInput, "id">) {
    return knowledgeCenter.recordKnowledgeUse(this.store, input);
  }

  private buildConversationSystemPrompt(conversationId: string, options: CollaborationInvocationOptions): { systemPrompt: string; capability: AgentCapability } {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    if (conversation.owner_type === "knowledge_governance") {
      return buildKnowledgeGovernanceSystemPrompt({ store: this.store, roleRegistry: this.deps.roleRegistry, conversation, options });
    }

    if (!conversation.project_id || !conversation.feature_id || !conversation.stage_id) {
      throw new Error("Conversation context is incomplete");
    }

    const project = this.store.getProject(conversation.project_id);
    const feature = this.store.getFeature(conversation.feature_id);
    const stage = this.store.getStage(conversation.stage_id);
    if (!project || !feature || !stage) {
      throw new Error("Conversation context is incomplete");
    }
    const stageDetail = this.buildStageDetail(stage);

    const stageDefinition = this.store.getStageDefinition(stage.stage_definition_id);
    if (!stageDefinition) {
      throw new Error(`Stage definition not found: ${stage.stage_definition_id}`);
    }

    const roleDefinitions = this.store.listRoleDefinitionsByStageAndProject(stage.stage_definition_id, stage.project_id);
    const activeRole = this.resolveConversationRole(conversationId, options.activeRoleName);
    const defaultRole = this.resolveConversationRole(conversationId, conversation.default_role);

    return buildConversationSystemPrompt({
      project,
      feature,
      stage: stageDetail,
      conversation,
      stageDefinition,
      roleDefinitions,
      activeRole,
      defaultRole,
      remainingCollaborationRounds: options.remainingRounds,
      mentionAllowed: options.mentionAllowed,
      forcedWrapUp: options.forcedWrapUp,
      runtime: options.runtime,
      participatingRoles: conversation.participating_roles
        .map((roleName) => this.resolveConversationRole(conversationId, roleName))
        .filter(Boolean) as any,
      knowledgeLibrarySummaries: this.store.getKnowledgeLibraryKindSummaries(conversation.project_id),
    });
  }

  private resolveConversationRole(conversationId: string, roleName: RoleName): RoleDefinition | undefined {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) return undefined;
    if (!conversation.stage_id) return undefined;
    const stage = this.store.getStage(conversation.stage_id);
    if (!stage) return undefined;
    const roleDef = this.deps.roleRegistry.getByStageDefinitionName(stage.project_id, stage.stage_definition_id, roleName);
    if (!roleDef) return undefined;
    // Feature 级 role_snail_mapping 优先于项目模板，key 为 stage.id
    if (conversation.feature_id) {
      const feature = this.store.getFeature(conversation.feature_id);
      const templateId = feature?.role_snail_mapping?.[stage.id]?.[roleName];
      if (templateId) return { ...roleDef, snail_template_id: templateId };
    }
    return roleDef;
  }


  // TODO: 临时关闭摘要生成，当前依赖 agent 端状态记录；待 agent 端摘要能力稳定后恢复
  private async refreshConversationSummary(_conversationId: string): Promise<void> {
    // Summary generation disabled — relying on agent-side state tracking
  }

  private async resolveMentions(
    conversationId: string,
    events: MessageInputEvent[],
    isAgentMessage: boolean = false
  ): Promise<MentionResolution> {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const structuredMentions = structuredMentionsFromEvents(conversation, events);
    const messageText = getInputContent(events);
    logger.debug(`[resolveMentions] structured=${structuredMentions.length}, hasAt=${messageText.includes("@")}, isAgent=${isAgentMessage}`);

    if (structuredMentions.length > 0 || !messageText.trim()) {
      return { mentions: dedupeMentions(structuredMentions), messageText };
    }

    // Only call LLM fallback if message contains @
    if (!messageText.includes("@")) {
      return { mentions: [], messageText };
    }

    try {
      const fallback = await this.deps.systemAI.extractMentions({
        messageText,
        participatingRoles: conversation.participating_roles
          .map((roleName) => this.resolveConversationRole(conversationId, roleName)?.name ?? roleName)
          .map((name) => ({ name })),
      });

      logger.debug(`[resolveMentions] LLM fallback extracted ${fallback.mentions.length} mentions`);

      return {
        messageText,
        mentions: dedupeMentions(
          fallback.mentions
            .filter((item) => conversation.participating_roles.includes(item.role))
            .map((item) => ({ roleName: item.role, raw: item.raw, source: "llm_fallback" as const }))
        ),
      };
    } catch (error) {
      logger.warn("[resolveMentions] LLM mention extraction failed, falling back to structured mentions only", { error });
      return { mentions: [], messageText };
    }
  }

  private attachDispatchGroupPreviews(
    conversationId: string,
    group: DispatchInboxGroup
  ): DispatchInboxGroup & { messages: DispatchInboxPreviewItem[] } {
    const messages = this.store.getMessagesByIds(conversationId, group.message_ids)
      .map((message) => ({
        message_id: message.id,
        from_role: message.from_role,
        role: message.role,
        preview: buildMessagePreview(message),
        created_at: message.created_at,
      }));

    return {
      ...group,
      messages,
    };
  }

  private buildConversationDetail(conversation: Conversation): ConversationDetail {
    return {
      ...conversation,
      message_count: this.store.getMessages(conversation.id).length,
      boss_pending_count: this.store.listBossPendingDispatches(conversation.id).length,
    };
  }

  private buildStageDetail(stage: Stage): StageDetail {
    const definition = stage.stage_definition_id ? this.store.getStageDefinition(stage.stage_definition_id) : null;
    const roleDefinitions = stage.stage_definition_id ? this.store.listRoleDefinitionsByStageAndProject(stage.stage_definition_id, stage.project_id) : [];
    const previousStage = this.store.listStagesByFeature(stage.feature_id).find((item) => item.sequence === stage.sequence - 1);
    /** Feature 级 mapping 覆盖：role_snail_mapping[stageId][roleName] 优先于项目模板 snail_template_id */
    const mapping = this.store.getFeature(stage.feature_id)?.role_snail_mapping?.[stage.id] ?? {};
    return {
      ...stage,
      input_artifacts: previousStage?.output_artifacts ?? {},
      boss_pending_count: sumBossPendingCount(this.store.listConversationsByStage(stage.id), (conversationId) => this.store.listBossPendingDispatches(conversationId).length),
      stage_definition: definition ? {
        key: definition.key,
        title: definition.title,
        input_description: definition.input_description,
        output_description: definition.output_description,
        acceptance_focus: definition.acceptance_focus,
      } : null,
      role_definitions: roleDefinitions.map((rd) => ({
        name: rd.name,
        snail_template_id: mapping[rd.name] ?? rd.snail_template_id,
        is_primary: Boolean(rd.is_primary),
        description: rd.description,
        working_rules: rd.working_rules,
      })),
    };
  }

  private buildFeatureAdvanceResult(result: { completed_stage: Stage; next_stage: Stage | null; conversation: Conversation | null; feature: Feature }): { completed_stage: StageDetail; next_stage: StageDetail | null; conversation: Conversation | null; feature: Feature } {
    return {
      ...result,
      completed_stage: this.buildStageDetail(result.completed_stage),
      next_stage: result.next_stage ? this.buildStageDetail(result.next_stage) : null,
    };
  }

  private buildFeatureDetail(feature: Feature): FeatureDetail {
    const stages = this.store.listStagesByFeature(feature.id).map((stage) => this.buildStageDetail(stage));
    const conversations = this.store.listConversationsByFeature(feature.id);
    const currentStage = stages.find((stage) => stage.status === "in_progress") ?? stages[stages.length - 1] ?? null;
    return {
      ...feature,
      stages,
      current_stage: currentStage,
      conversation_count: conversations.length,
      boss_pending_count: sumBossPendingCount(conversations, (conversationId) => this.store.listBossPendingDispatches(conversationId).length),
    };
  }

  private assertFeatureWritable(feature: Feature): void {
    if (feature.closed_at !== null) {
      throw new Error("Closed feature is read-only");
    }
  }

  private assertFeatureIdWritable(featureId: string): void {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
  }

  private assertStageFeatureWritable(stageId: string): void {
    const stage = this.store.getStage(stageId); if (!stage) throw new Error(`Stage not found: ${stageId}`);
    this.assertFeatureIdWritable(stage.feature_id);
  }

  private assertConversationFeatureWritable(conversationId: string): void {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    if (conversation.owner_type === "knowledge_governance") return;
    if (!conversation.feature_id) throw new Error("Conversation feature context is incomplete");
    this.assertFeatureIdWritable(conversation.feature_id);
  }

  private assertStageCanAdvance(stageId: string): void {
    const stage = this.store.getStage(stageId);
    if (!stage) throw new Error(`Stage not found: ${stageId}`);
    if (!Object.keys(stage.output_artifacts).length) throw new Error("Stage cannot advance without output artifacts");
    logger.debug("Stage advance validation passed", { stageId, outputArtifacts: stage.output_artifacts });
  }

  private emitConversationBadgeUpdate(conversationId: string): void { const conversation = this.getConversation(conversationId); if (conversation) this.emit("conversation-badge", buildConversationBadgePayload(conversation)); }
}
