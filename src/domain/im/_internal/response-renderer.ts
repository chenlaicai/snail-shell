import type { LobbyResponse, NavigationContext } from "@domain/im/model";

export interface LobbyResponseRenderer {
  renderWorkspaceList(workspaces: Array<{ path: string; summary: string | null; issueCount: number }>): LobbyResponse;
  renderIssueList(issues: Array<{ id: string; title: string; status: string }>, workspaceLabel: string): LobbyResponse;
  renderEnterSuccess(stageKey: string, issueTitle: string): LobbyResponse;
  renderBackResult(context: NavigationContext): LobbyResponse;
  renderStatus(context: NavigationContext): LobbyResponse;
  renderHelp(): LobbyResponse;
  renderError(message: string): LobbyResponse;
  renderUnknownCommand(command: string): LobbyResponse;
  renderNonCommandInLobby(): LobbyResponse;
  renderOutboundMessage(input: { roleName: string; text: string; maxLength: number }): string;
}

function levelLabel(level: NavigationContext["level"]): string {
  switch (level) {
    case "lobby": return "大厅";
    case "workspace_list": return "工作区列表";
    case "issue_list": return "Issue 列表";
    case "in_stage": return "Stage 中";
  }
}

export class PlainTextLobbyRenderer implements LobbyResponseRenderer {
  renderWorkspaceList(workspaces: Array<{ path: string; summary: string | null; issueCount: number }>): LobbyResponse {
    if (workspaces.length === 0) {
      return { text: "暂无工作区。请先在 Web UI 中创建工作区。" };
    }
    const lines = workspaces.map((w, i) => {
      const name = w.path.split("/").pop() ?? w.path;
      const desc = w.summary ? ` — ${w.summary}` : "";
      return `${i + 1}. ${name}${desc} (${w.issueCount} issues) [${w.path}]`;
    });
    return { text: `工作区列表：\n${lines.join("\n")}\n\n使用 /issues <path> 浏览 issue` };
  }

  renderIssueList(issues: Array<{ id: string; title: string; status: string }>, workspaceLabel: string): LobbyResponse {
    if (issues.length === 0) {
      return { text: `工作区 "${workspaceLabel}" 暂无 issue。` };
    }
    const lines = issues.map((f, i) => {
      const badge = f.status === "archived" ? "📦" : "🟢";
      return `${i + 1}. ${badge} ${f.title} [${f.id}]`;
    });
    return { text: `Issue 列表 (${workspaceLabel})：\n${lines.join("\n")}\n\n使用 /enter <id> 进入 stage` };
  }

  renderEnterSuccess(stageKey: string, issueTitle: string): LobbyResponse {
    return { text: `✅ 已进入 "${issueTitle}" 的 ${stageKey} stage。\n发送消息将转发给 agent。使用 /back 退出。` };
  }

  renderBackResult(context: NavigationContext): LobbyResponse {
    switch (context.level) {
      case "lobby":
        return { text: "已返回大厅。使用 /workspaces 浏览工作区。" };
      case "workspace_list":
        return { text: "已返回工作区列表。" };
      case "issue_list":
        return { text: "已返回 issue 列表。" };
      case "in_stage":
        return { text: `已返回 stage: ${context.stage?.key ?? "未知"}` };
    }
  }

  renderStatus(context: NavigationContext): LobbyResponse {
    const lines = [`当前位置：${levelLabel(context.level)}`];
    if (context.workspace) lines.push(`  工作区：${context.workspace.path.split("/").pop()}`);
    if (context.issue) lines.push(`  Issue：${context.issue.title}`);
    if (context.stage) lines.push(`  Stage：${context.stage.key}`);
    return { text: lines.join("\n") };
  }

  renderHelp(): LobbyResponse {
    return {
      text: [
        "可用命令：",
        "/workspaces — 列出所有工作区",
        "/issues <path> — 列出工作区下的 issue",
        "/enter <issue_id> — 进入 issue 的当前 stage",
        "/back — 返回上一级",
        "/lobby — 返回大厅",
        "/status — 显示当前位置",
        "/help — 显示此帮助",
      ].join("\n"),
    };
  }

  renderError(message: string): LobbyResponse {
    return { text: `❌ ${message}` };
  }

  renderUnknownCommand(command: string): LobbyResponse {
    return { text: `❓ 未知命令：/${command}\n使用 /help 查看可用命令。` };
  }

  renderNonCommandInLobby(): LobbyResponse {
    return { text: "请使用斜杠命令操作。输入 /help 查看可用命令。" };
  }

  renderOutboundMessage(input: { roleName: string; text: string; maxLength: number }): string {
    const prefix = `[${input.roleName}] `;
    const available = input.maxLength - prefix.length;
    if (input.text.length <= available) return prefix + input.text;
    return prefix + input.text.slice(0, available) + "...";
  }
}
