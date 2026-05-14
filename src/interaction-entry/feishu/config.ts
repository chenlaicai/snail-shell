import fs from "fs";
import path from "path";

export interface FeishuConversationBindingConfig {
  tenant_key?: string;
  chat_id: string;
  conversation_id: string;
}

export interface FeishuConfig {
  enabled: boolean;
  app_id_env: string;
  app_secret_env: string;
  bindings: FeishuConversationBindingConfig[];
  message_push: {
    max_text_length: number;
    include_user_messages: boolean;
  };
}

const DEFAULT_CONFIG: FeishuConfig = {
  enabled: false,
  app_id_env: "FEISHU_APP_ID",
  app_secret_env: "FEISHU_APP_SECRET",
  bindings: [],
  message_push: {
    max_text_length: 4000,
    include_user_messages: false,
  },
};

export function loadFeishuConfig(filePath = path.join(process.cwd(), "config", "feishu.json")): FeishuConfig {
  if (!fs.existsSync(filePath)) return DEFAULT_CONFIG;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FeishuConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    bindings: Array.isArray(parsed.bindings) ? parsed.bindings.filter(isBindingConfig) : [],
    message_push: {
      ...DEFAULT_CONFIG.message_push,
      ...(parsed.message_push ?? {}),
    },
  };
}

function isBindingConfig(value: unknown): value is FeishuConversationBindingConfig {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as FeishuConversationBindingConfig).chat_id === "string"
    && Boolean((value as FeishuConversationBindingConfig).chat_id.trim())
    && typeof (value as FeishuConversationBindingConfig).conversation_id === "string"
    && Boolean((value as FeishuConversationBindingConfig).conversation_id.trim());
}
