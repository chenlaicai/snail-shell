/**
 * Schema 定义类型
 *
 * 定义配置 Schema 的结构。
 */

/**
 * 字段类型
 */
export type FieldType = "string" | "number" | "boolean" | "array" | "object";

/**
 * 字段定义
 */
export interface FieldDefinition {
  /** 字段类型 */
  type: FieldType;
  /** 是否必填 */
  required?: boolean;
  /** 默认值 */
  default?: unknown;
  /** 描述 */
  description?: string;
  /** 枚举值 */
  enum?: unknown[];
  /** 最小值（数字） */
  min?: number;
  /** 最大值（数字） */
  max?: number;
  /** 最小长度（字符串/数组） */
  minLength?: number;
  /** 最大长度（字符串/数组） */
  maxLength?: number;
  /** 正则表达式（字符串） */
  pattern?: string;
  /** 数组元素类型 */
  items?: FieldDefinition;
  /** 对象属性定义 */
  properties?: Record<string, FieldDefinition>;
}

/**
 * Schema 定义
 */
export interface SchemaDefinition {
  /** Schema 名称 */
  name: string;
  /** Schema 描述 */
  description?: string;
  /** Schema 版本 */
  version?: string;
  /** 字段定义 */
  properties: Record<string, FieldDefinition>;
  /** 必填字段列表 */
  required?: string[];
}
