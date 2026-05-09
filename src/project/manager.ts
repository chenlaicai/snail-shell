import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { SnailAgentResolver } from "../agent/resolver";
import type {
  Artifact,
  ArtifactType,
  Conversation,
  ConversationKind,
  ConversationStore,
  CreateArtifactInput,
  CreateKnowledgeInput,
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  Feature,
  KnowledgeApprovalInput,
  KnowledgeListFilters,
  KnowledgeSearchResult,
  KnowledgeUsagePolicyInput,
  KnowledgeWithDetails,
  MessageWithEvents,
  Project,
  ProjectKind,
  RecordKnowledgeUseInput,
  SnailName,
  Stage,
} from "../persistence/store";
import { STAGE_FORMAL_ARTIFACT_TYPES } from "../persistence/store";
import { buildConversationSystemPrompt } from "../snails";
import type { SnailRegistry } from "../snails";
import { loadArtifactDefinitions, loadStageDefinitions } from "../meta";
import { logger } from "../logger";
import type { ConversationSummaryGenerator, MentionExtractor, MessageContextSummaryGenerator } from "../llm";
import type { CollaborationInvocationOptions, MentionResolution } from "./collaboration";
import type { BossMentionItem, ConversationDetail, ConversationDispatchState, ConversationHistorySearchPage, ConversationHistoryWindow, ConversationMessagesPage, FeatureDetail, ConversationRecentMessagesSnapshot, ProjectDetail, ProjectSummary, StageDetail } from "./manager-types";
import { buildBossMentionItem, buildConversationBadgePayload, sumBossPendingCount } from "./manager-events";
import * as managerQueries from "./manager-queries";
import { refreshConversationSummary as refreshConversationSummaryForStore } from "./summary-input";
export type { BossMentionItem, ConversationDetail, ConversationDispatchState, ConversationHistorySearchPage, ConversationHistoryWindow, ConversationMessagesPage, ProjectDetail, ProjectSummary, StageDetail, FeatureDetail } from "./manager-types";
import { sendStructuredMessage as sendStructuredMessageWithCollaboration, structuredMentionsFromEvents } from "./collaboration";
import { ConversationQueue } from "./conversation-queue";
import { MessageInterruptRegistry } from "./message-interrupt";
import { advanceFeatureWorkflow, createFeatureWorkflow, createInitialWorkflow, createStageConversation, getStageInputArtifacts, restartFeatureDevelopmentWorkflow } from "./workflow";
import { buildMessagePreview, buildPlainTextEvent, getInputContent, type MessageInputEvent } from "./message-events";
import { dedupeMentions } from "./mentions";
import { cleanupFeatureRepoContext, type RepoCleanupResult } from "./repo-cleanup";
import { recoverOrphanedStreamingAssistantMessages, type StartupRecoveryResult } from "./startup-recovery";
import { syncKnowledgeDocuments } from "../knowledge/document-sync";
import { renderKnowledgeDocumentDraft, writeKnowledgeDocumentDraft } from "../knowledge/document-draft";
import { createKnowledgeDocumentPullRequest, refreshKnowledgeDocumentPrStates, type KnowledgeDocumentPrOptions } from "../knowledge/document-pr";

/**
 * 非 boss snail 之间的最大协作轮次，超过后强制由 default_snail 收口。
 * 设为 30 是为了支持复杂任务下更长的多 snail 循环讨论，同时保留收口上限，避免协作链无限延伸。
 */
const MAX_COLLABORATION_ROUNDS = 30;

// 构建 agent 上下文时默认包含的最近用户消息窗口数
// 设为 3 是为了提供足够的对话上下文，同时控制 prompt 长度
const DEFAULT_AGENT_HISTORY_USER_MESSAGE_LIMIT = 3;

export class ProjectManager extends EventEmitter {
  private readonly conversationQueue = new ConversationQueue();
  private readonly messageInterrupts = new MessageInterruptRegistry();
  private readonly repoRoot: string;
  private readonly knowledgeDocPrOptions: KnowledgeDocumentPrOptions;
  private readonly startupRecovery: Promise<StartupRecoveryResult>;

  constructor(
    private store: ConversationStore,
    private agentResolver: SnailAgentResolver,
    private snailRegistry: SnailRegistry,
    private summaryGenerator: ConversationSummaryGenerator & MessageContextSummaryGenerator,
    private mentionExtractor: MentionExtractor,
    options: { repoRoot?: string; knowledgeDocPr?: Partial<KnowledgeDocumentPrOptions> } = {}
  ) {
    super();
    /**
     * 仓库清理需要对真实 git 仓库执行 worktree/branch 操作，不能在测试或嵌入式调用时隐式依赖调用方的 cwd。
     * 默认仍沿用服务进程 cwd，显式注入则让完整生命周期测试可以绑定到临时仓库并验证生产清理路径。
     */
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.knowledgeDocPrOptions = { dryRun: options.knowledgeDocPr?.dryRun ?? false, worktreesRoot: options.knowledgeDocPr?.worktreesRoot ?? null, prStatusResolver: options.knowledgeDocPr?.prStatusResolver ?? null };
    /**
     * 知识文档是长期知识的权威源，运行时只有在当前进程基于仓库版本启动并完成同步后才算生效。
     * 因此同步必须发生在 ProjectManager 初始化阶段，而不是 PR 合入或数据库审批时直接激活。
     */
    refreshKnowledgeDocumentPrStates({ store: this.store, repoRoot: this.repoRoot, options: this.knowledgeDocPrOptions });
    const knowledgeSync = syncKnowledgeDocuments(this.store, this.repoRoot);
    logger.info("Knowledge documents synchronized", { ...knowledgeSync });
    this.startupRecovery = recoverOrphanedStreamingAssistantMessages({ store: this.store, summaryGenerator: this.summaryGenerator });
  }

  async waitForStartupRecovery(): Promise<StartupRecoveryResult> {
    return this.startupRecovery;
  }

  createProject(name: string, summary?: string, kind: ProjectKind = "product_delivery"): { project: Project; feature: Feature; stage: Stage; conversation: Conversation } {
    const result = createInitialWorkflow({ store: this.store, snailRegistry: this.snailRegistry }, name, summary, kind);
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

  createFeature(projectId: string, title: string, summary?: string): { feature: Feature; stage: Stage; conversation: Conversation } {
    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const result = createFeatureWorkflow({ store: this.store, snailRegistry: this.snailRegistry }, { project, title, summary });
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
    const result = advanceFeatureWorkflow({ store: this.store, snailRegistry: this.snailRegistry }, project, feature, activeStage);
    logger.info("ProjectManager advanced feature", {
      projectId: project.id,
      featureId,
      completedStageId: result.completed_stage.id,
      nextStageId: result.next_stage?.id ?? null,
      nextConversationId: result.conversation?.id ?? null,
    });
    return result;
  }

  restartFeatureDevelopment(featureId: string, stageId: string) {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
    const project = this.store.getProject(feature.project_id);
    if (!project) throw new Error(`Project not found: ${feature.project_id}`);
    const restartStage = this.getRestartSourceStage(featureId, stageId);

    const result = restartFeatureDevelopmentWorkflow({ store: this.store, snailRegistry: this.snailRegistry }, project, feature, restartStage);
    logger.info("ProjectManager restarted feature development", { projectId: project.id, featureId, completedStageId: result.completed_stage.id, nextStageId: result.next_stage?.id, nextConversationId: result.conversation?.id });
    return result;
  }

  private getRestartSourceStage(featureId: string, stageId: string): Stage {
    const stages = this.store.listStagesByFeature(featureId);
    const latestStage = stages[stages.length - 1];
    if (!latestStage || latestStage.id !== stageId) throw new Error("Development cycle restart stage does not match latest feature stage");
    if (latestStage.type !== "review" && latestStage.type !== "development") throw new Error("Only development or review stages can restart development");
    return latestStage;
  }

  updateFeatureRepoContext(featureId: string, input: { branchName?: string; worktreePath?: string; prUrl?: string }): Feature {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
    return this.store.updateFeature(featureId, {
      branch_name: input.branchName ?? feature.branch_name,
      worktree_path: input.worktreePath ?? feature.worktree_path,
      pr_url: input.prUrl ?? feature.pr_url,
    });
  }

  completeFeature(featureId: string): { feature: Feature; cleanup: RepoCleanupResult } {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
    const cleanup = cleanupFeatureRepoContext(feature, { repoRoot: this.repoRoot });
    const completedFeature = this.store.updateFeature(featureId, { status: "completed", closed_at: new Date().toISOString() });
    logger.info("ProjectManager completed feature", { featureId, cleanup });
    return { feature: completedFeature, cleanup };
  }

  archiveFeature(featureId: string): { feature: Feature; cleanup: RepoCleanupResult } {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    const cleanup = cleanupFeatureRepoContext(feature, { repoRoot: this.repoRoot });
    const archivedFeature = this.store.updateFeature(featureId, { status: "archived", closed_at: feature.closed_at ?? new Date().toISOString() });
    logger.info("ProjectManager archived feature", { featureId, cleanup });
    return { feature: archivedFeature, cleanup };
  }

  updateStage(stageId: string, updates: Partial<Pick<Stage, "status" | "formal_artifacts" | "entered_at" | "left_at">>): Stage {
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
      { store: this.store, snailRegistry: this.snailRegistry },
      input
    );
    logger.info("ProjectManager created conversation", { conversationId: conversation.id, projectId: input.projectId, featureId: input.featureId, stageId: input.stageId, snailName: conversation.default_snail });
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
    fromSnail: SnailName = "Boss Snail",
    quotedMessageId: number | null = null,
    askerSnail: SnailName | null = null,
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
          messageContextSummaryGenerator: this.summaryGenerator,
          resolveSnail: (snailName: SnailName) => this.snailRegistry.get(snailName),
          resolveRuntimeBySnail: (snail) => this.agentResolver.resolve(snail),
          updateConversationRuntimeSessionId: (targetConversationId: string, snailName: SnailName, sessionId: string | null) => {
            const conversation = this.store.getConversation(targetConversationId);
            if (!conversation) {
              throw new Error(`Conversation not found: ${targetConversationId}`);
            }
            const runtimeSessions = { ...conversation.runtime_sessions };
            if (sessionId) {
              runtimeSessions[snailName] = { sessionId };
            } else {
              delete runtimeSessions[snailName];
            }
            this.store.updateConversation(targetConversationId, { runtime_sessions: runtimeSessions });
          },
          createInterruptController: () => this.messageInterrupts.createRunController(),
          bindInterruptMessage: (messageId: number, controller: AbortController) => this.messageInterrupts.bindMessage(messageId, controller),
          finishInterruptMessage: (messageId: number) => this.messageInterrupts.finishMessage(messageId),
        },
        conversationId,
        userParts,
        MAX_COLLABORATION_ROUNDS,
        { fromSnail, quotedMessageId, askerSnail, clientId }
      );
      this.emitConversationBadgeUpdate(conversationId);
      return result;
    });
  }

  interruptMessage(conversationId: string, messageId: number): { interrupted: boolean } {
    this.assertConversationFeatureWritable(conversationId);
    const message = this.store.getMessage(messageId, conversationId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    if (message.role !== "assistant") throw new Error(`Message is not interruptible: ${messageId}`);
    return { interrupted: this.messageInterrupts.interrupt(messageId) };
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

  getConversationMessagesPage(conversationId: string, limit = 20, offset = 0): ConversationMessagesPage {
    return managerQueries.getConversationMessagesPage(this.store, conversationId, limit, offset);
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
    this.store.markDispatchesSeen(mentions.map((item) => item.dispatch_id));
    this.emitConversationBadgeUpdate(conversationId);
    return mentions;
  }

  searchConversationHistory(conversationId: string, query: string, limit = 5, offset = 0): ConversationHistorySearchPage {
    return managerQueries.searchConversationHistory({ store: this.store, conversationId, query, limit, offset });
  }

  createArtifact(
    conversationId: string,
    artifactType: ArtifactType,
    title: string,
    artifactInput: Partial<Pick<CreateArtifactInput, "storageType" | "options" | "status">> = {}
  ): Artifact {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    this.assertConversationFeatureWritable(conversationId);
    const artifactDefinitions = loadArtifactDefinitions();
    const resolvedStorageType = artifactInput.storageType ?? artifactDefinitions[artifactType]?.storage_type ?? "inline_text";
    const artifact = this.store.createArtifact({
      id: randomUUID(),
      projectId: conversation.project_id,
      featureId: conversation.feature_id,
      stageId: conversation.stage_id,
      conversationId,
      artifactType,
      title,
      status: artifactInput.status ?? "active",
      storageType: resolvedStorageType,
      options: artifactInput.options,
    });
    logger.debug("ProjectManager created artifact", { artifactId: artifact.id, conversationId, artifactType, storageType: resolvedStorageType });
    return artifact;
  }

  updateArtifact(artifactId: string, updates: Partial<Omit<Artifact, "id" | "project_id" | "stage_id" | "conversation_id" | "created_at">>): Artifact {
    const artifact = this.store.getArtifact(artifactId);
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
    this.assertFeatureIdWritable(artifact.feature_id);
    return this.store.updateArtifact(artifactId, updates);
  }

  listStageArtifacts(stageId: string): Artifact[] { return this.store.listArtifactsByStage(stageId); }

  listFeatureArtifacts(featureId: string): Artifact[] { return this.store.listArtifactsByFeature(featureId); }

  listConversationArtifacts(conversationId: string): Artifact[] { return managerQueries.listConversationArtifacts(this.store, conversationId); }

  setStageFormalArtifacts(stageId: string, artifactIds: string[]): Stage {
    this.assertStageFeatureWritable(stageId);
    return this.store.updateStage(stageId, { formal_artifacts: artifactIds });
  }

  /**
   * Archived Feature is a historical container: reads stay available for traceability,
   * but any workflow mutation would make the archive state ambiguous and revive closed work.
   */
  private assertFeatureWritable(feature: Feature): void {
    if (feature.status === "archived") {
      throw new Error("Archived feature is read-only");
    }
  }

  private assertFeatureIdWritable(featureId: string): void {
    const feature = this.store.getFeature(featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    this.assertFeatureWritable(feature);
  }

  private assertStageFeatureWritable(stageId: string): void {
    const stage = this.store.getStage(stageId);
    if (!stage) throw new Error(`Stage not found: ${stageId}`);
    this.assertFeatureIdWritable(stage.feature_id);
  }

  private assertConversationFeatureWritable(conversationId: string): void {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    this.assertFeatureIdWritable(conversation.feature_id);
  }

  private assertStageCanAdvance(stageId: string): void {
    const stage = this.store.getStage(stageId);
    if (!stage) {
      throw new Error(`Stage not found: ${stageId}`);
    }
    if (!stage.formal_artifacts.length) {
      throw new Error("Stage cannot advance without formal artifacts");
    }
    const artifacts = this.store.listArtifactsByStage(stageId);
    const formalArtifacts = artifacts.filter((artifact) => stage.formal_artifacts.includes(artifact.id));
    const formalTypes = new Set(formalArtifacts.map((artifact) => artifact.artifact_type));
    const requiredTypes = STAGE_FORMAL_ARTIFACT_TYPES[stage.type] ?? [];
    const hasAllRequiredTypes = requiredTypes.every((type) => formalTypes.has(type));
    if (!hasAllRequiredTypes) {
      logger.warn("Stage advance validation failed", { stageId, requiredTypes, formalTypes: Array.from(formalTypes) });
      throw new Error(`Stage formal artifacts do not satisfy required types: ${requiredTypes.join(", ")}`);
    }
    logger.debug("Stage advance validation passed", { stageId, requiredTypes });
  }

  listSnails() { return this.snailRegistry.list(); }

  createKnowledge(input: Omit<CreateKnowledgeInput, "id">): KnowledgeWithDetails {
    return this.store.createKnowledge({ ...input, id: randomUUID() });
  }

  listKnowledge(filters: KnowledgeListFilters = {}): KnowledgeSearchResult[] {
    return this.store.listKnowledge(filters);
  }

  getKnowledge(id: string): KnowledgeWithDetails | null {
    return this.store.getKnowledge(id);
  }

  approveKnowledge(id: string, input: KnowledgeApprovalInput): KnowledgeWithDetails {
    const candidate = this.store.getKnowledge(id);
    if (!candidate) throw new Error(`Knowledge not found: ${id}`);
    const targetKnowledgeId = randomUUID();
    const requestId = randomUUID();
    const documentPath = `docs/knowledge/pending/${targetKnowledgeId}.md`;
    const document = renderKnowledgeDocumentDraft({ candidate, approval: input, requestId, targetKnowledgeId });
    writeKnowledgeDocumentDraft(this.repoRoot, documentPath, document.content);
    const request = this.store.createKnowledgeChangeRequest({
      id: requestId,
      type: "create",
      candidateId: id,
      targetKnowledgeId,
      documentPath,
      expectedDocumentHash: document.documentHash,
      createdBy: candidate.created_by ?? input.reviewer,
      approvedBy: input.reviewer,
      metadata: JSON.stringify({ comment: input.comment ?? null, updates: input.updates ?? null }),
    });
    createKnowledgeDocumentPullRequest({ store: this.store, repoRoot: this.repoRoot, requestId: request.id, options: this.knowledgeDocPrOptions });
    const updatedMetadata = mergeKnowledgeMetadata(candidate.metadata, { approved_for_pr_request_id: request.id, target_knowledge_id: targetKnowledgeId });
    return this.store.approveKnowledge(id, { ...input, updates: { ...(input.updates ?? {}), metadata: updatedMetadata } });
  }

  rejectKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
    return this.store.rejectKnowledge(id, reviewer, comment);
  }

  deprecateKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
    return this.store.deprecateKnowledge(id, reviewer, comment);
  }

  archiveKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
    return this.store.archiveKnowledge(id, reviewer, comment);
  }

  upsertKnowledgeUsagePolicy(id: string, input: KnowledgeUsagePolicyInput) {
    return this.store.upsertKnowledgeUsagePolicy(id, input);
  }

  listKnowledgeUses(id: string) {
    return this.store.listKnowledgeUses(id);
  }

  recordKnowledgeUse(input: Omit<RecordKnowledgeUseInput, "id">) {
    return this.store.recordKnowledgeUse({ ...input, id: randomUUID() });
  }

  private buildConversationSystemPrompt(conversationId: string, options: CollaborationInvocationOptions): string {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const project = this.store.getProject(conversation.project_id);
    const feature = this.store.getFeature(conversation.feature_id);
    const stage = this.store.getStage(conversation.stage_id);
    if (!project || !feature || !stage) {
      throw new Error("Conversation context is incomplete");
    }

    const stageDefinitions = loadStageDefinitions();
    const stageDefinition = stageDefinitions[stage.type];
    const activeSnail = this.snailRegistry.get(options.activeSnailName);
    const defaultSnail = this.snailRegistry.get(conversation.default_snail);
    return buildConversationSystemPrompt({
      project,
      feature,
      stage,
      conversation,
      stageDefinition,
      inputArtifacts: getStageInputArtifacts(this.store, stage),
      knowledgeContext: this.store.listPromptInjectableKnowledge({
        projectId: project.id,
        featureId: feature.id,
        stageType: stage.type,
        snailName: options.activeSnailName,
        conversationId: conversation.id,
        stageId: stage.id,
      }),
      activeSnail,
      defaultSnail,
      remainingCollaborationRounds: options.remainingRounds,
      mentionAllowed: options.mentionAllowed,
      forcedWrapUp: options.forcedWrapUp,
      participatingSnails: conversation.participating_snails
        .map((snailName) => this.snailRegistry.get(snailName))
        .filter(Boolean) as any,
    });
  }

  private async refreshConversationSummary(conversationId: string): Promise<void> {
    await refreshConversationSummaryForStore({ store: this.store, summaryGenerator: this.summaryGenerator, conversationId });
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

    const fallback = await this.mentionExtractor.extractMentions({
      messageText,
      participatingSnails: conversation.participating_snails
        .map((snailName) => this.snailRegistry.get(snailName))
        .filter((snail): snail is NonNullable<typeof snail> => Boolean(snail))
        .map((snail) => ({ name: snail.name })),
    });

    logger.debug(`[resolveMentions] LLM fallback extracted ${fallback.mentions.length} mentions`);

    return {
      messageText,
      mentions: dedupeMentions(
        fallback.mentions
          .filter((item) => conversation.participating_snails.includes(item.snail))
          .map((item) => ({ snail: item.snail, raw: item.raw, source: "llm_fallback" as const }))
      ),
    };
  }

  private attachDispatchGroupPreviews(
    conversationId: string,
    group: DispatchInboxGroup
  ): DispatchInboxGroup & { messages: DispatchInboxPreviewItem[] } {
    const messages = this.store.getMessagesByIds(conversationId, group.message_ids)
      .map((message) => ({
        message_id: message.id,
        from_snail: message.from_snail,
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
      artifact_count: this.store.listArtifactsByConversation(conversation.id).length,
      boss_pending_count: this.store.listBossPendingDispatches(conversation.id).length,
    };
  }

  private buildStageDetail(stage: Stage): StageDetail {
    return {
      ...stage,
      boss_pending_count: sumBossPendingCount(this.store.listConversationsByStage(stage.id), (conversationId) => this.store.listBossPendingDispatches(conversationId).length),
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
      artifact_count: this.store.listArtifactsByFeature(feature.id).length,
      boss_pending_count: sumBossPendingCount(conversations, (conversationId) => this.store.listBossPendingDispatches(conversationId).length),
    };
  }

  private emitConversationBadgeUpdate(conversationId: string): void { const conversation = this.getConversation(conversationId); if (conversation) this.emit("conversation-badge", buildConversationBadgePayload(conversation)); }
}

function mergeKnowledgeMetadata(raw: string | null, patch: Record<string, unknown>): string {
  let parsed: Record<string, unknown> = {};
  if (raw) {
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      parsed = { previous_metadata: raw };
    }
  }
  return JSON.stringify({ ...parsed, ...patch });
}
