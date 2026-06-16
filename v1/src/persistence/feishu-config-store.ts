/**
 * FeishuConfigStore — 从 config/feishu.json 加载飞书配置。
 *
 * Why: 原先 interaction-entry/feishu/config.ts 直接读取文件，违反持久化层统一入口原则。
 * 提取为独立 Store 后，所有配置文件读写都经过 persistence 层。
 */
import fs from "fs";
import path from "path";

/** 飞书群聊白名单配置类型定义——从 interaction-entry/feishu/config.ts 迁移。 */
export interface FeishuAllowedChatConfig {
  tenant_key?: string;
  chat_id: string;
}

/** 飞书配置类型定义——从 interaction-entry/feishu/config.ts 迁移。 */
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
  message_push: {
    max_text_length: 4000,
  },
};

export class FeishuConfigStore {
  private readonly configPath: string;
  private cachedConfig: FeishuConfig | null = null;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, "feishu.json");
  }

  /**
   * 获取飞书配置。
   * 配置文件不存在时返回默认配置（enabled: false）。
   */
  getConfig(): FeishuConfig {
    if (this.cachedConfig) return this.cachedConfig;

    if (!fs.existsSync(this.configPath)) {
      this.cachedConfig = { ...DEFAULT_CONFIG };
      return this.cachedConfig;
    }

    const parsed = JSON.parse(fs.readFileSync(this.configPath, "utf8")) as Partial<FeishuConfig>;
    this.cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      allowed_chats: Array.isArray(parsed.allowed_chats) ? parsed.allowed_chats.filter(isAllowedChatConfig) : [],
      message_push: {
        ...DEFAULT_CONFIG.message_push,
        ...(parsed.message_push ?? {}),
      },
    };
    return this.cachedConfig;
  }
}

function isAllowedChatConfig(value: unknown): value is FeishuAllowedChatConfig {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as FeishuAllowedChatConfig).chat_id === "string"
    && Boolean((value as FeishuAllowedChatConfig).chat_id.trim());
}
