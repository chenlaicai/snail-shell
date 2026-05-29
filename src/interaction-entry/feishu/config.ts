import fs from "fs";
import path from "path";

export interface FeishuAllowedChatConfig {
  tenant_key?: string;
  chat_id: string;
}

export interface FeishuConfig {
  enabled: boolean;
  app_id_env: string;
  app_secret_env: string;
  allowed_chats: FeishuAllowedChatConfig[];
  message_push: {
    max_text_length: number;
  };
}

const DEFAULT_CONFIG: FeishuConfig = {
  enabled: false,
  app_id_env: "FEISHU_APP_ID",
  app_secret_env: "FEISHU_APP_SECRET",
  allowed_chats: [],
  message_push: {
    max_text_length: 4000,
  },
};

export function loadFeishuConfig(filePath = path.join(process.cwd(), "config", "feishu.json")): FeishuConfig {
  if (!fs.existsSync(filePath)) return DEFAULT_CONFIG;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FeishuConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    allowed_chats: Array.isArray(parsed.allowed_chats) ? parsed.allowed_chats.filter(isAllowedChatConfig) : [],
    message_push: {
      ...DEFAULT_CONFIG.message_push,
      ...(parsed.message_push ?? {}),
    },
  };
}

function isAllowedChatConfig(value: unknown): value is FeishuAllowedChatConfig {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as FeishuAllowedChatConfig).chat_id === "string"
    && Boolean((value as FeishuAllowedChatConfig).chat_id.trim());
}
