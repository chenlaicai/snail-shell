import { JsonConfigStore } from "./json-config-store";

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
  message_push: { max_text_length: 4000 },
};

function parseWecomConfig(raw: string): WecomConfig {
  const parsed = JSON.parse(raw) as Partial<WecomConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    allowed_chats: Array.isArray(parsed.allowed_chats)
      ? parsed.allowed_chats.filter((v): v is WecomAllowedChatConfig =>
          Boolean(v) && typeof v === "object" && !Array.isArray(v) && typeof (v as WecomAllowedChatConfig).chat_id === "string" && Boolean((v as WecomAllowedChatConfig).chat_id.trim()))
      : [],
    message_push: { ...DEFAULT_CONFIG.message_push, ...(parsed.message_push ?? {}) },
  };
}

export class WecomConfigStore {
  private readonly store: JsonConfigStore<WecomConfig>;

  constructor(configDir: string) {
    this.store = new JsonConfigStore(configDir, "wecom.json", { ...DEFAULT_CONFIG }, parseWecomConfig);
  }

  getConfig(): WecomConfig {
    return this.store.get();
  }
}
