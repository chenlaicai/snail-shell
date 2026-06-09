/**
 * 配置校验器类型定义
 *
 * 提供统一的配置校验功能。
 */

/**
 * 校验结果
 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误信息列表 */
  errors: string[];
  /** 警告信息列表 */
  warnings: string[];
}

/**
 * 配置校验器接口
 *
 * 负责校验配置对象是否符合预期的 Schema。
 */
export interface ConfigValidator {
  /**
   * 校验配置对象
   * @param config 配置对象
   * @param schemaPath Schema 文件路径
   * @returns 校验结果
   */
  validate<T>(config: T, schemaPath: string): Promise<ValidationResult>;

  /**
   * 校验配置对象（同步）
   * @param config 配置对象
   * @param schemaPath Schema 文件路径
   * @returns 校验结果
   */
  validateSync<T>(config: T, schemaPath: string): ValidationResult;
}

/**
 * 配置校验器工厂接口
 *
 * 用于创建配置校验器实例。
 */
export interface ConfigValidatorFactory {
  /**
   * 创建配置校验器
   * @param schemaDir Schema 文件目录
   * @returns 配置校验器实例
   */
  create(schemaDir: string): ConfigValidator;
}
