/**
 * LlmConfigStore — 从 config/llm.json 加载 LLM 配置。
 *
 * Why: 原先 llm/config.ts 直接读取文件，违反持久化层统一入口原则。
 * 提取为独立 Store 后，所有配置文件读写都经过 persistence 层。
 */
import fs from "fs";
import path from "path";

/** LLM 配置类型定义——从 llm/config.ts 迁移。 */
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
  private readonly configPath: string;
  private cachedConfig: LlmConfig | null = null;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, "llm.json");
  }

  /**
   * 获取 LLM 配置。
   * 文件缺失 → 抛错（llm.json 是必需配置）。
   */
  getConfig(): LlmConfig {
    if (this.cachedConfig) return this.cachedConfig;

    if (!fs.existsSync(this.configPath)) {
      throw new Error("Missing config/llm.json. Create it from config/llm.json.example before starting the server.");
    }
    const raw = fs.readFileSync(this.configPath, "utf8");
    this.cachedConfig = JSON.parse(raw) as LlmConfig;
    return this.cachedConfig;
  }
}
