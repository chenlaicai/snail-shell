/**
 * 配置加载器类型定义
 *
 * 提供统一的配置文件加载功能。
 */

/**
 * 配置加载器接口
 *
 * 负责从文件系统加载配置文件。
 */
export interface ConfigLoader {
  /**
   * 加载配置文件
   * @param path 配置文件路径
   * @returns 配置对象
   */
  load<T>(path: string): Promise<T>;

  /**
   * 监听配置文件变化
   * @param path 配置文件路径
   * @param callback 变化回调
   */
  watch<T>(path: string, callback: (config: T) => void): void;

  /**
   * 停止监听配置文件变化
   * @param path 配置文件路径
   */
  unwatch(path: string): void;

  /**
   * 停止所有监听
   */
  unwatchAll(): void;
}

/**
 * 配置加载器工厂接口
 *
 * 用于创建配置加载器实例。
 */
export interface ConfigLoaderFactory {
  /**
   * 创建配置加载器
   * @param baseDir 基础目录
   * @returns 配置加载器实例
   */
  create(baseDir: string): ConfigLoader;
}
