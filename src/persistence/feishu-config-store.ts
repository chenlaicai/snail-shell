/**
 * FeishuConfigStore — 从 config/feishu.json 加载飞书配置。
 * 配置文件不存在时返回默认配置（enabled: false）。
 */
import { JsonConfigStore } from "./json-config-store";

export interface FeishuAllowedChatConfig {
  tenant_key?: string;
  chat_id: string;
}

export interface FeishuConfig {
  enabled: boolean;
  app_id: string;
  app_secret: string;
  allowed_chats: FeishuAllowedChatConfig[];
  message_push: {
    max_text_length: number;
    streaming?: {
      enabled?: boolean;
      flush_interval_ms?: number;
    };
  };
}

const DEFAULT_CONFIG: FeishuConfig = {
  enabled: false,
  app_id: "",
  app_secret: "",
  allowed_chats: [],
  message_push: { max_text_length: 4000 },
};

function parseFeishuConfig(raw: string): FeishuConfig {
  const parsed = JSON.parse(raw) as Partial<FeishuConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    allowed_chats: Array.isArray(parsed.allowed_chats)
      ? parsed.allowed_chats.filter((v): v is FeishuAllowedChatConfig =>
          Boolean(v) && typeof v === "object" && !Array.isArray(v) && typeof (v as FeishuAllowedChatConfig).chat_id === "string" && Boolean((v as FeishuAllowedChatConfig).chat_id.trim()))
      : [],
    message_push: { ...DEFAULT_CONFIG.message_push, ...(parsed.message_push ?? {}) },
  };
}

export class FeishuConfigStore {
  private readonly store: JsonConfigStore<FeishuConfig>;

  constructor(configDir: string) {
    this.store = new JsonConfigStore(configDir, "feishu.json", { ...DEFAULT_CONFIG }, parseFeishuConfig);
  }

  getConfig(): FeishuConfig {
    return this.store.get();
  }
}
