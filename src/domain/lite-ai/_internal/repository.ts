import fs from "fs";
import path from "path";
import type { LlmConfig } from "@domain/lite-ai/model";
import type { FileSystem } from "@infra/file-system";

/** Lite AI 持久层接口 */
export interface LiteAIRepository {
  getConfig(): LlmConfig | null;
}

/** Lite AI 文件存储实现 */
export class FileLiteAIRepository implements LiteAIRepository {
  private config: LlmConfig | null = null;

  constructor(private fileSystem: FileSystem, repoRoot: string) {
    this.loadConfig(repoRoot);
  }

  getConfig(): LlmConfig | null {
    return this.config;
  }

  private loadConfig(repoRoot: string): void {
    const configPath = path.join(repoRoot, "config", "llm.json");
    const raw = this.fileSystem.readJson<LlmConfig>(configPath);

    if (raw && raw.provider === "openai" && raw.openai?.api_key) {
      this.config = raw;
    }
  }
}
