import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { Agent, AgentEvent, AgentMessage } from "../agent/interface";
import {
  Artifact,
  ArtifactStatus,
  ArtifactStorageType,
  ArtifactType,
  Conversation,
  ConversationKind,
  ConversationStore,
  Message,
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

export class ProjectManager extends EventEmitter {
  constructor(
    private store: ConversationStore,
    private agent: Agent,
    private snailRegistry: SnailRegistry
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
      this.snailRegistry.getPrimaryForStageType(stage.type).name,
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
      primarySnail.name,
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
    const conversation = this.store.createConversation(randomUUID(), projectId, stageId, title, kind, primarySnail.name, participatingSnails, summary, fromConversationIds);
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
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    this.store.addMessage(conversationId, "user", userContent);
    const history = this.store.getMessages(conversationId);
    const systemPrompt = this.buildConversationSystemPrompt(conversationId);
    const agentMessages: AgentMessage[] = history.map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));

    if (this.agent.chatStream) {
      let fullReply = "";
      let assistantMessageId: number | null = null;

      const reply = await this.agent.chatStream(agentMessages, (event: AgentEvent) => {
        this.emit("agent-event", conversationId, event);
        if (event.type === "text") {
          fullReply += event.content;
          if (assistantMessageId === null) {
            const message = this.store.addMessage(conversationId, "assistant", fullReply);
            assistantMessageId = message.id;
          } else {
            this.store.updateMessage(assistantMessageId, fullReply);
          }
        } else if (event.type === "result") {
          fullReply = event.content;
          if (assistantMessageId !== null) {
            this.store.updateMessage(assistantMessageId, fullReply);
          }
        }
      }, systemPrompt);

      if (assistantMessageId === null) {
        this.store.addMessage(conversationId, "assistant", reply.content);
      }
      return { reply: reply.content };
    }

    const reply = await this.agent.chat(agentMessages, systemPrompt);
    this.store.addMessage(conversationId, "assistant", reply.content);
    return { reply: reply.content };
  }

  getConversationMessages(conversationId: string, limit = 100, offset = 0): Message[] {
    return this.store.getMessages(conversationId, limit, offset);
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

  private buildConversationSystemPrompt(conversationId: string): string {
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
    const snail = this.snailRegistry.get(conversation.snail_name);
    return buildConversationSystemPrompt({
      project,
      stage,
      conversation,
      stageDefinition,
      primarySnail: snail,
      participatingSnails: conversation.participating_snails
        .map((snailName) => this.snailRegistry.get(snailName))
        .filter(Boolean) as any,
    });
  }
}
