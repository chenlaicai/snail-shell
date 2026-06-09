/**
 * Config 模块
 *
 * 提供统一的配置管理功能。
 *
 * 架构说明：
 * - loader: 配置文件加载器
 * - validator: 配置校验器
 * - schema: Schema 定义
 * - paths: 平台路径常量
 * - types: 配置类型定义
 *
 * 依赖倒置：
 * - 原子模块通过 ConfigLoader 加载配置
 * - 原子模块通过 ConfigValidator 校验配置
 * - config 模块提供统一的配置管理入口
 */

// ═══ 配置加载器 ═══
export type { ConfigLoader, ConfigLoaderFactory } from "./loader/types";

export { JsonConfigLoader, JsonConfigLoaderFactory, YamlConfigLoader, YamlConfigLoaderFactory } from "./loader";

// ═══ 配置校验器 ═══
export type { ConfigValidator, ConfigValidatorFactory, ValidationResult } from "./validator/types";

export { ZodConfigValidator, ZodConfigValidatorFactory } from "./validator";

// ═══ Schema 定义 ═══
export type { FieldType, FieldDefinition, SchemaDefinition } from "./schema/types";

// ═══ 配置类型 ═══
export type { EvolutionConfig, SnailWorkspaceConfig } from "./types";

// ═══ 平台路径 ═══
export { PLATFORM_ROOT, PLATFORM_META } from "./paths";

// ═══ 配置管理器 ═══

import * as path from "path";
import { JsonConfigLoader } from "./loader/json";
import { YamlConfigLoader } from "./loader/yaml";
import { ZodConfigValidator } from "./validator/zod";
import type { ConfigLoader } from "./loader/types";
import type { ConfigValidator } from "./validator/types";
import type { ValidationResult } from "./validator/types";

/**
 * 配置管理器配置
 */
export interface ConfigManagerConfig {
  /** 配置文件基础目录 */
  configDir: string;
  /** Schema 文件目录 */
  schemaDir?: string;
  /** 是否启用配置校验 */
  enableValidation?: boolean;
}

/**
 * 配置管理器
 *
 * 提供统一的配置管理功能。
 */
export class ConfigManager {
  private jsonLoader: ConfigLoader;
  private yamlLoader: ConfigLoader;
  private validator: ConfigValidator | null = null;
  private enableValidation: boolean;

  constructor(config: ConfigManagerConfig) {
    this.jsonLoader = new JsonConfigLoader(config.configDir);
    this.yamlLoader = new YamlConfigLoader(config.configDir);
    this.enableValidation = config.enableValidation ?? false;

    if (config.schemaDir) {
      this.validator = new ZodConfigValidator(config.schemaDir);
    }
  }

  /**
   * 加载 JSON 配置文件
   * @param filePath 配置文件路径
   * @returns 配置对象
   */
  async loadJson<T>(filePath: string): Promise<T> {
    return this.jsonLoader.load<T>(filePath);
  }

  /**
   * 加载 YAML 配置文件
   * @param filePath 配置文件路径
   * @returns 配置对象
   */
  async loadYaml<T>(filePath: string): Promise<T> {
    return this.yamlLoader.load<T>(filePath);
  }

  /**
   * 校验配置对象
   * @param config 配置对象
   * @param schemaPath Schema 文件路径
   * @returns 校验结果
   */
  async validate<T>(config: T, schemaPath: string): Promise<ValidationResult> {
    if (!this.validator) {
      return {
        valid: true,
        errors: [],
        warnings: ["Validation not enabled"],
      };
    }

    return this.validator.validate(config, schemaPath);
  }

  /**
   * 加载并校验 JSON 配置文件
   * @param filePath 配置文件路径
   * @param schemaPath Schema 文件路径
   * @returns 配置对象和校验结果
   */
  async loadAndValidateJson<T>(filePath: string, schemaPath?: string): Promise<{ config: T; validation: ValidationResult }> {
    const config = await this.loadJson<T>(filePath);

    if (!schemaPath || !this.enableValidation) {
      return {
        config,
        validation: { valid: true, errors: [], warnings: [] },
      };
    }

    const validation = await this.validate(config, schemaPath);
    return { config, validation };
  }

  /**
   * 加载并校验 YAML 配置文件
   * @param filePath 配置文件路径
   * @param schemaPath Schema 文件路径
   * @returns 配置对象和校验结果
   */
  async loadAndValidateYaml<T>(filePath: string, schemaPath?: string): Promise<{ config: T; validation: ValidationResult }> {
    const config = await this.loadYaml<T>(filePath);

    if (!schemaPath || !this.enableValidation) {
      return {
        config,
        validation: { valid: true, errors: [], warnings: [] },
      };
    }

    const validation = await this.validate(config, schemaPath);
    return { config, validation };
  }

  /**
   * 监听 JSON 配置文件变化
   * @param filePath 配置文件路径
   * @param callback 变化回调
   */
  watchJson<T>(filePath: string, callback: (config: T) => void): void {
    this.jsonLoader.watch(filePath, callback);
  }

  /**
   * 监听 YAML 配置文件变化
   * @param filePath 配置文件路径
   * @param callback 变化回调
   */
  watchYaml<T>(filePath: string, callback: (config: T) => void): void {
    this.yamlLoader.watch(filePath, callback);
  }

  /**
   * 停止监听配置文件变化
   * @param filePath 配置文件路径
   */
  unwatch(filePath: string): void {
    this.jsonLoader.unwatch(filePath);
    this.yamlLoader.unwatch(filePath);
  }

  /**
   * 停止所有监听
   */
  unwatchAll(): void {
    this.jsonLoader.unwatchAll();
    this.yamlLoader.unwatchAll();
  }
}

/**
 * 创建配置管理器
 * @param config 配置管理器配置
 * @returns 配置管理器实例
 */
export function createConfigManager(config: ConfigManagerConfig): ConfigManager {
  return new ConfigManager(config);
}
