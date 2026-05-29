import type { ProjectManager } from "../project-workflow/manager";
import type { ConversationStore } from "../persistence/store";
import type { LobbySessionStore } from "./session-store";
import type { LobbyResponseRenderer } from "./response-renderer";
import type { LobbySession, LobbyResponse, NavigationContext } from "./types";
import { parseLobbyCommand } from "./command-parser";

export class LobbyCommandExecutor {
  constructor(
    private readonly projectManager: ProjectManager,
    private readonly store: ConversationStore,
    private readonly sessionStore: LobbySessionStore,
    private readonly renderer: LobbyResponseRenderer,
  ) {}

  async execute(session: LobbySession, commandText: string): Promise<LobbyResponse> {
    const cmd = parseLobbyCommand(commandText);
    switch (cmd.type) {
      case "projects": return this.handleProjects(session);
      case "features": return this.handleFeatures(session, cmd.argument);
      case "enter": return this.handleEnter(session, cmd.argument);
      case "back": return this.handleBack(session);
      case "lobby": return this.handleLobby(session);
      case "status": return this.handleStatus(session);
      case "help": return this.renderer.renderHelp();
      case "unknown": return this.renderer.renderUnknownCommand(cmd.argument ?? "");
      default: return this.renderer.renderHelp();
    }
  }

  private async handleProjects(session: LobbySession): Promise<LobbyResponse> {
    const projects = this.projectManager.listProjects();
    this.sessionStore.updateNavigation(session.id, {
      navigation_level: "project_list",
      current_project_id: null,
      current_feature_id: null,
      current_stage_id: null,
      current_conversation_id: null,
    });
    return this.renderer.renderProjectList(
      projects.map((p) => ({ id: p.id, name: p.name, feature_count: p.feature_count })),
    );
  }

  private async handleFeatures(session: LobbySession, projectId: string | null): Promise<LobbyResponse> {
    const targetProjectId = projectId ?? session.current_project_id;
    if (!targetProjectId) return this.renderer.renderError("请指定项目 ID：/features <project_id>");
    const project = this.projectManager.getProject(targetProjectId);
    if (!project) return this.renderer.renderError(`项目未找到：${targetProjectId}`);
    this.sessionStore.updateNavigation(session.id, {
      navigation_level: "feature_list",
      current_project_id: targetProjectId,
      current_feature_id: null,
      current_stage_id: null,
      current_conversation_id: null,
    });
    return this.renderer.renderFeatureList(
      project.features.map((f) => ({ id: f.id, title: f.title, status: f.closed_at ? "archived" : "active" })),
      project.name,
    );
  }

  private async handleEnter(session: LobbySession, featureId: string | null): Promise<LobbyResponse> {
    if (!featureId) return this.renderer.renderError("请指定 feature ID：/enter <feature_id>");
    const feature = this.projectManager.getFeature(featureId);
    if (!feature) return this.renderer.renderError(`Feature 未找到：${featureId}`);
    const currentStage = feature.current_stage;
    if (!currentStage) return this.renderer.renderError(`Feature "${feature.title}" 没有活跃的 stage。`);
    const conversations = this.store.listConversationsByStage(currentStage.id);
    const conversation = conversations[0];
    if (!conversation) return this.renderer.renderError(`Feature "${feature.title}" 当前 stage 没有对话。`);
    this.sessionStore.updateNavigation(session.id, {
      navigation_level: "in_conversation",
      current_project_id: feature.project_id,
      current_feature_id: featureId,
      current_stage_id: currentStage.id,
      current_conversation_id: conversation.id,
    });
    return this.renderer.renderEnterSuccess(conversation.title, feature.title);
  }

  private async handleBack(session: LobbySession): Promise<LobbyResponse> {
    switch (session.navigation_level) {
      case "in_conversation": {
        this.sessionStore.updateNavigation(session.id, {
          navigation_level: "feature_list",
          current_conversation_id: null,
          current_stage_id: null,
        });
        return this.renderer.renderBackResult(this.buildNavigationContext(this.sessionStore.get(session.id)!));
      }
      case "feature_list": {
        this.sessionStore.updateNavigation(session.id, {
          navigation_level: "project_list",
          current_feature_id: null,
          current_project_id: null,
        });
        return this.renderer.renderBackResult(this.buildNavigationContext(this.sessionStore.get(session.id)!));
      }
      case "project_list": {
        this.sessionStore.updateNavigation(session.id, {
          navigation_level: "lobby",
          current_project_id: null,
        });
        return this.renderer.renderBackResult(this.buildNavigationContext(this.sessionStore.get(session.id)!));
      }
      default:
        return this.renderer.renderBackResult(this.buildNavigationContext(session));
    }
  }

  private async handleLobby(session: LobbySession): Promise<LobbyResponse> {
    this.sessionStore.updateNavigation(session.id, {
      navigation_level: "lobby",
      current_project_id: null,
      current_feature_id: null,
      current_stage_id: null,
      current_conversation_id: null,
    });
    return this.renderer.renderBackResult({ level: "lobby", project: null, feature: null, stage: null, conversation: null });
  }

  private async handleStatus(session: LobbySession): Promise<LobbyResponse> {
    return this.renderer.renderStatus(this.buildNavigationContext(session));
  }

  buildNavigationContext(session: LobbySession): NavigationContext {
    const ctx: NavigationContext = {
      level: session.navigation_level,
      project: null,
      feature: null,
      stage: null,
      conversation: null,
    };
    if (session.current_project_id) {
      const project = this.projectManager.getProject(session.current_project_id);
      if (project) ctx.project = { id: project.id, name: project.name };
    }
    if (session.current_feature_id) {
      const feature = this.projectManager.getFeature(session.current_feature_id);
      if (feature) ctx.feature = { id: feature.id, title: feature.title };
    }
    if (session.current_stage_id) {
      const stage = this.projectManager.getStage(session.current_stage_id);
      if (stage) ctx.stage = { id: stage.id, type: stage.type };
    }
    if (session.current_conversation_id) {
      const conversation = this.store.getConversation(session.current_conversation_id);
      if (conversation) ctx.conversation = { id: conversation.id, title: conversation.title };
    }
    return ctx;
  }
}
