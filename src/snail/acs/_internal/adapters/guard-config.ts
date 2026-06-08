/**
 * GuardProfile → Claude Code CLI 参数翻译。
 *
 * Claude Code 使用 --disallowedTools 实现黑名单拦截。
 * bypassPermissions 模式下，--disallowedTools 仍然生效。
 */

import type { GuardProfile } from '../../types.js';

/**
 * 将 GuardProfile.deny 翻译为 Claude Code --disallowedTools CLI 参数。
 */
export function buildDisallowedToolsArgs(guard: GuardProfile): string[] {
  if (guard.deny.length === 0) return [];
  return ['--disallowedTools', ...guard.deny];
}
