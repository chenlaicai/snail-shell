import type { WorkspaceManager } from "../workspace-workflow/manager";
import type { ConversationStore } from "../persistence/store";
import type { LobbySessionStore } from "./session-store";
import type { LobbyResponseRenderer } from "./response-renderer";
import type { LobbySession, LobbyResponse, NavigationContext } from "./types";
import { parseLobbyCommand } from "./command-parser";

export class LobbyCommandExecutor {
  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly store: ConversationStore,
    private readonly sessionStore: LobbySessionStore,
    private readonly renderer: LobbyResponseRenderer,
  ) {}

  async execute(session: LobbySession, commandText: string): Promise<LobbyResponse> {
    const cmd = parseLobbyCommand(commandText);
    switch (cmd.type) {
      case "workspaces": return this.handleWorkspaces(session);
      case "issues": return this.handleIssues(session, cmd.argument);
      case "enter": return this.handleEnter(session, cmd.argument);
      case "back": return this.handleBack(session);
      case "lobby": return this.handleLobby(session);
      case "status": return this.handleStatus(session);
      case "help": return this.renderer.renderHelp();
      case "unknown": return this.renderer.renderUnknownCommand(cmd.argument ?? "");
      default: return this.renderer.renderHelp();
    }
  }

  private async handleWorkspaces(session: LobbySession): Promise<LobbyResponse> {
    const workspaces = this.workspaceManager.listWorkspaces();
    this.sessionStore.updateNavigation(session.id, {
      navigation_level: "workspace_list",
      current_workspace_id: null,
      current_issue_id: null,
      current_stage_id: null,
      current_conversation_id: null,
    });
    return this.renderer.renderWorkspaceList(
      workspaces.map((p) => ({ id: p.id, name: p.name, issue_count: p.issue_count })),
    );
  }

  private async handleIssues(session: LobbySession, workspaceId: string | null): Promise<LobbyResponse> {
    const targetWorkspaceId = workspaceId ?? session.current_workspace_id;
    if (!targetWorkspaceId) return this.renderer.renderError("请指定工作区 ID：/issues <workspace_id>");
    const workspace = this.workspaceManager.getWorkspace(targetWorkspaceId);
    if (!workspace) return this.renderer.renderError(`工作区未找到：${targetWorkspaceId}`);
    this.sessionStore.updateNavigation(session.id, {
      navigation_level: "issue_list",
      current_workspace_id: targetWorkspaceId,
      current_issue_id: null,
      current_stage_id: null,
      current_conversation_id: null,
    });
    return this.renderer.renderIssueList(
      workspace.issues.map((f) => ({ id: f.id, title: f.title, status: f.closed_at ? "archived" : "active" })),
      workspace.name,
    );
  }

  private async handleEnter(session: LobbySession, issueId: string | null): Promise<LobbyResponse> {
    if (!issueId) return this.renderer.renderError("请指定 issue ID：/enter <issue_id>");
    const issue = this.workspaceManager.getIssue(issueId);
    if (!issue) return this.renderer.renderError(`Issue 未找到：${issueId}`);
    const currentStage = issue.current_stage;
    if (!currentStage) return this.renderer.renderError(`Issue "${issue.title}" 没有活跃的 stage。`);
    const conversations = this.store.listConversationsByStage(currentStage.id);
    const conversation = conversations[0];
    if (!conversation) return this.renderer.renderError(`Issue "${issue.title}" 当前 stage 没有对话。`);
    this.sessionStore.updateNavigation(session.id, {
      navigation_level: "in_conversation",
      current_workspace_id: issue.workspace_id,
      current_issue_id: issueId,
      current_stage_id: currentStage.id,
      current_conversation_id: conversation.id,
    });
    return this.renderer.renderEnterSuccess(conversation.title, issue.title);
  }

  private async handleBack(session: LobbySession): Promise<LobbyResponse> {
    switch (session.navigation_level) {
      case "in_conversation": {
        this.sessionStore.updateNavigation(session.id, {
          navigation_level: "issue_list",
          current_conversation_id: null,
          current_stage_id: null,
        });
        return this.renderer.renderBackResult(this.buildNavigationContext(this.sessionStore.get(session.id)!));
      }
      case "issue_list": {
        this.sessionStore.updateNavigation(session.id, {
          navigation_level: "workspace_list",
          current_issue_id: null,
          current_workspace_id: null,
        });
        return this.renderer.renderBackResult(this.buildNavigationContext(this.sessionStore.get(session.id)!));
      }
      case "workspace_list": {
        this.sessionStore.updateNavigation(session.id, {
          navigation_level: "lobby",
          current_workspace_id: null,
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
      current_workspace_id: null,
      current_issue_id: null,
      current_stage_id: null,
      current_conversation_id: null,
    });
    return this.renderer.renderBackResult({ level: "lobby", workspace: null, issue: null, stage: null, conversation: null });
  }

  private async handleStatus(session: LobbySession): Promise<LobbyResponse> {
    return this.renderer.renderStatus(this.buildNavigationContext(session));
  }

  buildNavigationContext(session: LobbySession): NavigationContext {
    const ctx: NavigationContext = {
      level: session.navigation_level,
      workspace: null,
      issue: null,
      stage: null,
      conversation: null,
    };
    if (session.current_workspace_id) {
      const workspace = this.workspaceManager.getWorkspace(session.current_workspace_id);
      if (workspace) ctx.workspace = { id: workspace.id, name: workspace.name };
    }
    if (session.current_issue_id) {
      const issue = this.workspaceManager.getIssue(session.current_issue_id);
      if (issue) ctx.issue = { id: issue.id, title: issue.title };
    }
    if (session.current_stage_id) {
      const stage = this.workspaceManager.getStage(session.current_stage_id);
      if (stage) ctx.stage = { id: stage.id, type: stage.type };
    }
    if (session.current_conversation_id) {
      const conversation = this.store.getConversation(session.current_conversation_id);
      if (conversation) ctx.conversation = { id: conversation.id, title: conversation.title };
    }
    return ctx;
  }
}
