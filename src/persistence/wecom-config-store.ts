import fs from "fs";
import path from "path";

export interface WecomAllowedChatConfig {
  tenant_key?: string;
  chat_id: string;
}

export interface WecomConfig {
  enabled: boolean;
  corp_id: string;
  corp_secret: string;
  token: string;
  encoding_aes_key: string;
  allowed_chats: WecomAllowedChatConfig[];
  message_push: {
    max_text_length: number;
  };
}

const DEFAULT_CONFIG: WecomConfig = {
  enabled: false,
  corp_id: "",
  corp_secret: "",
  token: "",
  encoding_aes_key: "",
  allowed_chats: [],
  message_push: {
    max_text_length: 4000,
  },
};

export class WecomConfigStore {
  private readonly configPath: string;
  private cachedConfig: WecomConfig | null = null;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, "wecom.json");
  }

  getConfig(): WecomConfig {
    if (this.cachedConfig) return this.cachedConfig;

    if (!fs.existsSync(this.configPath)) {
      this.cachedConfig = { ...DEFAULT_CONFIG };
      return this.cachedConfig;
    }

    const parsed = JSON.parse(fs.readFileSync(this.configPath, "utf8")) as Partial<WecomConfig>;
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

function isAllowedChatConfig(value: unknown): value is WecomAllowedChatConfig {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as WecomAllowedChatConfig).chat_id === "string"
    && Boolean((value as WecomAllowedChatConfig).chat_id.trim());
}
