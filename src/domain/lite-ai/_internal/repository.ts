import type { LiteAIConfig } from "@domain/lite-ai/model";
import type { FileDataStore } from "@infra/file-data-store";

/** Lite AI 持久层接口 */
export interface LiteAIRepository {
  getConfig(): LiteAIConfig | null;
}

/** Lite AI 文件存储实现 */
export class FileLiteAIRepository implements LiteAIRepository {
  private static readonly FILE = "lite-ai.json";

  private config: LiteAIConfig | null = null;

  constructor(private dataStore: FileDataStore) {
    this.loadConfig();
  }

  getConfig(): LiteAIConfig | null {
    return this.config;
  }

  private loadConfig(): void {
    const raw = this.dataStore.readJson<LiteAIConfig>(FileLiteAIRepository.FILE);

    if (raw && raw.provider === "openai" && raw.openai?.api_key) {
      this.config = raw;
    }
  }
}
