import type { WorkspacePort } from "@domain/workspace/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { LobbySession, LobbyResponse, NavigationContext } from "@domain/im/model";
import type { LobbySessionRepository } from "@domain/im/_internal/repository";
import type { LobbyResponseRenderer } from "@domain/im/_internal/response-renderer";
import { parseLobbyCommand } from "@domain/im/_internal/command-parser";

export class LobbyCommandExecutor {
  constructor(
    private readonly workspacePort: WorkspacePort,
    private readonly issuePort: IssuePort,
    private readonly stagePort: StagePort,
    private readonly lobbyRepo: LobbySessionRepository,
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
    }
  }

  buildNavigationContext(session: LobbySession): NavigationContext {
    const ctx: NavigationContext = {
      level: session.navigation_level,
      workspace: null,
      issue: null,
      stage: null,
    };
    if (session.current_workspace_id) {
      const allWorkspaces = this.workspacePort.list();
      const workspace = allWorkspaces.find(w => w.path === session.current_workspace_id);
      if (workspace) ctx.workspace = { path: workspace.path, summary: workspace.summary };
    }
    if (session.current_issue_id) {
      const issue = this.issuePort.findIssue(session.current_issue_id);
      if (issue) ctx.issue = { id: issue.id, title: issue.title };
    }
    if (session.current_stage_id) {
      const stage = this.stagePort.findStage(session.current_stage_id);
      if (stage) ctx.stage = { id: stage.id, key: stage.key };
    }
    return ctx;
  }

  private handleWorkspaces(session: LobbySession): LobbyResponse {
    const workspaces = this.workspacePort.list();
    this.lobbyRepo.updateNavigation(session.id, {
      navigation_level: "workspace_list",
      current_workspace_id: null,
      current_issue_id: null,
      current_stage_id: null,
    });
    return this.renderer.renderWorkspaceList(
      workspaces.map(w => ({
        path: w.path,
        summary: w.summary,
        issueCount: this.issuePort.listIssues(w.path).length,
      })),
    );
  }

  private handleIssues(session: LobbySession, workspacePath: string | null): LobbyResponse {
    const targetPath = workspacePath ?? session.current_workspace_id;
    if (!targetPath) return this.renderer.renderError("请指定工作区路径：/issues <workspace_path>");
    const allWorkspaces = this.workspacePort.list();
    const workspace = allWorkspaces.find(w => w.path === targetPath);
    if (!workspace) return this.renderer.renderError(`工作区未找到：${targetPath}`);
    const issues = this.issuePort.listIssues(targetPath);
    this.lobbyRepo.updateNavigation(session.id, {
      navigation_level: "issue_list",
      current_workspace_id: targetPath,
      current_issue_id: null,
      current_stage_id: null,
    });
    return this.renderer.renderIssueList(
      issues.map(f => ({ id: f.id, title: f.title, status: f.closed_at ? "closed" : "active" })),
      workspace.path.split("/").pop() ?? workspace.path,
    );
  }

  private handleEnter(session: LobbySession, issueId: string | null): LobbyResponse {
    if (!issueId) return this.renderer.renderError("请指定 issue ID：/enter <issue_id>");
    const issue = this.issuePort.findIssue(issueId);
    if (!issue) return this.renderer.renderError(`Issue 未找到：${issueId}`);
    const stages = this.stagePort.listStages(issueId);
    const currentStage = stages.find(s => s.left_at === null);
    if (!currentStage) return this.renderer.renderError(`Issue "${issue.title}" 没有活跃的 stage。`);
    this.lobbyRepo.updateNavigation(session.id, {
      navigation_level: "in_stage",
      current_workspace_id: issue.workspace_path,
      current_issue_id: issueId,
      current_stage_id: currentStage.id,
    });
    return this.renderer.renderEnterSuccess(currentStage.key, issue.title);
  }

  private handleBack(session: LobbySession): LobbyResponse {
    switch (session.navigation_level) {
      case "in_stage":
        this.lobbyRepo.updateNavigation(session.id, {
          navigation_level: "issue_list",
          current_stage_id: null,
        });
        break;
      case "issue_list":
        this.lobbyRepo.updateNavigation(session.id, {
          navigation_level: "workspace_list",
          current_issue_id: null,
          current_workspace_id: null,
        });
        break;
      case "workspace_list":
        this.lobbyRepo.updateNavigation(session.id, {
          navigation_level: "lobby",
          current_workspace_id: null,
        });
        break;
      default:
        break;
    }
    const fresh = this.lobbyRepo.get(session.id)!;
    return this.renderer.renderBackResult(this.buildNavigationContext(fresh));
  }

  private handleLobby(session: LobbySession): LobbyResponse {
    this.lobbyRepo.updateNavigation(session.id, {
      navigation_level: "lobby",
      current_workspace_id: null,
      current_issue_id: null,
      current_stage_id: null,
    });
    return { text: "已返回大厅。使用 /workspaces 浏览工作区。" };
  }

  private handleStatus(session: LobbySession): LobbyResponse {
    return this.renderer.renderStatus(this.buildNavigationContext(session));
  }
}
