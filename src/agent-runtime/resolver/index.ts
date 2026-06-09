/**
 * Agent Runtime Resolver 接口
 *
 * 定义 Agent 运行时解析器的接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口访问运行时
 */

import type { SnailRuntime } from "../types";

/**
 * Agent Runtime Resolver 接口
 *
 * 定义 Agent 运行时解析器的操作。
 */
export interface RuntimeResolver {
  /**
   * 解析运行时
   * @param runtime 运行时名称
   * @returns 运行时实例
   */
  resolve(runtime: string): SnailRuntime;

  /**
   * 获取所有运行时
   * @returns 运行时列表
   */
  list(): SnailRuntime[];
}
