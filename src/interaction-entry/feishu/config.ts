import fs from "fs";
import path from "path";

export interface FeishuConversationBindingConfig {
  tenant_key?: string;
  chat_id: string;
  conversation_id: string;
}

export interface FeishuLobbyBindingConfig {
  tenant_key?: string;
  chat_id: string;
}

export interface FeishuConfig {
  enabled: boolean;
  app_id_env: string;
  app_secret_env: string;
  bindings: FeishuConversationBindingConfig[];
  lobby_enabled: boolean;
  lobby_bindings: FeishuLobbyBindingConfig[];
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
  lobby_enabled: false,
  lobby_bindings: [],
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
    lobby_enabled: Boolean(parsed.lobby_enabled),
    lobby_bindings: Array.isArray(parsed.lobby_bindings) ? parsed.lobby_bindings.filter(isLobbyBindingConfig) : [],
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

function isLobbyBindingConfig(value: unknown): value is FeishuLobbyBindingConfig {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as FeishuLobbyBindingConfig).chat_id === "string"
    && Boolean((value as FeishuLobbyBindingConfig).chat_id.trim());
}
