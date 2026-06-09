import fs from "fs";
import path from "path";

// WecomConfig 类型已迁移到 config 模块，暂时内联定义
export interface WecomConfig {
  enabled: boolean;
  corp_id: string;
  corp_secret: string;
  token: string;
  encoding_aes_key: string;
  message_push: {
    max_text_length: number;
    streaming?: { enabled: boolean; flush_interval_ms?: number };
  };
  allowed_chats: Array<{ chat_id: string; chat_name?: string }>;
}

const DEFAULT_CONFIG: WecomConfig = {
  enabled: false,
  corp_id: "",
  corp_secret: "",
  token: "",
  encoding_aes_key: "",
  message_push: { max_text_length: 4000 },
  allowed_chats: [],
};

/** 从 config/wecom.json 加载企业微信配置，配置文件不存在时返回默认配置（enabled: false）。 */
export function loadWecomConfig(configDir = path.join(process.cwd(), "config")): WecomConfig {
  const filePath = path.join(configDir, "wecom.json");
  if (!fs.existsSync(filePath)) return DEFAULT_CONFIG;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<WecomConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    message_push: { ...DEFAULT_CONFIG.message_push, ...(parsed.message_push ?? {}) },
  };
}
