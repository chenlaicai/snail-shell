import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

/**
 * 文件加载器基础设施。
 *
 * 通用的相对路径文件读取工具，替代旧的 FileSystem。
 * 所有操作基于 baseDir 解析相对路径。
 *
 * 用法：
 *   const loader = new FileLoader("/repo/root");
 *   loader.readFile("docs/features/F2026061001.md");  // → /repo/root/docs/features/F2026061001.md
 *   loader.readJson("config/workspaces.json");      // → /repo/root/config/workspaces.json
 *   loader.listDir("docs/features");                // → 列出 /repo/root/docs/features/
 */
export class FileLoader {
  constructor(protected readonly baseDir: string) {}

  /** 读取文件内容，不存在返回 null */
  readFile(relativePath: string): string | null {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, "utf8");
  }

  /** 读取 JSON 文件，解析失败返回 null */
  readJson<T>(relativePath: string): T | null {
    const raw = this.readFile(relativePath);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** 读取 YAML 文件，解析失败返回 null */
  readYaml<T>(relativePath: string): T | null {
    const raw = this.readFile(relativePath);
    if (!raw) return null;
    try {
      return parseYaml(raw) as T;
    } catch {
      return null;
    }
  }

  /** 列出目录下的文件名（不含子目录） */
  listDir(relativePath: string): string[] {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath, { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => e.name);
  }

  /** 列出目录下的子目录名 */
  listDirs(relativePath: string): string[] {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  /** 检查文件或目录是否存在 */
  exists(relativePath: string): boolean {
    return fs.existsSync(this.resolve(relativePath));
  }

  /** 写入文件，自动创建父目录 */
  writeFile(relativePath: string, content: string): void {
    const fullPath = this.resolve(relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf8");
  }

  /** 写入 JSON 文件 */
  writeJson<T>(relativePath: string, data: T): void {
    this.writeFile(relativePath, JSON.stringify(data, null, 2) + "\n");
  }

  /** 删除文件 */
  deleteFile(relativePath: string): void {
    const fullPath = this.resolve(relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  /** 删除目录（递归） */
  deleteDir(relativePath: string): void {
    const fullPath = this.resolve(relativePath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  /** 确保目录存在 */
  ensureDir(relativePath: string): void {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  /** 将相对路径解析为绝对路径，校验不逃逸 baseDir */
  protected resolve(relativePath: string): string {
    const resolved = path.join(this.baseDir, relativePath);
    if (!resolved.startsWith(this.baseDir + path.sep) && resolved !== this.baseDir) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    return resolved;
  }
}
