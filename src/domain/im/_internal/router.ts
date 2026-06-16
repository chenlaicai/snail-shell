import type { LobbyInboundResult } from "@domain/im/port";
import type { ChannelType, LobbySession } from "@domain/im/model";
import type { LobbySessionRepository } from "@domain/im/_internal/repository";
import type { LobbyCommandExecutor } from "@domain/im/_internal/command-executor";
import type { LobbyResponseRenderer } from "@domain/im/_internal/response-renderer";
import { parseLobbyCommand } from "@domain/im/_internal/command-parser";

export interface LobbyRouterDeps {
  lobbyRepo: LobbySessionRepository;
  commandExecutor: LobbyCommandExecutor;
  responseRenderer: LobbyResponseRenderer;
}

export class LobbyRouter {
  constructor(private readonly deps: LobbyRouterDeps) {}

  async processInbound(params: {
    channelType: ChannelType;
    channelChatId: string;
    channelTenantKey: string | null;
    text: string;
  }): Promise<LobbyInboundResult> {
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
  ): Promise<LobbyInboundResult> {
    const { lobbyRepo, commandExecutor } = this.deps;

    // 在 stage 中仍可执行的命令
    if (cmd.type === "back" || cmd.type === "lobby" || cmd.type === "status" || cmd.type === "help") {
      const response = await commandExecutor.execute(session, text);
      lobbyRepo.addMessage({ lobby_session_id: session.id, direction: "inbound", command: text, content: text, response_content: response.text });
      return { response, session: lobbyRepo.get(session.id)! };
    }

    lobbyRepo.addMessage({ lobby_session_id: session.id, direction: "inbound", content: text });
    return { forwarded: true, session, stageId: session.current_stage_id!, text };
  }

  private async handleInLobby(
    session: LobbySession,
    cmd: { type: string; argument: string | null },
    text: string,
  ): Promise<LobbyInboundResult> {
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
