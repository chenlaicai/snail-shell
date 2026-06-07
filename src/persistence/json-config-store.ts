import fs from "fs";
import path from "path";

/**
 * 泛型 JSON 配置文件加载器。
 * 消除 config store 中重复的 构造-缓存-读取 模式。
 *
 * @param defaultValue 文件缺失时的默认值。为 null 时 ENOENT 抛错。
 * @param parse JSON 解析 + 后处理（字段校验、默认值合并等）。
 */
export class JsonConfigStore<T> {
  private readonly configPath: string;
  private cached: T | null = null;

  constructor(
    configDir: string,
    fileName: string,
    private readonly defaultValue: T | null,
    private readonly parse: (raw: string) => T,
  ) {
    this.configPath = path.join(configDir, fileName);
  }

  get(): T {
    if (this.cached) return this.cached;
    let raw: string;
    try {
      raw = fs.readFileSync(this.configPath, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        if (this.defaultValue === null) {
          throw new Error(`Missing required config: ${this.configPath}`, { cause: err });
        }
        this.cached = this.defaultValue;
        return this.cached;
      }
      throw new Error(`Failed to load ${this.configPath}: ${(err as Error).message}`, { cause: err });
    }
    this.cached = this.parse(raw);
    return this.cached;
  }
}
