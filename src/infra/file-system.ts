import fs from "fs";
import path from "path";

/**
 * 文件系统基础设施。
 * 提供通用的文件读写能力，不包含业务逻辑。
 */
export class FileSystem {
  /** 读取文件内容，不存在返回 null */
  readFile(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  }

  /** 读取 JSON 文件，解析失败返回 null */
  readJson<T>(filePath: string): T | null {
    const raw = this.readFile(filePath);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** 写入文件，自动创建目录 */
  writeFile(filePath: string, content: string): void {
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf8");
  }

  /** 写入 JSON 文件 */
  writeJson<T>(filePath: string, data: T): void {
    this.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
  }

  /** 列出目录下的文件 */
  listDir(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath);
  }

  /** 列出目录下的子目录 */
  listDirs(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  /** 检查文件是否存在 */
  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /** 确保目录存在 */
  ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /** 删除文件 */
  deleteFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /** 删除目录 */
  deleteDir(dirPath: string): void {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }
}
