import type { WorkspacePort } from "@domain/workspace/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { ConfigStore } from "@infra/config-store";
import { InMemoryIMRepository, InMemoryLobbyRepository } from "./repository";
import { IMAdapter, LobbyAwareChannel } from "./adapter";
import { IMHonoServer } from "./hono-server";
import { FeishuTransport } from "./feishu-transport";
import { WecomTransport } from "./wecom-transport";
import { PlainTextLobbyRenderer } from "./response-renderer";
import { LobbyCommandExecutor } from "./command-executor";
import { LobbyRouter } from "./router";
import { LobbyAdapter } from "./lobby-adapter";

interface FeishuYamlConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  allowedChats: string[];
}

interface WecomYamlConfig {
  enabled: boolean;
  corpId: string;
  corpSecret: string;
  token: string;
  encodingAesKey: string;
  allowedChats: string[];
}

/** IM Hono 模块依赖 */
export interface IMHonoDeps {
  workspacePort: WorkspacePort;
  issuePort: IssuePort;
  stagePort: StagePort;
  configStore: ConfigStore;
}

/** 初始化 IM Hono 模块 */
export function initHono(deps: IMHonoDeps) {
  const feishuConfig = deps.configStore.readYaml<FeishuYamlConfig>("feishu.yaml");
  const wecomConfig = deps.configStore.readYaml<WecomYamlConfig>("wecom.yaml");
  // 仓库
  const repo = new InMemoryIMRepository();
  const lobbyRepo = new InMemoryLobbyRepository();

  // Lobby 组件
  const renderer = new PlainTextLobbyRenderer();
  const commandExecutor = new LobbyCommandExecutor(
    deps.workspacePort,
    deps.issuePort,
    deps.stagePort,
    lobbyRepo,
    renderer,
  );
  const lobbyRouter = new LobbyRouter({ lobbyRepo, commandExecutor, responseRenderer: renderer });
  const lobbyAdapter = new LobbyAdapter(lobbyRepo, commandExecutor, lobbyRouter);

  // IM 适配器
  const adapter = new IMAdapter(repo);

  // 渠道注册
  if (feishuConfig?.enabled) {
    const feishuTransport = new FeishuTransport({
      appId: feishuConfig.appId,
      appSecret: feishuConfig.appSecret,
    });

    const feishuChannel = new LobbyAwareChannel(
      {
        channelType: "feishu",
        allowedChats: feishuConfig.allowedChats,
        maxTextLength: 4000,
        streamingEnabled: true,
      },
      feishuTransport,
      lobbyRouter,
    );

    adapter.registerChannel(feishuChannel);
    repo.registerChannelConfig({
      type: "feishu",
      enabled: true,
      allowed_chats: feishuConfig.allowedChats,
      max_text_length: 4000,
      streaming_enabled: true,
    });
  }

  if (wecomConfig?.enabled) {
    const wecomTransport = new WecomTransport({
      corpId: wecomConfig.corpId,
      corpSecret: wecomConfig.corpSecret,
      token: wecomConfig.token,
      encodingAesKey: wecomConfig.encodingAesKey,
    });

    const wecomChannel = new LobbyAwareChannel(
      {
        channelType: "wecom",
        allowedChats: wecomConfig.allowedChats,
        maxTextLength: 4000,
        streamingEnabled: false,
      },
      wecomTransport,
      lobbyRouter,
    );

    adapter.registerChannel(wecomChannel);
    repo.registerChannelConfig({
      type: "wecom",
      enabled: true,
      allowed_chats: wecomConfig.allowedChats,
      max_text_length: 4000,
      streaming_enabled: false,
    });
  }

  // Hono 服务
  const honoServer = new IMHonoServer(adapter);

  return { repo, lobbyRepo, adapter, lobbyAdapter, honoServer, app: honoServer.getApp() };
}
