import path from "path";
import { FileLoader } from "@infra/file-loader";

/**
 * 系统配置存储。
 *
 * 基于 FileLoader 的配置文件读取层。
 * 目录结构由 infra 层管理：config/
 * 调方只需传入 repoRoot，不需要知道配置目录在哪。
 *
 * 用法：
 *   const config = new ConfigStore(repoRoot);
 *   config.readYaml("feishu.yaml");      // 读 config/feishu.yaml
 *   config.readYaml("server.yaml");      // 读 config/server.yaml
 */
export class ConfigStore extends FileLoader {
  constructor(repoRoot: string) {
    super(path.join(repoRoot, "config"));
  }
}
