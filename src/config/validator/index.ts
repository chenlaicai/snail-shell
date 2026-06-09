/**
 * 配置校验器模块
 *
 * 提供统一的配置校验功能。
 */

export type { ConfigValidator, ConfigValidatorFactory, ValidationResult } from "./types";
export { ZodConfigValidator, ZodConfigValidatorFactory } from "./zod";
