import type { LobbyResponse, NavigationContext } from "./types";

export interface LobbyResponseRenderer {
  renderWorkspaceList(workspaces: Array<{ id: string; name: string; feature_count: number }>): LobbyResponse;
  renderFeatureList(features: Array<{ id: string; title: string; status: string }>, projectName: string): LobbyResponse;
  renderEnterSuccess(conversationTitle: string, featureTitle: string): LobbyResponse;
  renderBackResult(context: NavigationContext): LobbyResponse;
  renderStatus(context: NavigationContext): LobbyResponse;
  renderHelp(): LobbyResponse;
  renderError(message: string): LobbyResponse;
  renderUnknownCommand(command: string): LobbyResponse;
  renderNonCommandInLobby(): LobbyResponse;
  renderOutboundMessage(input: { roleName: string; text: string; maxLength: number }): string;
}

export class PlainTextLobbyRenderer implements LobbyResponseRenderer {
  renderWorkspaceList(workspaces: Array<{ id: string; name: string; feature_count: number }>): LobbyResponse {
    if (workspaces.length === 0) return { text: "暂无工作区。请先在 Web UI 中创建工作区。" };
    const lines = workspaces.map((p, i) => `${i + 1}. ${p.name} (${p.feature_count} features) [${p.id}]`);
    return { text: `📂 工作区列表：\n${lines.join("\n")}\n\n使用 /features <id> 浏览 feature` };
  }

  renderFeatureList(features: Array<{ id: string; title: string; status: string }>, projectName: string): LobbyResponse {
    if (features.length === 0) return { text: `项目 "${projectName}" 暂无 feature。` };
    const lines = features.map((f, i) => {
      const badge = f.status === "archived" ? "📦" : "🟢";
      return `${i + 1}. ${badge} ${f.title} [${f.id}]`;
    });
    return { text: `📋 ${projectName} 的 Features：\n${lines.join("\n")}\n\n使用 /enter <id> 进入对话` };
  }

  renderEnterSuccess(conversationTitle: string, featureTitle: string): LobbyResponse {
    return {
      text: `✅ 已进入房间：${featureTitle}\n对话：${conversationTitle}\n\n现在可以直接发消息与 Agent 对话。使用 /back 退出房间。`,
    };
  }

  renderBackResult(context: NavigationContext): LobbyResponse {
    switch (context.level) {
      case "lobby":
        return { text: "↩ 已返回大厅。使用 /workspaces 浏览工作区。" };
      case "workspace_list":
        return { text: "↩ 已返回工作区列表。" };
      case "feature_list":
        return { text: `↩ 已返回 feature 列表（工作区：${context.workspace?.name ?? "未知"}）。` };
      default:
        return { text: "↩ 已返回。" };
    }
  }

  renderStatus(context: NavigationContext): LobbyResponse {
    const parts: string[] = [`📍 当前位置：${levelLabel(context.level)}`];
    if (context.workspace) parts.push(`  工作区：${context.workspace.name}`);
    if (context.feature) parts.push(`  Feature：${context.feature.title}`);
    if (context.stage) parts.push(`  阶段：${context.stage.type}`);
    if (context.conversation) parts.push(`  对话：${context.conversation.title}`);
    return { text: parts.join("\n") };
  }

  renderHelp(): LobbyResponse {
    return {
      text: [
        "📖 IM 大厅命令：",
        "/workspaces — 列出所有工作区",
        "/features <workspace_id> — 列出工作区下的 feature",
        "/enter <feature_id> — 进入 feature 的对话",
        "/back — 返回上一级",
        "/lobby — 直接回到大厅",
        "/status — 查看当前位置",
        "/help — 显示此帮助",
      ].join("\n"),
    };
  }

  renderError(message: string): LobbyResponse {
    return { text: `❌ ${message}` };
  }

  renderUnknownCommand(command: string): LobbyResponse {
    return { text: `❓ 未知命令：/${command}\n输入 /help 查看可用命令。` };
  }

  renderNonCommandInLobby(): LobbyResponse {
    return { text: "当前在大厅中，请使用斜杠命令导航。输入 /help 查看可用命令。" };
  }

  renderOutboundMessage(input: { roleName: string; text: string; maxLength: number }): string {
    const prefix = `[${input.roleName}] `;
    const maxBody = input.maxLength - prefix.length;
    const body = input.text.length > maxBody ? input.text.slice(0, maxBody) + "…" : input.text;
    return prefix + body;
  }
}

function levelLabel(level: NavigationContext["level"]): string {
  switch (level) {
    case "lobby": return "大厅";
    case "workspace_list": return "工作区列表";
    case "feature_list": return "Feature 列表";
    case "in_conversation": return "房间内";
  }
}
