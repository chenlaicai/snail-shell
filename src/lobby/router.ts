// ConversationGateway 接口定义（原从 interaction-entry/gateway 导入）
// 为了避免循环依赖，在 lobby 模块内联定义所需接口
interface ConversationGateway {
  sendMessage(conversationId: string, input: unknown): Promise<unknown>;
}

// HUMAN_ROLE_NAME 常量
const HUMAN_ROLE_NAME = "项目负责人";

import type { LobbyCommandExecutor } from "./command-executor";
import type { LobbyResponseRenderer } from "./response-renderer";
import type { LobbySessionStore } from "./session-store";
import type { LobbyResponse, LobbySession, NavigationContext } from "./types";
import { parseLobbyCommand } from "./command-parser";

export interface LobbyRouterDeps {
  sessionStore: LobbySessionStore;
  commandExecutor: LobbyCommandExecutor;
  responseRenderer: LobbyResponseRenderer;
  gateway: ConversationGateway;
}

export class LobbyRouter {
  constructor(private readonly deps: LobbyRouterDeps) {}

  /**
   * 处理来自 IM 通道的入站消息。
   * - 如果是大厅命令 → 返回 { response, session }
   * - 如果已进入房间且是普通文本 → 转发到 conversation，返回 { forwarded: true, session }
   */
  async processInbound(params: {
    channelType: string;
    channelChatId: string;
    channelTenantKey: string | null;
    text: string;
  }): Promise<
    | { response: LobbyResponse; session: LobbySession }
    | { forwarded: true; session: LobbySession; messageIds: number[] }
  > {
    const { sessionStore } = this.deps;
    const session = sessionStore.getOrCreate(params.channelType, params.channelChatId, params.channelTenantKey);
    const cmd = parseLobbyCommand(params.text);

    if (session.navigation_level === "in_conversation" && session.current_conversation_id) {
      return this.handleInConversation(session, cmd, params.text);
    }
    return this.handleInLobby(session, cmd, params.text);
  }

  private async handleInConversation(
    session: LobbySession, cmd: { type: string }, text: string,
  ): Promise<
    | { response: LobbyResponse; session: LobbySession }
    | { forwarded: true; session: LobbySession; messageIds: number[] }
  > {
    const { sessionStore, commandExecutor, gateway } = this.deps;
    const conversationId = session.current_conversation_id!;

    if (cmd.type === "back" || cmd.type === "lobby" || cmd.type === "status" || cmd.type === "help") {
      const response = await commandExecutor.execute(session, text);
      sessionStore.addMessage({ lobby_session_id: session.id, direction: "inbound", command: text, content: text, response_content: response.text });
      return { response, session: sessionStore.get(session.id)! };
    }

    sessionStore.addMessage({ lobby_session_id: session.id, direction: "inbound", content: text });
    const sendResult = await gateway.sendMessage(conversationId, { content: text, fromRole: HUMAN_ROLE_NAME });
    const messageIds = "messageIds" in sendResult ? sendResult.messageIds : [];
    return { forwarded: true, session, messageIds };
  }

  private async handleInLobby(
    session: LobbySession, cmd: { type: string }, text: string,
  ): Promise<
    | { response: LobbyResponse; session: LobbySession }
    | { forwarded: true; session: LobbySession; messageIds: number[] }
  > {
    const { sessionStore, commandExecutor, responseRenderer } = this.deps;

    if (cmd.type === "unknown" && !text.trim().startsWith("/")) {
      const response = responseRenderer.renderNonCommandInLobby();
      sessionStore.addMessage({ lobby_session_id: session.id, direction: "inbound", content: text, response_content: response.text });
      return { response, session };
    }

    const response = await commandExecutor.execute(session, text);
    sessionStore.addMessage({ lobby_session_id: session.id, direction: "inbound", command: text, content: text, response_content: response.text });
    return { response, session: sessionStore.get(session.id)! };
  }

  getSessionForChannel(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession | null {
    return this.deps.sessionStore.getByChannel(channelType, channelChatId, channelTenantKey);
  }

  getActiveConversationId(session: LobbySession): string | null {
    if (session.navigation_level === "in_conversation") return session.current_conversation_id;
    return null;
  }

  buildNavigationContext(session: LobbySession): NavigationContext {
    return this.deps.commandExecutor.buildNavigationContext(session);
  }
}
