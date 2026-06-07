/**
 * LlmConfigStore — 从 config/llm.json 加载 LLM 配置。
 * 文件缺失时抛错（llm.json 是必需配置）。
 */
import { JsonConfigStore } from "./json-config-store";

export interface LlmConfig {
  provider: "openai";
  openai: {
    api_key: string;
    model: string;
    base_url: string;
    timeout_ms: number;
  };
}

export class LlmConfigStore {
  private readonly store: JsonConfigStore<LlmConfig>;

  constructor(configDir: string) {
    this.store = new JsonConfigStore(configDir, "llm.json", null, JSON.parse);
  }

  getConfig(): LlmConfig {
    return this.store.get();
  }
}
