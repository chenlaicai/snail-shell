import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { SnailAgentResolver } from "../agent/resolver";
import type {
  Conversation,
  ConversationKind,
  ConversationStore,
  CreateEvolutionItemInput,
  EvolutionItemListFilters,
  EvolutionItemSearchResult,
  EvolutionItemWithConversation,
  Feature,
  MessageWithEvents,
  RoleName,
  Stage,
  UpdateEvolutionItemInput,
} from "../persistence/store";
import { logger } from "../logger";
import type { CollaborationInvocationOptions } from "../message-bus/collaboration";
import type { BossMentionItem, ConversationDetail, ConversationHistorySearchPage, ConversationHistoryWindow, ConversationMessagesPage, FeatureDetail, ConversationRecentMessagesSnapshot, WorkspaceDetail, WorkspaceManagerDeps, WorkspaceSummary, StageDetail } from "./manager-types";
import { buildConversationBadgePayload, sumBossPendingCount } from "./manager-events";
import * as managerQueries from "./manager-queries";
export type { BossMentionItem, ConversationDetail, ConversationDispatchState, ConversationHistorySearchPage, ConversationHistoryWindow, ConversationMessagesPage, WorkspaceDetail, WorkspaceManagerDeps, WorkspaceSummary, StageDetail, FeatureDetail } from "./manager-types";
import type { ConversationDispatchState } from "./manager-types";
import { sendStructuredMessage as sendStructuredMessageWithCollaboration } from "../message-bus/collaboration";
import { ConversationQueue } from "./conversation-queue";
import { MessageInterruptRegistry } from "../message-bus/message-interrupt";
import { transitionFeatureStage, createFeatureWorkflow, createInitialWorkflow, createStageConversation } from "./workflow";
import { resolveWorkspaceRoot } from "./default-workspace-dir";
import { buildPlainTextEvent, type MessageInputEvent } from "../message-bus/message-events";
import { cleanupFeatureRepoContext, type RepoCleanupResult } from "./repo-cleanup";
import { recoverOrphanedStreamingAssistantMessages, type StartupRecoveryResult } from "./startup-recovery";

import * as evolutionCenter from "../evolution-center/evolution-service";
import { resolveConversationSystemPrompt, resolveConversationRole, resolveMentions, type CollaborationDeps } from "./manager-collaboration";
import { buildStageDetail, buildFeatureDetail, buildConversationDetail, getConversationDispatchState, getBossMentions, assertFeatureWritable, assertConversationFeatureWritable, assertStageCanAdvance } from "./manager-detail";
import { hasSnailDirectory, loadSnailConfig, convertSnailConfigToSeed, initializeSnailDirectory } from "./snail-loader";

/**
 * 非 boss role 之间的最大协作轮次，超过后强制由 default_role 收口。
 * 设为 30 是为了支持复杂任务下更长的多 role 循环讨论，同时保留收口上限，避免协作链无限延伸。
 */
const MAX_COLLABORATION_ROUNDS = 30;

const DEFAULT_AGENT_HISTORY_USER_MESSAGE_LIMIT = 3;

export class WorkspaceManager extends EventEmitter {
  private readonly conversationQueue = new ConversationQueue();
  private readonly messageInterrupts = new MessageInterruptRegistry();
  private readonly repoRoot: string;
  private readonly startupRecovery: Promise<StartupRecoveryResult>;
  /** shutdown 期间为 true，阻止新 send 任务进入并快速释放 HTTP 连接。 */
  private shuttingDown = false;
  private readonly collaborationDeps: CollaborationDeps;

  constructor(
    private store: ConversationStore,
    private _agentResolver: SnailAgentResolver,
    private deps: WorkspaceManagerDeps,
    options: { repoRoot?: string } = {}
  ) {
    super();
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.collaborationDeps = { store, roleRegistry: deps.roleRegistry, systemAI: deps.systemAI, snailDen: deps.snailDen };
    this.startupRecovery = recoverOrphanedStreamingAssistantMessages({ store: this.store, summaryGenerator: null });
  }

  async waitForStartupRecovery(): Promise<StartupRecoveryResult> { return this.startupRecovery; }

  createWorkspace(name: string, input: { summary?: string; workspaceRoot?: string; sopId: string; roleBindings: Record<string, string | string[]>; loadFromSnail?: boolean }) {
    const workspaceId = randomUUID();
    const resolvedRoot = resolveWorkspaceRoot(workspaceId, input.workspaceRoot || undefined);

    // 如果指定了从 .snail 加载，先尝试加载配置
    if (input.loadFromSnail) {
      // 如果 .snail 目录不存在，初始化默认结构
      if (!hasSnailDirectory(resolvedRoot)) {
        initializeSnailDirectory(resolvedRoot, { name, summary: input.summary });
        logger.info("WorkspaceManager initialized .snail directory", { workspaceId, workspaceRoot: resolvedRoot });
      }
      this.loadWorkspaceFromSnail(workspaceId, resolvedRoot);
      // 从 .snail 加载后，获取 workspace 和创建默认 feature
      const workspace = this.store.getWorkspace(workspaceId);
      if (workspace) {
        const featureResult = this.createFeature(workspaceId, "初始研发迭代", "工作区创建时自动生成的默认 feature。");
        logger.info("WorkspaceManager created workspace from .snail", { workspaceId, featureId: featureResult.feature.id, stageId: featureResult.stage.id, conversationId: featureResult.conversation.id });
        return { workspace, ...featureResult };
      }
    }

    const result = createInitialWorkflow(
      { store: this.store, roleRegistry: this.deps.roleRegistry },
      { name, summary: input.summary, workspaceRoot: resolvedRoot, workspaceId, sopId: input.sopId, roleBindings: input.roleBindings },
    );
    logger.info("WorkspaceManager initialized workspace workflow", { workspaceId: result.workspace.id, featureId: result.feature.id, stageId: result.stage.id, conversationId: result.conversation.id });
    return result;
  }

  /**
   * 从 `.snail` 目录加载配置到数据库。
   *
   * 全量替换该 workspace 的 SOP 配置（workspace_sop、sop、role_definition、stage_definition），
   * 但不影响运行中的 feature 实例。
   *
   * @param workspaceId 目标 workspace ID
   * @param workspaceRoot `.snail` 目录所在的父目录路径
   * @returns 是否成功加载
   * @throws `.snail` 目录不存在或配置格式错误时抛出异常
   */
  loadWorkspaceFromSnail(workspaceId: string, workspaceRoot: string): boolean {
    if (!hasSnailDirectory(workspaceRoot)) {
      throw new Error(`.snail directory not found in ${workspaceRoot}`);
    }

    const config = loadSnailConfig(workspaceRoot);
    const seed = convertSnailConfigToSeed(workspaceId, config);

    this.store.replaceWorkspaceConfigs(workspaceId, {
      workspaceUpdate: { name: config.workspace.name, summary: config.workspace.summary },
      sopSeeds: seed.sopSeeds,
      workspaceBindings: seed.workspaceBindings,
    });

    this.deps.roleRegistry.reloadFromStore();

    logger.info("WorkspaceManager loaded workspace from .snail", {
      workspaceId,
      workspaceRoot,
      sopCount: config.sops.length,
    });

    return true;
  }

  /**
   * 检查目录是否包含 `.snail` 目录。
   */
  hasSnailConfig(workspaceRoot: string): boolean {
    return hasSnailDirectory(workspaceRoot);
  }

  listWorkspaces(limit = 50, offset = 0): WorkspaceSummary[] {
    return this.store.listWorkspaces(limit, offset).map((workspace) => ({
      ...workspace,
      conversation_count: this.store.listConversationsByWorkspace(workspace.id).length,
      stage_count: this.store.listStages(workspace.id).length,
      feature_count: this.store.listFeatures(workspace.id).length,
      boss_pending_count: sumBossPendingCount(this.store.listConversationsByWorkspace(workspace.id), (cid) => this.store.listBossPendingDispatches(cid).length),
    }));
  }

  getWorkspace(workspaceId: string): WorkspaceDetail | null {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) return null;
    const stages = this.store.listStages(workspaceId);
    const features = this.store.listFeatures(workspaceId).map((f) => buildFeatureDetail(this.store, f));
    return {
      ...workspace,
      conversation_count: this.store.listConversationsByWorkspace(workspaceId).length,
      stage_count: stages.length,
      feature_count: features.length,
      features,
      boss_pending_count: sumBossPendingCount(this.store.listConversationsByWorkspace(workspace.id), (cid) => this.store.listBossPendingDispatches(cid).length),
    };
  }

  createFeature(workspaceId: string, title: string, summary?: string, adoptedSopId?: string) {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    const result = createFeatureWorkflow({ store: this.store, roleRegistry: this.deps.roleRegistry }, { workspace, title, summary, adoptedSopId });
    logger.info("WorkspaceManager created feature workflow", { workspaceId, featureId: result.feature.id, stageId: result.stage.id, conversationId: result.conversation.id });
    return result;
  }

  getFeature(featureId: string): FeatureDetail | null { const f = this.store.getFeature(featureId); return f ? buildFeatureDetail(this.store, f) : null; }
  listFeatures(workspaceId: string): FeatureDetail[] { return this.store.listFeatures(workspaceId).map((f) => buildFeatureDetail(this.store, f)); }
  listStages(workspaceId: string): StageDetail[] { return this.store.listStages(workspaceId).map((s) => buildStageDetail(this.store, s)); }
  getStage(stageId: string): StageDetail | null { const s = this.store.getStage(stageId); return s ? buildStageDetail(this.store, s) : null; }

  advanceFeature(featureId: string, targetStageKey?: string) {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    assertFeatureWritable(this.store, feature);
    const workspace = this.store.getWorkspace(feature.workspace_id);
    if (!workspace) throw new Error(`Workspace not found: ${feature.workspace_id}`);
    const activeStage = this.store.getActiveStage(featureId);
    if (!activeStage) throw new Error(`No active stage found for feature: ${featureId}`);
    assertStageCanAdvance(this.store, activeStage.id);
    const result = transitionFeatureStage({ store: this.store, roleRegistry: this.deps.roleRegistry }, { workspace, feature, activeStage, targetStageKey });
    logger.info("WorkspaceManager transitioned feature", { workspaceId: workspace.id, featureId, completedStageId: result.completed_stage.id, nextStageId: result.next_stage?.id ?? null, nextConversationId: result.conversation?.id ?? null });
    return { ...result, completed_stage: buildStageDetail(this.store, result.completed_stage), next_stage: result.next_stage ? buildStageDetail(this.store, result.next_stage) : null };
  }

  /**
   * 从当前 stage 转移到指定目标 stage。转移路径由 SOP 转移图约束。
   */
  transitionFeatureStage(featureId: string, targetStageKey: string) {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    assertFeatureWritable(this.store, feature);
    const workspace = this.store.getWorkspace(feature.workspace_id);
    if (!workspace) throw new Error(`Workspace not found: ${feature.workspace_id}`);
    const activeStage = this.store.getActiveStage(featureId);
    if (!activeStage) throw new Error(`No active stage found for feature: ${featureId}`);
    const result = transitionFeatureStage({ store: this.store, roleRegistry: this.deps.roleRegistry }, { workspace, feature, activeStage, targetStageKey });
    logger.info("WorkspaceManager transitioned feature stage", { workspaceId: workspace.id, featureId, completedStageId: result.completed_stage.id, nextStageId: result.next_stage?.id, nextConversationId: result.conversation?.id });
    return { ...result, completed_stage: buildStageDetail(this.store, result.completed_stage), next_stage: result.next_stage ? buildStageDetail(this.store, result.next_stage) : null };
  }

  setFeatureTaskAnchor(featureId: string, taskAnchor: string): Feature {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    assertFeatureWritable(this.store, feature);
    return this.store.updateFeature(featureId, { task_anchor: taskAnchor });
  }

  setFeatureRoleSnail(featureId: string, stageId: string, roleName: string, snailTemplateId: string): Feature {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    assertFeatureWritable(this.store, feature);
    const stage = this.store.getStage(stageId);
    if (!stage || stage.feature_id !== featureId) throw new Error(`Stage not found or does not belong to feature: ${stageId}`);
    const template = this.deps.snailDen.getTemplate(snailTemplateId);
    if (!template) throw new Error(`Snail template not found: ${snailTemplateId}`);
    const roles = this.store.listRoleDefinitionsByStageAndWorkspace(stage.stage_definition_id, stage.workspace_id);
    if (!roles.some((r) => r.name === roleName)) throw new Error(`Invalid role '${roleName}' for stage '${stageId}'`);
    const updated = { ...feature.role_snail_mapping };
    if (!updated[stageId]) updated[stageId] = {};
    updated[stageId][roleName] = snailTemplateId;
    return this.store.updateFeature(featureId, { role_snail_mapping: updated });
  }

  completeFeature(featureId: string): { feature: Feature; cleanup: RepoCleanupResult } {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    assertFeatureWritable(this.store, feature);
    const activeStage = this.store.getActiveStage(featureId);
    const cleanup = cleanupFeatureRepoContext(activeStage?.output_artifacts ?? {}, { repoRoot: this.repoRoot });
    const completedFeature = this.store.updateFeature(featureId, { closed_at: new Date().toISOString() });
    logger.info("WorkspaceManager completed feature", { featureId, cleanup });
    return { feature: completedFeature, cleanup };
  }

  archiveFeature(featureId: string): { feature: Feature; cleanup: RepoCleanupResult } {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    const activeStage = this.store.getActiveStage(featureId);
    const cleanup = cleanupFeatureRepoContext(activeStage?.output_artifacts ?? {}, { repoRoot: this.repoRoot });
    const archivedFeature = this.store.updateFeature(featureId, { closed_at: feature.closed_at ?? new Date().toISOString() });
    logger.info("WorkspaceManager archived feature", { featureId, cleanup });
    return { feature: archivedFeature, cleanup };
  }

  updateStage(stageId: string, updates: Partial<Pick<Stage, "status" | "output_artifacts" | "entered_at" | "left_at">>): Stage {
    const stage = this.store.getStage(stageId);
    if (!stage) throw new Error(`Stage not found: ${stageId}`);
    assertFeatureWritable(this.store, this.store.getFeature(stage.feature_id)!);
    return this.store.updateStage(stageId, updates);
  }

  createConversation(input: { workspaceId: string; featureId: string; stageId: string; title: string; kind: ConversationKind; fromConversationIds?: string[]; summary?: string }): Conversation {
    const workspace = this.store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);
    const feature = this.store.getFeature(input.featureId);
    if (!feature) throw new Error(`Feature not found: ${input.featureId}`);
    assertFeatureWritable(this.store, feature);
    const conversation = createStageConversation({ store: this.store, roleRegistry: this.deps.roleRegistry }, input);
    logger.info("WorkspaceManager created conversation", { conversationId: conversation.id, workspaceId: input.workspaceId, featureId: input.featureId, stageId: input.stageId, roleName: conversation.default_role });
    return conversation;
  }

  listWorkspaceConversations(workspaceId: string): ConversationDetail[] { return this.store.listConversationsByWorkspace(workspaceId).map((c) => buildConversationDetail(this.store, c)); }
  listStageConversations(stageId: string): ConversationDetail[] { return this.store.listConversationsByStage(stageId).map((c) => buildConversationDetail(this.store, c)); }
  listFeatureConversations(featureId: string): ConversationDetail[] { return this.store.listConversationsByFeature(featureId).map((c) => buildConversationDetail(this.store, c)); }
  getConversation(conversationId: string): ConversationDetail | null { const c = this.store.getConversation(conversationId); return c ? buildConversationDetail(this.store, c) : null; }

  async sendMessage(conversationId: string, userContent: string): Promise<{ messageIds: number[] }> {
    return this.sendStructuredMessage(conversationId, [buildPlainTextEvent(userContent)]);
  }

  async sendStructuredMessage(
    conversationId: string,
    userParts: MessageInputEvent[],
    options: { fromRole?: RoleName; quotedMessageId?: number | null; askerRole?: RoleName | null; clientId?: string | null } = {},
  ): Promise<{ messageIds: number[] }> {
    if (this.shuttingDown) throw new Error("Server is shutting down");
    assertConversationFeatureWritable(this.store, conversationId);
    const { fromRole = "Boss Role", quotedMessageId = null, askerRole = null, clientId = null } = options;
    return this.conversationQueue.enqueue(conversationId, async () => {
      const result = await sendStructuredMessageWithCollaboration(
        this.buildCollaborationInvokeDeps(conversationId),
        conversationId,
        userParts,
        MAX_COLLABORATION_ROUNDS,
        { fromRole, quotedMessageId, askerRole, clientId },
      );
      this.emitConversationBadgeUpdate(conversationId);
      return result;
    });
  }

  async sendConversationMessage(conversationId: string, input: { content?: string; events?: MessageInputEvent[]; fromRole?: RoleName; quotedMessageId?: number | null; clientId?: string | null }): Promise<{ messageIds: number[] } | { error: { message: string } }> {
    try {
      const events = input.events ?? (input.content ? [buildPlainTextEvent(input.content)] : []);
      if (events.length === 0) return { error: { message: "No content provided" } };
      return await this.sendStructuredMessage(conversationId, events, { fromRole: input.fromRole, quotedMessageId: input.quotedMessageId, clientId: input.clientId });
    } catch (err: any) {
      return { error: { message: err.message } };
    }
  }

  interruptMessage(conversationId: string, messageId: number): { interrupted: boolean } {
    assertConversationFeatureWritable(this.store, conversationId);
    const message = this.store.getMessage(messageId, conversationId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    if (message.role !== "assistant") throw new Error(`Message is not interruptible: ${messageId}`);
    return { interrupted: this.messageInterrupts.interrupt(conversationId, messageId) };
  }

  interruptAllRunningMessages(): void { this.messageInterrupts.interruptAll(); }
  markShuttingDown(): void { this.shuttingDown = true; this.interruptAllRunningMessages(); }
  async waitForAllAgentProcessesStopped(): Promise<void> { await this.messageInterrupts.waitForAllStopped(); }

  getConversationMessages(conversationId: string, limit = 100, offset = 0): MessageWithEvents[] { return managerQueries.getConversationMessages(this.store, conversationId, limit, offset); }
  getRecentConversationMessages(conversationId: string, limit = DEFAULT_AGENT_HISTORY_USER_MESSAGE_LIMIT): ConversationRecentMessagesSnapshot { return managerQueries.getRecentConversationMessages(this.store, conversationId, limit); }
  getConversationEventsAfter(conversationId: string, afterEventId: number) { return managerQueries.getConversationEventsAfter(this.store, conversationId, afterEventId); }
  getLastConversationEventId(conversationId: string): number { return managerQueries.getLastConversationEventId(this.store, conversationId); }
  getConversationEventsBetween(conversationId: string, afterEventId: number, untilEventId: number) { return managerQueries.getConversationEventsBetween(this.store, conversationId, afterEventId, untilEventId); }
  getConversationMessagesByIds(conversationId: string, messageIds: number[]): MessageWithEvents[] { return managerQueries.getConversationMessagesByIds(this.store, conversationId, messageIds); }
  getConversationMessageWindow(conversationId: string, anchorMessageId: number, before = 2, after = 2): ConversationHistoryWindow { return managerQueries.getConversationMessageWindow({ store: this.store, conversationId, anchorMessageId, before, after }); }
  getConversationMessagesPage(conversationId: string, options: { limit?: number; offset?: number; before?: number } = {}): ConversationMessagesPage { return managerQueries.getConversationMessagesPage(this.store, conversationId, options); }
  getConversationDispatchState(conversationId: string): ConversationDispatchState { return getConversationDispatchState(this.store, conversationId); }
  getBossMentions(conversationId: string): BossMentionItem[] { return getBossMentions(this.store, conversationId); }

  acknowledgeBossMentions(conversationId: string): BossMentionItem[] {
    const mentions = getBossMentions(this.store, conversationId);
    this.store.markConversationDispatchesSeen(conversationId, mentions.map((item) => item.dispatch_id));
    this.emitConversationBadgeUpdate(conversationId);
    return mentions;
  }

  searchConversationHistory(conversationId: string, query: string, limit = 5, offset = 0): ConversationHistorySearchPage { return managerQueries.searchConversationHistory({ store: this.store, conversationId, query, limit, offset }); }

  listRoles() { return this.deps.roleRegistry.list(); }
  listSops(source?: "platform" | "workspace") { return this.store.listSops(source); }
  getSop(sopId: string) { return this.store.getSop(sopId); }
  listSopStageDefinitionsWithRoles(sopId: string) { return this.store.listSopStageDefinitionsWithRoles(sopId); }
  collectSopRoleKeys(sopId: string) { return this.store.collectSopRoleKeys(sopId); }
  listSopStageDefinitions(sopId: string) { return this.store.listSopStageDefinitions(sopId); }
  getSopTransitions(sopId: string) { return this.store.getSopTransitions(sopId); }
  getForwardTransitions(sopId: string, fromStageKey: string) { return this.store.getForwardTransitions(sopId, fromStageKey); }
  listWorkspaceSops(workspaceId: string) { return this.store.listWorkspaceSops(workspaceId); }
  createWorkspaceSop(input: { workspaceId: string; sopId: string; isDefault: boolean; roleBindings: Record<string, string | string[]> }) { const r = this.store.createWorkspaceSop({ id: randomUUID(), ...input }); this.deps.roleRegistry.reloadFromStore(); return r; }
  updateWorkspaceSop(workspaceId: string, sopId: string, updates: { isDefault?: boolean; roleBindings?: Record<string, string | string[]> }) { const r = this.store.updateWorkspaceSop(workspaceId, sopId, updates); this.deps.roleRegistry.reloadFromStore(); return r; }
  deleteWorkspaceSop(workspaceId: string, sopId: string) { const r = this.store.deleteWorkspaceSop(workspaceId, sopId); this.deps.roleRegistry.reloadFromStore(); return r; }

  createEvolutionItem(input: Omit<CreateEvolutionItemInput, "id">): EvolutionItemWithConversation { return evolutionCenter.createEvolutionItem(this.store, input); }
  getEvolutionItem(id: string): EvolutionItemWithConversation | null { return evolutionCenter.getEvolutionItem(this.store, id); }
  listEvolutionItems(filters: EvolutionItemListFilters = {}): EvolutionItemSearchResult[] { return evolutionCenter.listEvolutionItems(this.store, filters); }
  updateEvolutionItem(id: string, input: UpdateEvolutionItemInput): EvolutionItemWithConversation { return evolutionCenter.updateEvolutionItem(this.store, id, input); }

  /** Knowledge Library methods */
  getKnowledgeLibrarySummary(): { scope: string; count: number }[] { return this.store.summaryKnowledgeLibrary(); }
  getKnowledgeLibraryEntry(id: string) { return this.store.getKnowledgeLibraryEntry(id); }
  listKnowledgeLibrary(filters: any = {}) { return this.store.listKnowledgeLibrary(filters); }
  searchKnowledgeLibrary(filters: any) { return this.store.searchKnowledgeLibrary(filters); }

  /** 构建 sendStructuredMessageWithCollaboration 所需的依赖对象。 */
  private buildCollaborationInvokeDeps(conversationId: string) {
    const deps = this.collaborationDeps;
    return {
      store: this.store,
      emitAgentEvent: (targetConversationId: string, event: Record<string, unknown>) => this.emit("agent-event", targetConversationId, event),
      buildConversationSystemPrompt: (targetConversationId: string, options: CollaborationInvocationOptions) => resolveConversationSystemPrompt(deps, targetConversationId, options),
      resolveMentions: (targetConversationId: string, events: MessageInputEvent[], isAgentReply?: boolean) => resolveMentions(deps, targetConversationId, events, isAgentReply),
      refreshConversationSummary: async () => { /* disabled — relying on agent-side state tracking */ },
      messageContextSummaryGenerator: null,
      resolveRole: (roleName: RoleName) => resolveConversationRole(deps, conversationId, roleName),
      resolveRuntimeByRole: (role: any) => {
        const templateId = role.snail_template_id ?? this.deps.roleRegistry.getSnailTemplateId(role.workspace_id, role.id);
        if (!templateId) throw new Error(`No snail template for role: ${role.name}`);
        return this.deps.snailDen.getSnailRuntime(templateId).runtime;
      },
      resolveRoleTemplate: (role: any) => {
        const templateId = role.snail_template_id ?? this.deps.roleRegistry.getSnailTemplateId(role.workspace_id, role.id);
        if (!templateId) return undefined;
        const template = this.deps.snailDen.getTemplate(templateId);
        if (!template) return undefined;
        return {
          templateId,
          runtime: template.runtime,
          model: template.model,
          contextProvider: template.contextProvider,
          contextWindow: template.contextWindow,
          invocationTimeoutMs: template.invocationTimeoutMs,
        };
      },
      lookupOrCreateSnailAgentSession: (targetConversationId: string, roleName: string, role: any) => {
        const existing = this.store.getCurrentSnailAgentSession(targetConversationId, roleName);
        const templateId = role.snail_template_id ?? this.deps.roleRegistry.getSnailTemplateId(role.workspace_id, role.id);
        if (!templateId) throw new Error(`No snail template for role: ${roleName}`);
        const template = this.deps.snailDen.getTemplate(templateId);
        if (!template) throw new Error(`Snail template not found: ${templateId}`);
        if (existing && existing.runtime === template.runtime && existing.model === template.model) return existing;
        return this.store.createSnailAgentSession({ id: `${targetConversationId}:${roleName}:${Date.now()}`, conversationId: targetConversationId, roleName, runtime: template.runtime, model: template.model, contextProvider: template.contextProvider });
      },
      updateSnailAgentSessionExternalId: (sessionId: string, externalSessionId: string | null) => { this.store.updateSnailAgentSessionExternalId(sessionId, externalSessionId); },
      createInterruptController: () => this.messageInterrupts.createRunController(),
      bindInterruptMessage: (targetConversationId: string, messageId: number, controller: AbortController) => this.messageInterrupts.bindMessage(targetConversationId, messageId, controller),
      registerStopPromise: (targetConversationId: string, messageId: number, stopPromise: Promise<void>) => this.messageInterrupts.registerStopPromise(targetConversationId, messageId, stopPromise),
      finishInterruptMessage: (targetConversationId: string, messageId: number) => this.messageInterrupts.finishMessage(targetConversationId, messageId),
      onStageTransitionDetected: (targetConversationId: string, targetStageKey: string) => {
        this.executeAgentStageTransition(targetConversationId, targetStageKey);
      },
    };
  }

  /**
   * Agent 输出中检测到 stage_transition 时执行转移。
   * 失败仅 log.warn，不阻塞 agent 消息流程。
   */
  private executeAgentStageTransition(conversationId: string, targetStageKey: string): void {
    try {
      const conversation = this.store.getConversation(conversationId);
      if (!conversation || !conversation.feature_id || !conversation.stage_id) {
        logger.warn("stage_transition: conversation context incomplete", { conversationId });
        return;
      }
      const feature = this.store.getFeature(conversation.feature_id);
      if (!feature) { logger.warn("stage_transition: feature not found", { featureId: conversation.feature_id }); return; }
      const workspace = this.store.getWorkspace(feature.workspace_id);
      if (!workspace) { logger.warn("stage_transition: workspace not found", { workspaceId: feature.workspace_id }); return; }
      const activeStage = this.store.getStage(conversation.stage_id);
      if (!activeStage) { logger.warn("stage_transition: stage not found", { stageId: conversation.stage_id }); return; }
      transitionFeatureStage({ store: this.store, roleRegistry: this.deps.roleRegistry }, { workspace, feature, activeStage, targetStageKey });
      logger.info("Agent stage transition executed", { conversationId, from: activeStage.type, to: targetStageKey });
    } catch (error) {
      logger.warn("Agent stage transition failed", { conversationId, targetStageKey, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private emitConversationBadgeUpdate(conversationId: string): void { const conversation = this.getConversation(conversationId); if (conversation) this.emit("conversation-badge", buildConversationBadgePayload(conversation)); }
}
