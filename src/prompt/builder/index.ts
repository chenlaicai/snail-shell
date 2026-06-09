/**
 * Prompt Builder 接口
 *
 * 定义提示词构建器的接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口构建提示词
 */

import type { PromptDocument, PromptBuildContext } from "../types";

/**
 * Prompt Builder 接口
 *
 * 定义提示词构建器的操作。
 */
export interface PromptBuilder {
  /**
   * 构建系统提示词
   * @param context 构建上下文
   * @returns 系统提示词
   */
  buildSystemPrompt(context: PromptBuildContext): Promise<string>;

  /**
   * 构建系统提醒
   * @param context 构建上下文
   * @returns 系统提醒
   */
  buildSystemReminder(context: PromptBuildContext): Promise<string>;

  /**
   * 获取所有 Prompt 文档
   * @returns Prompt 文档列表
   */
  listPrompts(): PromptDocument[];
}
