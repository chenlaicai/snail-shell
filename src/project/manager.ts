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
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  MessageWithEvents,
  Project,
  ProjectKind,
  SnailName,
  Stage,
  StageType,
} from "../persistence/store";
import { STAGE_FORMAL_ARTIFACT_TYPES } from "../persistence/store";
import { buildConversationSystemPrompt } from "../snails";
import type { SnailRegistry } from "../snails";
import { loadArtifactDefinitions, loadStageDefinitions } from "../meta";
import { logger } from "../logger";
import type { ConversationSummaryGenerator, MentionExtractor } from "../llm";
import type { CollaborationInvocationOptions, MentionResolution } from "./collaboration";
import type {
  BossMentionItem,
  ConversationDetail,
  ConversationDispatchState,
  ConversationHistorySearchPage,
  ConversationHistoryWindow,
  ConversationMessagesPage,
  ProjectDetail,
  ProjectSummary,
  StageDetail,
  SummaryGenerationInput,
} from "./manager-types";
import { buildBossMentionItem, buildConversationBadgePayload, sumBossPendingCount } from "./manager-events";
export type {
  BossMentionItem,
  ConversationDetail,
  ConversationDispatchState,
  ConversationHistorySearchPage,
  ConversationHistoryWindow,
  ConversationMessagesPage,
  ProjectDetail,
  ProjectSummary,
  StageDetail,
} from "./manager-types";
import { sendStructuredMessage as sendStructuredMessageWithCollaboration, structuredMentionsFromEvents } from "./collaboration";
import { advanceStageWorkflow, createInitialWorkflow, createStageConversation, getStageInputArtifacts } from "./workflow";
import { buildMessagePreview, buildPlainTextEvent, getInputContent, type MessageInputEvent } from "./message-events";
import { dedupeMentions } from "./mentions";

// 非 boss snail 之间的最大协作轮次，超过后强制由 default_snail 收口
// 设为 3 是为了平衡协作深度和响应时间：允许 A→B→A 这样的往返讨论，但避免过长的协作链
const MAX_COLLABORATION_ROUNDS = 3;

// 构建 agent 上下文时默认包含的最近用户消息窗口数
// 设为 3 是为了提供足够的对话上下文，同时控制 prompt 长度
const DEFAULT_AGENT_HISTORY_USER_MESSAGE_LIMIT = 3;

export class ProjectManager extends EventEmitter {
  constructor(
    private store: ConversationStore,
    private agentResolver: SnailAgentResolver,
    private snailRegistry: SnailRegistry,
    private summaryGenerator: ConversationSummaryGenerator,
    private mentionExtractor: MentionExtractor
  ) {
    super();
  }

  createProject(name: string, summary?: string, kind: ProjectKind = "product_delivery"): { project: Project; stage: Stage; conversation: Conversation } {
    const result = createInitialWorkflow({ store: this.store, snailRegistry: this.snailRegistry }, name, summary, kind);
    logger.info("ProjectManager initialized project workflow", { projectId: result.project.id, stageId: result.stage.id, conversationId: result.conversation.id });
    return result;
  }

  listProjects(limit = 50, offset = 0): ProjectSummary[] {
    return this.store.listProjects(limit, offset).map((project) => ({
      ...project,
      conversation_count: this.store.listConversationsByProject(project.id).length,
      stage_count: this.store.listStages(project.id).length,
      boss_pending_count: sumBossPendingCount(this.store.listConversationsByProject(project.id), (conversationId) => this.store.listBossPendingDispatches(conversationId).length),
    }));
  }

  getProject(projectId: string): ProjectDetail | null {
    const project = this.store.getProject(projectId);
    if (!project) return null;
    const stages = this.store.listStages(projectId);
    return {
      ...project,
      stages: stages.map((stage) => this.buildStageDetail(stage)) as Stage[],
      conversation_count: this.store.listConversationsByProject(projectId).length,
      stage_count: stages.length,
      boss_pending_count: sumBossPendingCount(this.store.listConversationsByProject(project.id), (conversationId) => this.store.listBossPendingDispatches(conversationId).length),
    };
  }

  listStages(projectId: string): StageDetail[] {
    return this.store.listStages(projectId).map((stage) => this.buildStageDetail(stage));
  }

  getActiveStage(projectId: string): Stage | null {
    return this.store.getActiveStage(projectId) ?? null;
  }

  completeStageAndAdvance(projectId: string): { completed_stage: Stage; next_stage: Stage; conversation: Conversation } {
    const project = this.store.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const activeStage = this.store.getActiveStage(projectId);
    if (!activeStage) {
      throw new Error(`No active stage found for project: ${projectId}`);
    }

    const nextStageType = this.getNextStageType(activeStage.type);
    if (!nextStageType) {
      throw new Error(`No next stage available after ${activeStage.type}`);
    }

    this.assertStageCanAdvance(activeStage.id);
    const result = advanceStageWorkflow({ store: this.store, snailRegistry: this.snailRegistry }, project, activeStage, nextStageType);
    logger.info("ProjectManager advanced stage", {
      projectId,
      completedStageId: result.completed_stage.id,
      nextStageId: result.next_stage.id,
      nextConversationId: result.conversation.id,
    });
    return result;
  }

  updateStage(stageId: string, updates: Partial<Pick<Stage, "status" | "formal_artifacts" | "entered_at" | "left_at">>): Stage {
    return this.store.updateStage(stageId, updates);
  }

  createConversation(
    projectId: string,
    stageId: string,
    title: string,
    kind: ConversationKind,
    fromConversationIds?: string[],
    summary?: string
  ): Conversation {
    const project = this.store.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const conversation = createStageConversation(
      { store: this.store, snailRegistry: this.snailRegistry },
      { projectId, stageId, title, kind, fromConversationIds, summary }
    );
    logger.info("ProjectManager created conversation", { conversationId: conversation.id, projectId, stageId, snailName: conversation.default_snail });
    return conversation;
  }

  listProjectConversations(projectId: string): ConversationDetail[] {
    return this.store.listConversationsByProject(projectId).map((conversation) => this.buildConversationDetail(conversation));
  }

  listStageConversations(stageId: string): ConversationDetail[] {
    return this.store.listConversationsByStage(stageId).map((conversation) => this.buildConversationDetail(conversation));
  }

  getConversation(conversationId: string): ConversationDetail | null {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) return null;
    return this.buildConversationDetail(conversation);
  }

  async sendMessage(conversationId: string, userContent: string): Promise<{ reply: string }> {
    return this.sendStructuredMessage(conversationId, [buildPlainTextEvent(userContent)]);
  }

  async sendStructuredMessage(
    conversationId: string,
    userParts: MessageInputEvent[],
    fromSnail: SnailName = "Boss Snail",
    quotedMessageId: number | null = null,
    askerSnail: SnailName | null = null,
    clientId: string | null = null
  ): Promise<{ reply: string }> {
    const result = await sendStructuredMessageWithCollaboration(
      {
        store: this.store,
        emitAgentEvent: (targetConversationId: string, event: Record<string, unknown>) => this.emit("agent-event", targetConversationId, event),
        buildConversationSystemPrompt: (targetConversationId: string, options: CollaborationInvocationOptions) => this.buildConversationSystemPrompt(targetConversationId, options),
        resolveMentions: (targetConversationId, parts, isAgentReply) => this.resolveMentions(targetConversationId, parts, isAgentReply),
        refreshConversationSummary: (targetConversationId: string) => this.refreshConversationSummary(targetConversationId),
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
      },
      conversationId,
      userParts,
      MAX_COLLABORATION_ROUNDS,
      { fromSnail, quotedMessageId, askerSnail, clientId }
    );
    this.emitConversationBadgeUpdate(conversationId);
    return result;
  }

  getConversationMessages(conversationId: string, limit = 100, offset = 0): MessageWithEvents[] {
    return this.store.getMessages(conversationId, limit, offset);
  }

  getRecentConversationMessages(conversationId: string, limit = DEFAULT_AGENT_HISTORY_USER_MESSAGE_LIMIT): MessageWithEvents[] {
    return this.store.getRecentConversationMessagesWindow(conversationId, limit);
  }

  getConversationMessagesByIds(conversationId: string, messageIds: number[]): MessageWithEvents[] {
    return this.store.getMessagesByIds(conversationId, messageIds);
  }

  getConversationMessageWindow(conversationId: string, anchorMessageId: number, before = 2, after = 2): ConversationHistoryWindow {
    return {
      items: this.store.getMessageWindow(conversationId, anchorMessageId, before, after),
    };
  }

  getConversationMessagesPage(conversationId: string, limit = 20, offset = 0): ConversationMessagesPage {
    const normalizedLimit = Math.max(1, Math.min(limit, 50));
    const normalizedOffset = Math.max(0, offset);
    const items = this.store.getMessages(conversationId, normalizedLimit, normalizedOffset);
    return {
      items,
      next_offset: normalizedOffset + items.length,
      has_more: items.length === normalizedLimit,
    };
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
    const normalizedLimit = Math.max(1, Math.min(limit, 20));
    const normalizedOffset = Math.max(0, offset);
    const items = this.store.searchConversationMessages(conversationId, query, normalizedLimit, normalizedOffset);
    return {
      items,
      next_offset: normalizedOffset + items.length,
      has_more: items.length === normalizedLimit,
    };
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
    const artifactDefinitions = loadArtifactDefinitions();
    const resolvedStorageType = artifactInput.storageType ?? artifactDefinitions[artifactType]?.storage_type ?? "inline_text";
    const artifact = this.store.createArtifact({
      id: randomUUID(),
      projectId: conversation.project_id,
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
    return this.store.updateArtifact(artifactId, updates);
  }

  listStageArtifacts(stageId: string): Artifact[] {
    return this.store.listArtifactsByStage(stageId);
  }

  listConversationArtifacts(conversationId: string): Artifact[] {
    return this.store.listArtifactsByConversation(conversationId);
  }

  setStageFormalArtifacts(stageId: string, artifactIds: string[]): Stage {
    return this.store.updateStage(stageId, { formal_artifacts: artifactIds });
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

  private getNextStageType(currentType: StageType): StageType | null {
    const stageDefinitions = loadStageDefinitions();
    const orderedStageTypes = Object.entries(stageDefinitions)
      .sort(([, left], [, right]) => left.order - right.order)
      .map(([type]) => type as StageType);
    const currentIndex = orderedStageTypes.indexOf(currentType);
    if (currentIndex === -1 || orderedStageTypes.length === 0) {
      return null;
    }
    return orderedStageTypes[(currentIndex + 1) % orderedStageTypes.length];
  }

  listSnails() { return this.snailRegistry.list(); }

  private buildConversationSystemPrompt(conversationId: string, options: CollaborationInvocationOptions): string {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const project = this.store.getProject(conversation.project_id);
    const stage = this.store.getStage(conversation.stage_id);
    if (!project || !stage) {
      throw new Error("Conversation context is incomplete");
    }

    const stageDefinitions = loadStageDefinitions();
    const stageDefinition = stageDefinitions[stage.type];
    const activeSnail = this.snailRegistry.get(options.activeSnailName);
    const defaultSnail = this.snailRegistry.get(conversation.default_snail);
    return buildConversationSystemPrompt({
      project,
      stage,
      conversation,
      stageDefinition,
      inputArtifacts: getStageInputArtifacts(this.store, stage),
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
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) return;

    const recentMessages = this.store.getRecentMessages(conversationId, 8)
      .filter((message) => message.role === "user" || message.role === "assistant");
    const summaryInput = this.buildSummaryGenerationInput(conversation, recentMessages);

    // Keep summary refresh synchronous with message completion for now. Making this
    // fire-and-forget would reduce latency, but it would also allow subsequent turns
    // to observe a stale summary after the latest message has already been accepted.
    let nextSummary: string;
    try {
      nextSummary = await this.generateConversationSummary(summaryInput);
    } catch (error) {
      logger.warn("Conversation summary refresh fell back after generation failure", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
        fallback: "keeping_existing_summary",
        failed_step: "generation",
      });
      return;
    }

    try {
      this.store.updateConversation(conversationId, { summary: nextSummary });
    } catch (error) {
      logger.error("Conversation summary persistence failed", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
        fallback: "keeping_existing_summary",
        failed_step: "persistence",
      });
    }
  }

  private buildSummaryGenerationInput(conversation: Conversation, recentMessages: MessageWithEvents[]): SummaryGenerationInput {
    const previousSummary = conversation.summary?.trim() ?? "";
    return {
      conversation,
      previousSummary,
      recentMessages,
    };
  }

  private async generateConversationSummary(input: SummaryGenerationInput): Promise<string> {
    try {
      return await this.summaryGenerator.generateConversationSummary({
        conversation: {
          title: input.conversation.title,
          kind: input.conversation.kind,
        },
        previousSummary: input.previousSummary,
        recentMessages: input.recentMessages,
      });
    } catch (error) {
      logger.error("Conversation summary generation failed", {
        conversationId: input.conversation.id,
        title: input.conversation.title,
        kind: input.conversation.kind,
        recentMessageCount: input.recentMessages.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async resolveMentions(
    conversationId: string,
    parts: MessageInputEvent[],
    isAgentReply: boolean = false
  ): Promise<MentionResolution> {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Extract mentions from parts
    const structuredMentions = structuredMentionsFromEvents(conversation, parts);
    const messageText = getInputContent(parts);
    logger.debug(`[resolveMentions] structured=${structuredMentions.length}, hasAt=${messageText.includes("@")}, isAgent=${isAgentReply}`);

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

  private emitConversationBadgeUpdate(conversationId: string): void {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;
    this.emit("conversation-badge", buildConversationBadgePayload(conversation));
  }
}
