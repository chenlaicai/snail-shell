import type { LobbySession, LobbyResponse } from "@domain/im/model";
import type { LobbySessionRepository } from "./repository";
import type { LobbyCommandExecutor } from "./command-executor";
import type { LobbyResponseRenderer } from "./response-renderer";
import { parseLobbyCommand } from "./command-parser";

export interface LobbyRouterDeps {
  lobbyRepo: LobbySessionRepository;
  commandExecutor: LobbyCommandExecutor;
  responseRenderer: LobbyResponseRenderer;
  /** 延迟：消息转发到 stage。MessagePort 接入后设置。 */
  forwardMessage?: (stageId: string, text: string) => Promise<{ messageIds: number[] } | null>;
}

export class LobbyRouter {
  constructor(private readonly deps: LobbyRouterDeps) {}

  async processInbound(params: {
    channelType: string;
    channelChatId: string;
    channelTenantKey: string | null;
    text: string;
  }): Promise<
    | { response: LobbyResponse; session: LobbySession }
    | { forwarded: true; session: LobbySession }
  > {
    const { lobbyRepo } = this.deps;
    const session = lobbyRepo.getOrCreate(params.channelType, params.channelChatId, params.channelTenantKey);
    const cmd = parseLobbyCommand(params.text);

    if (session.navigation_level === "in_stage" && session.current_stage_id) {
      return this.handleInStage(session, cmd, params.text);
    }
    return this.handleInLobby(session, cmd, params.text);
  }

  private async handleInStage(
    session: LobbySession,
    cmd: { type: string; argument: string | null },
    text: string,
  ): Promise<
    | { response: LobbyResponse; session: LobbySession }
    | { forwarded: true; session: LobbySession }
  > {
    const { lobbyRepo, commandExecutor, forwardMessage } = this.deps;

    // 在 stage 中仍可执行的命令
    if (cmd.type === "back" || cmd.type === "lobby" || cmd.type === "status" || cmd.type === "help") {
      const response = await commandExecutor.execute(session, text);
      lobbyRepo.addMessage({ lobby_session_id: session.id, direction: "inbound", command: text, content: text, response_content: response.text });
      return { response, session: lobbyRepo.get(session.id)! };
    }

    // 普通消息 → 转发到 stage（延迟）
    lobbyRepo.addMessage({ lobby_session_id: session.id, direction: "inbound", content: text });
    if (forwardMessage) {
      const result = await forwardMessage(session.current_stage_id!, text);
      if (result) return { forwarded: true, session };
    }
    // 转发未就绪时的 fallback
    const fallbackResponse: LobbyResponse = { text: "消息转发功能尚未就绪。当前仅支持斜杠命令。" };
    lobbyRepo.addMessage({ lobby_session_id: session.id, direction: "outbound", content: fallbackResponse.text, response_content: fallbackResponse.text });
    return { response: fallbackResponse, session };
  }

  private async handleInLobby(
    session: LobbySession,
    cmd: { type: string; argument: string | null },
    text: string,
  ): Promise<
    | { response: LobbyResponse; session: LobbySession }
    | { forwarded: true; session: LobbySession }
  > {
    const { lobbyRepo, commandExecutor, responseRenderer } = this.deps;

    // 非斜杠文本在 lobby 中 → 提示
    if (cmd.type === "unknown" && !text.trim().startsWith("/")) {
      const response = responseRenderer.renderNonCommandInLobby();
      lobbyRepo.addMessage({ lobby_session_id: session.id, direction: "inbound", content: text, response_content: response.text });
      return { response, session };
    }

    const response = await commandExecutor.execute(session, text);
    lobbyRepo.addMessage({ lobby_session_id: session.id, direction: "inbound", command: text, content: text, response_content: response.text });
    return { response, session: lobbyRepo.get(session.id)! };
  }
}
