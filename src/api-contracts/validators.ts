// validators.ts — 共享的运行时校验值
// 类型统一从 shared 导入，不重复定义
// zod schema 在 P4 阶段引入后从此文件导出
import type { ConversationKind, StageStatus, MessageRole } from "../shared";

// 运行时值数组——与 shared 类型的字面量值一一对应
export const CONVERSATION_KINDS: readonly [ConversationKind, ...ConversationKind[]] = [
  "discussion", "planning", "design", "implementation", "review", "bugfix"
];

export const STAGE_STATUSES: readonly [StageStatus, ...StageStatus[]] = [
  "in_progress", "completed", "cancelled"
];

export const MESSAGE_ROLES: readonly [MessageRole, ...MessageRole[]] = [
  "user", "assistant", "system"
];
