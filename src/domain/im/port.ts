import type {
  IMChannelConfig,
  IMInboundMessage,
  LobbySession,
  LobbyMessage,
  LobbyResponse,
  NavigationContext,
} from "./model";

/** IM 端口定义 */
export interface IMPort {
  // IM 渠道配置
  listChannelConfigs(): IMChannelConfig[];
  getChannelConfig(type: string): IMChannelConfig | undefined;
}

/** IM 渠道传输层接口 */
export interface IMTransport {
  /** 准备连接 */
  prepare(): Promise<void>;
  /** 停止连接 */
  stop(): Promise<void>;
  /** 监听入站消息 */
  onMessage(handler: (msg: IMInboundMessage) => void): void;
  /** 发送文本消息，返回 message_id */
  sendText(chatId: string, text: string, uuid?: string): Promise<string>;
  /** 更新文本消息（流式响应） */
  patchText?(messageId: string, text: string): Promise<void>;
  /** 处理 webhook 请求体（平台特定解析） */
  handleWebhook?(body: unknown): void;
}

/** IM 渠道适配器接口 */
export interface IMChannelAdapter {
  readonly channelType: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** 处理 webhook 请求体（由 Hono server 调用） */
  handleWebhook?(body: unknown): void;
}

/** Lobby 端口定义 */
export interface LobbyPort {
  // Session
  getOrCreateSession(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession;
  getSessionByChannel(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession | null;
  updateSessionNavigation(id: string, updates: Partial<Pick<LobbySession, "navigation_level" | "current_workspace_id" | "current_issue_id" | "current_stage_id">>): LobbySession;
  getInStageSessions(channelType: string): LobbySession[];

  // Message audit
  addLobbyMessage(input: { lobby_session_id: string; direction: "inbound" | "outbound"; command?: string | null; content: string; response_content?: string | null }): LobbyMessage;
  getLobbyMessages(sessionId: string, limit?: number, offset?: number): LobbyMessage[];

  // Command execution
  executeCommand(session: LobbySession, commandText: string): Promise<LobbyResponse>;

  // Routing
  processInbound(params: { channelType: string; channelChatId: string; channelTenantKey: string | null; text: string }): Promise<
    | { response: LobbyResponse; session: LobbySession }
    | { forwarded: true; session: LobbySession }
  >;

  // Navigation context
  buildNavigationContext(session: LobbySession): NavigationContext;
}
