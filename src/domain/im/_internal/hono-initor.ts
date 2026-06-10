import type { FileSystem } from "@infra/file-system";
import { InMemoryIMRepository } from "./repository";
import { IMAdapter, LobbyAwareChannel } from "./adapter";
import { IMHonoServer } from "./hono-server";
import { FeishuTransport } from "./feishu-transport";
import { WecomTransport } from "./wecom-transport";

/** IM Hono 模块配置 */
export interface IMHonoConfig {
  feishu?: {
    enabled: boolean;
    appId: string;
    appSecret: string;
    allowedChats: string[];
  };
  wecom?: {
    enabled: boolean;
    corpId: string;
    corpSecret: string;
    token: string;
    encodingAesKey: string;
    allowedChats: string[];
  };
}

/** 初始化 IM Hono 模块 */
export function initHono(config?: IMHonoConfig) {
  const repo = new InMemoryIMRepository();
  const adapter = new IMAdapter(repo);

  // 创建 Hono 服务器
  const honoServer = new IMHonoServer(adapter);

  // 注册飞书渠道
  if (config?.feishu?.enabled) {
    const feishuTransport = new FeishuTransport({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
    });

    const feishuChannel = new LobbyAwareChannel(
      "feishu",
      feishuTransport,
      config.feishu.allowedChats,
      4000, // maxTextLength
      true, // streamingEnabled
    );

    adapter.registerChannel(feishuChannel);
    repo.registerChannelConfig({
      type: "feishu",
      enabled: true,
      allowed_chats: config.feishu.allowedChats,
      max_text_length: 4000,
      streaming_enabled: true,
    });
  }

  // 注册企微渠道
  if (config?.wecom?.enabled) {
    const wecomTransport = new WecomTransport({
      corpId: config.wecom.corpId,
      corpSecret: config.wecom.corpSecret,
      token: config.wecom.token,
      encodingAesKey: config.wecom.encodingAesKey,
    });

    const wecomChannel = new LobbyAwareChannel(
      "wecom",
      wecomTransport,
      config.wecom.allowedChats,
      4000, // maxTextLength
      false, // streamingEnabled（企微不支持）
    );

    adapter.registerChannel(wecomChannel);
    repo.registerChannelConfig({
      type: "wecom",
      enabled: true,
      allowed_chats: config.wecom.allowedChats,
      max_text_length: 4000,
      streaming_enabled: false,
    });
  }

  return {
    repo,
    adapter,
    honoServer,
    app: honoServer.getApp(),
  };
}
