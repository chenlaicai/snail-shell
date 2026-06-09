/**
 * Zod 配置校验器实现
 *
 * 基于 zod 实现配置校验。
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { ConfigValidator, ConfigValidatorFactory, ValidationResult } from "./types";

/**
 * Zod 配置校验器
 */
export class ZodConfigValidator implements ConfigValidator {
  constructor(private schemaDir: string) {}

  async validate<T>(config: T, schemaPath: string): Promise<ValidationResult> {
    return this.validateSync(config, schemaPath);
  }

  validateSync<T>(config: T, schemaPath: string): ValidationResult {
    try {
      // 加载 Schema
      const schema = this.loadSchema(schemaPath);

      // 校验配置
      const result = schema.safeParse(config);

      if (result.success) {
        return {
          valid: true,
          errors: [],
          warnings: [],
        };
      }

      return {
        valid: false,
        errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
        warnings: [],
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to load schema: ${error instanceof Error ? error.message : String(error)}`],
        warnings: [],
      };
    }
  }

  private loadSchema(schemaPath: string): z.ZodType {
    const fullPath = this.resolvePath(schemaPath);

    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const schemaDefinition = JSON.parse(content);

      // 根据 Schema 定义动态构建 Zod Schema
      return this.buildZodSchema(schemaDefinition);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Schema file not found: ${fullPath}`);
      }
      throw new Error(`Failed to load schema file ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildZodSchema(definition: Record<string, unknown>): z.ZodType {
    // 简单的 Schema 构建器
    // 实际实现应该支持更复杂的 Schema 定义
    const shape: Record<string, z.ZodType> = {};

    for (const [key, value] of Object.entries(definition)) {
      if (typeof value === "object" && value !== null) {
        const fieldDef = value as Record<string, unknown>;

        if (fieldDef.type === "string") {
          let schema = z.string();
          if (fieldDef.required === false) {
            schema = schema.optional() as unknown as z.ZodString;
          }
          shape[key] = schema;
        } else if (fieldDef.type === "number") {
          let schema = z.number();
          if (fieldDef.required === false) {
            schema = schema.optional() as unknown as z.ZodNumber;
          }
          shape[key] = schema;
        } else if (fieldDef.type === "boolean") {
          let schema = z.boolean();
          if (fieldDef.required === false) {
            schema = schema.optional() as unknown as z.ZodBoolean;
          }
          shape[key] = schema;
        } else if (fieldDef.type === "array") {
          let schema = z.array(z.unknown());
          if (fieldDef.required === false) {
            schema = schema.optional() as unknown as z.ZodArray<z.ZodUnknown>;
          }
          shape[key] = schema;
        } else if (fieldDef.type === "object") {
          let schema = z.record(z.unknown());
          if (fieldDef.required === false) {
            schema = schema.optional() as unknown as z.ZodRecord;
          }
          shape[key] = schema;
        }
      }
    }

    return z.object(shape);
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(this.schemaDir, filePath);
  }
}

/**
 * Zod 配置校验器工厂
 */
export class ZodConfigValidatorFactory implements ConfigValidatorFactory {
  create(schemaDir: string): ConfigValidator {
    return new ZodConfigValidator(schemaDir);
  }
}
