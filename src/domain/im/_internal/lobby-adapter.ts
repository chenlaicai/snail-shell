import type { LobbyInboundResult, LobbyPort } from "@domain/im/port";
import type { ChannelType, LobbySession, LobbyMessage, LobbyResponse, NavigationContext } from "@domain/im/model";
import type { LobbySessionRepository } from "./repository";
import type { LobbyCommandExecutor } from "./command-executor";
import type { LobbyRouter } from "./router";

export class LobbyAdapter implements LobbyPort {
  constructor(
    private readonly lobbyRepo: LobbySessionRepository,
    private readonly commandExecutor: LobbyCommandExecutor,
    private readonly lobbyRouter: LobbyRouter,
  ) {}

  // --- Session ---

  getOrCreateSession(channelType: ChannelType, channelChatId: string, channelTenantKey: string | null): LobbySession {
    return this.lobbyRepo.getOrCreate(channelType, channelChatId, channelTenantKey);
  }

  getSessionByChannel(channelType: ChannelType, channelChatId: string, channelTenantKey: string | null): LobbySession | null {
    return this.lobbyRepo.getByChannel(channelType, channelChatId, channelTenantKey);
  }

  updateSessionNavigation(id: string, updates: Partial<Pick<LobbySession, "navigation_level" | "current_workspace_id" | "current_issue_id" | "current_stage_id">>): LobbySession {
    return this.lobbyRepo.updateNavigation(id, updates);
  }

  getInStageSessions(channelType: ChannelType): LobbySession[] {
    return this.lobbyRepo.getInStageSessions(channelType);
  }

  // --- Message audit ---

  addLobbyMessage(input: { lobby_session_id: string; direction: "inbound" | "outbound"; command?: string | null; content: string; response_content?: string | null }): LobbyMessage {
    return this.lobbyRepo.addMessage(input);
  }

  getLobbyMessages(sessionId: string, limit?: number, offset?: number): LobbyMessage[] {
    return this.lobbyRepo.getMessages(sessionId, limit, offset);
  }

  // --- Command execution ---

  async executeCommand(session: LobbySession, commandText: string): Promise<LobbyResponse> {
    return this.commandExecutor.execute(session, commandText);
  }

  // --- Routing ---

  async processInbound(params: { channelType: ChannelType; channelChatId: string; channelTenantKey: string | null; text: string }): Promise<LobbyInboundResult> {
    return this.lobbyRouter.processInbound(params);
  }

  // --- Navigation context ---

  buildNavigationContext(session: LobbySession): NavigationContext {
    return this.commandExecutor.buildNavigationContext(session);
  }
}
