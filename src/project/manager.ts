import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { Agent, AgentEvent, AgentMessage } from "../agent/interface";
import {
  Artifact,
  ArtifactStatus,
  ArtifactStorageType,
  ArtifactType,
  Conversation,
  ConversationHistorySearchResult,
  ConversationKind,
  ConversationStore,
  Message,
  MessagePartType,
  MessageWithParts,
  Project,
  ProjectKind,
  SnailName,
  STAGE_FORMAL_ARTIFACT_TYPES,
  STAGE_TYPES,
  Stage,
  StageStatus,
  StageType,
} from "../persistence/store";
import { buildConversationSystemPrompt, SnailRegistry } from "../snails";
import { loadArtifactDefinitions, loadStageDefinitions } from "../meta";
import { logger } from "../logger";
import { ConversationSummaryGenerator } from "../llm";

interface ResolvedSnailTarget {
  activeSnailTitle: string;
  activeSnailLabel: string;
}

interface CollaborationInvocationOptions {
  activeSnailTitle: string;
  remainingTurns: number;
  handoffAllowed: boolean;
  forcedWrapUp: boolean;
}

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
    private agent: Agent,
    private snailRegistry: SnailRegistry,
    private summaryGenerator: ConversationSummaryGenerator
  ) {
    super();
  }

  createProject(name: string, summary?: string, kind: ProjectKind = "product_delivery"): { project: Project; stage: Stage; conversation: Conversation } {
    const project = this.store.createProject(randomUUID(), kind, name, summary);
    const stage = this.store.createStage(
      randomUUID(),
      project.id,
      STAGE_TYPES[0],
      1,
      "in_progress",
      [],
      new Date().toISOString()
    );
    const conversation = this.store.createConversation(
      randomUUID(),
      project.id,
      stage.id,
      `${name} · ${stage.type}`,
      "discussion",
      this.snailRegistry.getPrimaryForStageType(stage.type).title,
      this.snailRegistry.listByStageType(stage.type).map((snail) => snail.name)
    );
    logger.info("ProjectManager initialized project workflow", { projectId: project.id, stageId: stage.id, conversationId: conversation.id });
    return { project, stage, conversation };
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
    const completedStage = this.store.updateStage(activeStage.id, {
      status: "completed",
      left_at: new Date().toISOString(),
    });

    const stages = this.store.listStages(projectId);
    const nextStage = this.store.createStage(
      randomUUID(),
      projectId,
      nextStageType,
      stages.length + 1,
      "in_progress",
      [],
      new Date().toISOString()
    );

    const primarySnail = this.snailRegistry.getPrimaryForStageType(nextStage.type);
    const participatingSnails = this.snailRegistry.listByStageType(nextStage.type).map((snail) => snail.name);
    const conversation = this.store.createConversation(
      randomUUID(),
      projectId,
      nextStage.id,
      `${project.name} · ${nextStage.type}`,
      "discussion",
      primarySnail.title,
      participatingSnails,
      `Auto-created conversation for stage ${nextStage.type}`,
      activeStage ? this.store.listConversationsByStage(activeStage.id).map((item) => item.id) : []
    );

    logger.info("ProjectManager advanced stage", {
      projectId,
      completedStageId: completedStage.id,
      nextStageId: nextStage.id,
      nextConversationId: conversation.id,
    });

    return {
      completed_stage: completedStage,
      next_stage: nextStage,
      conversation,
    };
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
    const stage = this.store.getStage(stageId);
    if (!stage || stage.project_id !== projectId) {
      throw new Error(`Stage not found: ${stageId}`);
    }
    const primarySnail = this.snailRegistry.getPrimaryForStageType(stage.type);
    const participatingSnails = this.snailRegistry.listByStageType(stage.type).map((snail) => snail.name);
    const conversation = this.store.createConversation(randomUUID(), projectId, stageId, title, kind, primarySnail.title, participatingSnails, summary, fromConversationIds);
    logger.info("ProjectManager created conversation", { conversationId: conversation.id, projectId, stageId, snailName: primarySnail.name });
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
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const resolvedTarget = this.resolveMessageTarget(conversationId, userParts);

    const userMessage = this.store.addMessage(conversationId, "user");
    this.store.replaceMessageParts(userMessage.id, userParts);
    let currentTarget = resolvedTarget;
    let remainingTurns = MAX_COLLABORATION_TURNS;
    let finalReply = "";
    let forcedWrapUpTriggered = false;

    while (true) {
      const invocation = await this.invokeSnailTurn(conversationId, {
        activeSnailTitle: currentTarget.activeSnailTitle,
        remainingTurns,
        handoffAllowed: !forcedWrapUpTriggered,
        forcedWrapUp: forcedWrapUpTriggered,
      });
      finalReply = invocation.reply;

      if (forcedWrapUpTriggered) {
        await this.refreshConversationSummary(conversationId);
        return { reply: finalReply };
      }

      const nextSnailTitle = this.resolveMentionedSnailTitle(invocation.reply, conversation.participating_snails);
      if (!nextSnailTitle) {
        await this.refreshConversationSummary(conversationId);
        return { reply: finalReply };
      }

      if (remainingTurns <= 0) {
        forcedWrapUpTriggered = true;
        currentTarget = {
          activeSnailTitle: conversation.default_snail,
          activeSnailLabel: conversation.default_snail,
        };
        const wrapUpNotice = `已达到协作轮数上限，转由 ${conversation.default_snail} 收口。`;
        const systemMessage = this.store.addMessage(conversationId, "system", null);
        this.store.replaceMessageParts(systemMessage.id, [{ part_type: "system_event", content: wrapUpNotice }]);
        this.emit("agent-event", conversationId, {
          type: "text",
          content: `[system] ${wrapUpNotice}`,
          snail_name: "system",
        });
        continue;
      }

      const nextSnail = this.snailRegistry.getByTitle(nextSnailTitle);
      if (!nextSnail || !conversation.participating_snails.includes(nextSnail.name)) {
        return { reply: finalReply };
      }

      remainingTurns -= 1;
      currentTarget = {
        activeSnailTitle: nextSnail.title,
        activeSnailLabel: nextSnail.title,
      };
    }
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
    storageType?: ArtifactStorageType,
    options?: { filePath?: string; inlineContent?: string; externalRef?: string; metadata?: string },
    status: ArtifactStatus = "active"
  ): Artifact {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    const artifactDefinitions = loadArtifactDefinitions();
    const resolvedStorageType = storageType ?? artifactDefinitions[artifactType]?.storage_type ?? "inline_text";
    const artifact = this.store.createArtifact(
      randomUUID(),
      conversation.project_id,
      conversation.stage_id,
      conversationId,
      artifactType,
      title,
      status,
      resolvedStorageType,
      options
    );
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

  private async invokeSnailTurn(conversationId: string, options: CollaborationInvocationOptions): Promise<{ reply: string }> {
    const history = this.store.getRecentConversationTurns(conversationId, DEFAULT_AGENT_HISTORY_USER_TURN_LIMIT);
    const systemPrompt = this.buildConversationSystemPrompt(conversationId, options);
    const agentMessages = this.buildAgentMessages(conversationId, history);

    this.emit("agent-event", conversationId, { type: "turn_start", snail_name: options.activeSnailTitle });

    if (this.agent.chatStream) {
      let assistantMessageId: number | null = null;
      let nextPartSequence = 1;
      const streamedTextChunks: string[] = [];
      let finalResultContent: string | null = null;

      const describeParts = (parts: Array<{ part_type: MessagePartType; content: string }>) =>
        parts.map((part) => ({
          part_type: part.part_type,
          length: part.content.length,
          preview: part.content.slice(0, 200),
        }));

      const ensureAssistantMessage = () => {
        if (assistantMessageId !== null) return assistantMessageId;
        const message = this.store.addMessage(conversationId, "assistant", options.activeSnailTitle);
        assistantMessageId = message.id;
        nextPartSequence = 1;
        return assistantMessageId;
      };

      const getPersistedParts = () => {
        if (assistantMessageId === null) return [];
        return this.store.getMessageParts(assistantMessageId).map((part) => ({
          part_type: part.part_type,
          content: part.content,
        }));
      };

      const reply = await this.agent.chatStream(agentMessages, (event: AgentEvent) => {
        if (event.type === "text") {
          logger.debug("ProjectManager received stream text event", {
            conversationId,
            preview: event.content.slice(0, 200),
            length: event.content.length,
          });
          streamedTextChunks.push(event.content);
          this.emit("agent-event", conversationId, { ...event, snail_name: options.activeSnailTitle });
          const messageId = ensureAssistantMessage();
          this.store.addMessagePart(messageId, nextPartSequence++, "text", event.content);
          logger.debug("ProjectManager appended assistant text part", {
            conversationId,
            messageId,
            parts: describeParts(getPersistedParts()),
          });
        } else if (event.type === "result") {
          logger.debug("ProjectManager received stream result event", {
            conversationId,
            preview: event.content.slice(0, 200),
            length: event.content.length,
            matchesStreamedText: event.content === streamedTextChunks.join(""),
          });
          finalResultContent = event.content;
          this.emit("agent-event", conversationId, { ...event, snail_name: options.activeSnailTitle });
          const messageId = ensureAssistantMessage();
          this.store.addMessagePart(messageId, nextPartSequence++, "result", event.content);
          logger.debug("ProjectManager appended assistant result part", {
            conversationId,
            messageId,
            parts: describeParts(getPersistedParts()),
          });
        } else if (event.type === "tool_use") {
          const toolObservation = describeToolUse(event.name, event.input);
          logger.debug("ProjectManager received stream tool_use event", {
            conversationId,
            toolName: event.name,
            summary: toolObservation.summary,
            detail: toolObservation.detail,
            input: event.input,
          });
          this.emit("agent-event", conversationId, {
            ...event,
            summary: toolObservation.summary,
            detail: toolObservation.detail,
            snail_name: options.activeSnailTitle,
          });
          const messageId = ensureAssistantMessage();
          this.store.addMessagePart(messageId, nextPartSequence++, "tool_use", JSON.stringify({
            id: event.id,
            name: event.name,
            input: event.input,
            summary: toolObservation.summary,
            detail: toolObservation.detail,
          }));
          logger.debug("ProjectManager appended assistant tool_use part", {
            conversationId,
            messageId,
            parts: describeParts(getPersistedParts()),
          });
        } else {
          this.emit("agent-event", conversationId, { ...event, snail_name: options.activeSnailTitle });
        }
      }, systemPrompt);

      const fallbackReplyContent = finalResultContent ?? reply.content ?? streamedTextChunks.join("");

      if (assistantMessageId === null) {
        const message = this.store.addMessage(conversationId, "assistant", options.activeSnailTitle);
        const parts = [{ part_type: "result" as MessagePartType, content: fallbackReplyContent }];
        this.store.replaceMessageParts(message.id, parts);
      }

      return { reply: fallbackReplyContent };
    }

    const reply = await this.agent.chat(agentMessages, systemPrompt);
    const message = this.store.addMessage(conversationId, "assistant", options.activeSnailTitle);
    this.store.replaceMessageParts(message.id, [{ part_type: "result", content: reply.content }]);
    return { reply: reply.content };
  }

  private buildAgentMessageContent(message: MessageWithParts): string {
    if (message.role === "assistant") {
      const content = this.buildAssistantMessageContent(message.parts);
      return `${message.snail_name ?? "Assistant"}:\n${content}`;
    }
    const content = this.buildUserMessageContent(message.parts);
    return `USER:\n${content}`;
  }

  private buildAssistantMessageContent(parts: Array<{ part_type: MessagePartType; content: string }>): string {
    const resultParts = parts.filter((part) => part.part_type === "result");
    if (resultParts.length > 0) {
      return resultParts.map((part) => part.content).join("\n\n");
    }

    return parts
      .filter((part) => part.part_type !== "result")
      .map((part) => part.content)
      .join("\n\n");
  }

  private buildUserMessageContent(parts: Array<{ part_type: MessagePartType; content: string }>): string {
    return parts
      .filter((part) => part.part_type === "text")
      .map((part) => part.content)
      .join("\n\n");
  }

  private buildAgentMessages(conversationId: string, history: MessageWithParts[]): AgentMessage[] {
    const messages: AgentMessage[] = [];
    const summaryMessage = this.buildConversationSummaryMessage(conversationId);
    if (summaryMessage) {
      messages.push(summaryMessage);
    }

    messages.push(
      ...history
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: this.buildAgentMessageContent(message),
        }))
    );

    return messages;
  }

  private buildConversationSummaryMessage(conversationId?: string): AgentMessage | null {
    if (!conversationId) return null;
    const conversation = this.store.getConversation(conversationId);
    const summary = conversation?.summary?.trim();
    if (!summary) return null;
    return {
      role: "assistant",
      content: `Conversation summary:\n${summary}`,
    };
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

function describeToolUse(name: string, input: Record<string, unknown>): { summary: string; detail: string } {
  const filePath = asString(input.file_path) || asString(input.filePath);
  const command = asString(input.command);
  const pattern = asString(input.pattern);
  const query = asString(input.query);

  switch (name) {
    case "Read":
      return {
        summary: `读取文件 ${summarizePath(filePath)}`,
        detail: filePath ? `读取 ${filePath}` : "读取文件内容",
      };
    case "Write":
      return {
        summary: `写入文件 ${summarizePath(filePath)}`,
        detail: filePath ? `写入 ${filePath}` : "写入文件内容",
      };
    case "Edit":
      return {
        summary: `编辑文件 ${summarizePath(filePath)}`,
        detail: filePath ? `编辑 ${filePath}` : "编辑文件内容",
      };
    case "Glob":
      return {
        summary: `搜索文件模式 ${pattern || "<unknown>"}`,
        detail: pattern ? `按模式 ${pattern} 搜索文件` : "搜索文件",
      };
    case "Grep":
      return {
        summary: `搜索内容 ${pattern || query || "<unknown>"}`,
        detail: pattern || query ? `搜索内容模式 ${pattern || query}` : "搜索文件内容",
      };
    case "Bash":
      return {
        summary: `执行命令 ${clipForDisplay(command || "<unknown>", 72)}`,
        detail: command ? `执行命令: ${command}` : "执行 shell 命令",
      };
    default:
      return {
        summary: `${name} 工具调用`,
        detail: `${name} 输入: ${clipForDisplay(JSON.stringify(input), 180)}`,
      };
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function summarizePath(filePath: string): string {
  if (!filePath) return "<unknown>";
  const normalized = filePath.replace(process.cwd(), ".");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 3) return normalized;
  return `.../${segments.slice(-3).join("/")}`;
}

function clipForDisplay(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}
