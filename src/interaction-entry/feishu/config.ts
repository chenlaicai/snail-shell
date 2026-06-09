import fs from "fs";
import path from "path";

// FeishuConfig 和 FeishuAllowedChatConfig 类型已迁移到 config 模块，暂时内联定义
export interface FeishuAllowedChatConfig {
  chat_id: string;
  chat_name?: string;
}

export interface FeishuConfig {
  enabled: boolean;
  app_id: string;
  app_secret: string;
  message_push: {
    max_text_length: number;
    streaming?: { enabled: boolean; flush_interval_ms?: number };
  };
  allowed_chats: FeishuAllowedChatConfig[];
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
