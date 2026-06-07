import path from "path";

/**
 * 统一路径解析层。
 * 消除 15+ 文件中 process.cwd() 的散射调用。
 *
 * 所有配置/数据路径通过此处解析，确保一致性。
 */

/** 服务器启动时的工作目录（进程生命周期内不变）。 */
export const SERVER_ROOT = process.cwd();

/** 配置文件目录。 */
export const CONFIG_DIR = path.join(SERVER_ROOT, "config");

/** 数据目录（SQLite 数据库等）。 */
export const DATA_DIR = path.join(SERVER_ROOT, "data");

/** 平台元数据目录。 */
export const PLATFORM_META = path.join(SERVER_ROOT, ".meta");

/** 日志目录。 */
export const LOG_DIR = path.join(SERVER_ROOT, "logs");

/**
 * 解析配置文件的绝对路径。
 * @param relativePath 相对于 config/ 的路径，如 "llm.json"
 */
export function configPath(relativePath: string): string {
  return path.join(CONFIG_DIR, relativePath);
}

/**
 * 解析数据文件的绝对路径。
 * @param relativePath 相对于 data/ 的路径，如 "snail-shell.db"
 */
export function dataPath(relativePath: string): string {
  return path.join(DATA_DIR, relativePath);
}
