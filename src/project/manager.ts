import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { SnailAgentResolver } from "../agent/resolver";
import type {
  Artifact,
  ArtifactType,
  Conversation,
  ConversationHistorySearchResult,
  ConversationKind,
  ConversationStore,
  CreateArtifactInput,
  MessagePartType,
  MessageWithParts,
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
import type { ConversationSummaryGenerator } from "../llm";
import type { CollaborationInvocationOptions, ResolvedSnailTarget } from "./collaboration";
import { sendStructuredMessage as sendStructuredMessageWithCollaboration } from "./collaboration";
import { advanceStageWorkflow, createInitialWorkflow, createStageConversation } from "./workflow";

const MAX_COLLABORATION_TURNS = 3;
const DEFAULT_AGENT_HISTORY_USER_TURN_LIMIT = 3;

export interface ProjectSummary extends Project {
  conversation_count: number;
  stage_count: number;
}

export interface ProjectDetail extends ProjectSummary {
  stages: Stage[];
}

export interface ConversationDetail extends Conversation {
  message_count: number;
  artifact_count: number;
}

export interface ConversationMessagesPage {
  items: MessageWithParts[];
  next_offset: number;
  has_more: boolean;
}

export interface ConversationHistoryWindow {
  items: MessageWithParts[];
}

export interface ConversationHistorySearchPage {
  items: ConversationHistorySearchResult[];
  next_offset: number;
  has_more: boolean;
}

interface SummaryGenerationInput {
  conversation: Conversation;
  previousSummary: string;
  recentMessages: MessageWithParts[];
}

export class ProjectManager extends EventEmitter {
  constructor(
    private store: ConversationStore,
    private agentResolver: SnailAgentResolver,
    private snailRegistry: SnailRegistry,
    private summaryGenerator: ConversationSummaryGenerator
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
    }));
  }

  getProject(projectId: string): ProjectDetail | null {
    const project = this.store.getProject(projectId);
    if (!project) return null;
    const stages = this.store.listStages(projectId);
    return {
      ...project,
      stages,
      conversation_count: this.store.listConversationsByProject(projectId).length,
      stage_count: stages.length,
    };
  }

  listStages(projectId: string): Stage[] {
    return this.store.listStages(projectId);
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
    return this.store.listConversationsByProject(projectId).map((conversation) => ({
      ...conversation,
      message_count: this.store.getMessages(conversation.id).length,
      artifact_count: this.store.listArtifactsByConversation(conversation.id).length,
    }));
  }

  listStageConversations(stageId: string): ConversationDetail[] {
    return this.store.listConversationsByStage(stageId).map((conversation) => ({
      ...conversation,
      message_count: this.store.getMessages(conversation.id).length,
      artifact_count: this.store.listArtifactsByConversation(conversation.id).length,
    }));
  }

  getConversation(conversationId: string): ConversationDetail | null {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) return null;
    return {
      ...conversation,
      message_count: this.store.getMessages(conversation.id).length,
      artifact_count: this.store.listArtifactsByConversation(conversation.id).length,
    };
  }

  async sendMessage(conversationId: string, userContent: string): Promise<{ reply: string }> {
    return this.sendStructuredMessage(conversationId, [{ part_type: "text", content: userContent }]);
  }

  async sendStructuredMessage(
    conversationId: string,
    userParts: Array<{ part_type: MessagePartType; content: string }>
  ): Promise<{ reply: string }> {
    return sendStructuredMessageWithCollaboration(
      {
        store: this.store,
        emitAgentEvent: (targetConversationId: string, event: Record<string, unknown>) => this.emit("agent-event", targetConversationId, event),
        buildConversationSystemPrompt: (targetConversationId: string, options: CollaborationInvocationOptions) => this.buildConversationSystemPrompt(targetConversationId, options),
        resolveMentionedSnailTitle: (messageText: string, participatingSnails: SnailName[]) => this.resolveMentionedSnailTitle(messageText, participatingSnails),
        resolveMessageTarget: (targetConversationId: string, parts: Array<{ part_type: MessagePartType; content: string }>) => this.resolveMessageTarget(targetConversationId, parts),
        refreshConversationSummary: (targetConversationId: string) => this.refreshConversationSummary(targetConversationId),
        resolveSnailByTitle: (title: string) => this.snailRegistry.getByTitle(title),
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
      MAX_COLLABORATION_TURNS
    );
  }

  getConversationMessages(conversationId: string, limit = 100, offset = 0): MessageWithParts[] {
    return this.store.getMessages(conversationId, limit, offset);
  }

  getRecentConversationMessages(conversationId: string, limit = DEFAULT_AGENT_HISTORY_USER_TURN_LIMIT): MessageWithParts[] {
    return this.store.getRecentConversationTurns(conversationId, limit);
  }

  getConversationMessagesByIds(conversationId: string, messageIds: number[]): MessageWithParts[] {
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
    const current = stageDefinitions[currentType];
    if (!current) {
      return null;
    }
    const next = Object.entries(stageDefinitions).find(([, definition]) => definition.order === current.order + 1);
    return next ? (next[0] as StageType) : null;
  }

  listSnails() {
    return this.snailRegistry.list();
  }

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
    const activeSnail = this.snailRegistry.getByTitle(options.activeSnailTitle);
    const defaultSnail = this.snailRegistry.getByTitle(conversation.default_snail);
    return buildConversationSystemPrompt({
      project,
      stage,
      conversation,
      stageDefinition,
      activeSnail,
      defaultSnail,
      remainingCollaborationTurns: options.remainingTurns,
      handoffAllowed: options.handoffAllowed,
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
    const nextSummary = await this.generateConversationSummary(summaryInput);
    this.store.updateConversation(conversationId, { summary: nextSummary });
  }

  private buildSummaryGenerationInput(conversation: Conversation, recentMessages: MessageWithParts[]): SummaryGenerationInput {
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

  private resolveMessageTarget(
    conversationId: string,
    userParts: Array<{ part_type: MessagePartType; content: string }>
  ): ResolvedSnailTarget {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const firstTextPart = userParts.find((part) => part.part_type === "text");
    const messageText = firstTextPart?.content ?? "";
    const firstMention = this.resolveMentionedSnailTitle(messageText, conversation.participating_snails);
    if (!firstMention) {
      return {
        activeSnailTitle: conversation.default_snail,
        activeSnailLabel: conversation.default_snail,
      };
    }

    const targetSnail = this.snailRegistry.getByTitle(firstMention);
    if (!targetSnail || !conversation.participating_snails.includes(targetSnail.name)) {
      return {
        activeSnailTitle: conversation.default_snail,
        activeSnailLabel: conversation.default_snail,
      };
    }

    return {
      activeSnailTitle: targetSnail.title,
      activeSnailLabel: targetSnail.title,
    };
  }

  private resolveMentionedSnailTitle(messageText: string, participatingSnails: SnailName[]): string | null {
    const mentionIndex = messageText.indexOf("@");
    if (mentionIndex === -1) return null;

    const availableTitles = participatingSnails
      .map((snailName) => this.snailRegistry.get(snailName)?.title)
      .filter((title): title is string => Boolean(title))
      .sort((left, right) => right.length - left.length);

    const matchedTitle = availableTitles.find((title) => messageText.startsWith(`@${title}`, mentionIndex));
    if (matchedTitle) {
      return matchedTitle;
    }

    return null;
  }
}
