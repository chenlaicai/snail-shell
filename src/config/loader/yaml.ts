/**
 * YAML 配置加载器实现
 *
 * 基于 yaml 包实现 YAML 配置文件加载。
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import type { ConfigLoader, ConfigLoaderFactory } from "./types";

/**
 * YAML 配置加载器
 */
export class YamlConfigLoader implements ConfigLoader {
  private watchers: Map<string, fs.FSWatcher> = new Map();

  constructor(private baseDir: string) {}

  async load<T>(filePath: string): Promise<T> {
    const fullPath = this.resolvePath(filePath);

    try {
      const content = await fs.promises.readFile(fullPath, "utf-8");
      return yaml.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Config file not found: ${fullPath}`);
      }
      throw new Error(`Failed to load config file ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  watch<T>(filePath: string, callback: (config: T) => void): void {
    const fullPath = this.resolvePath(filePath);

    // 如果已经监听，先停止
    this.unwatch(filePath);

    try {
      const watcher = fs.watch(fullPath, async (eventType) => {
        if (eventType === "change") {
          try {
            const config = await this.load<T>(filePath);
            callback(config);
          } catch (error) {
            console.error(`Failed to reload config file ${fullPath}:`, error);
          }
        }
      });

      this.watchers.set(filePath, watcher);
    } catch (error) {
      console.error(`Failed to watch config file ${fullPath}:`, error);
    }
  }

  unwatch(filePath: string): void {
    const watcher = this.watchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(filePath);
    }
  }

  unwatchAll(): void {
    for (const [filePath, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(this.baseDir, filePath);
  }
}

/**
 * YAML 配置加载器工厂
 */
export class YamlConfigLoaderFactory implements ConfigLoaderFactory {
  create(baseDir: string): ConfigLoader {
    return new YamlConfigLoader(baseDir);
  }
}
