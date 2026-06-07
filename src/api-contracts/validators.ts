// validators.ts — 共享的运行时校验 schema
// 类型统一从 shared 导入，不重复定义
import { z } from "zod";
import type { ConversationKind, StageStatus, MessageRole } from "../shared";

// 运行时值数组——与 shared 类型的字面量值一一对应
export const CONVERSATION_KINDS: readonly [ConversationKind, ...ConversationKind[]] = [
  "discussion", "planning", "design", "implementation", "review", "bugfix"
];
export const ConversationKindSchema = z.enum(CONVERSATION_KINDS);

export const STAGE_STATUSES: readonly [StageStatus, ...StageStatus[]] = [
  "in_progress", "completed", "cancelled"
];
export const StageStatusSchema = z.enum(STAGE_STATUSES);

export const MESSAGE_ROLES: readonly [MessageRole, ...MessageRole[]] = [
  "user", "assistant", "system"
];
export const MessageRoleSchema = z.enum(MESSAGE_ROLES);

// 核心 DTO 的 zod schema——用于 API 响应的运行时校验
export const MessageSchema = z.object({
  id: z.number(),
  conversation_id: z.string(),
  client_id: z.string().nullable(),
  from_role: z.string().nullable(),
  to_roles: z.array(z.string()),
  role: MessageRoleSchema,
  quoted_message_id: z.number().nullable(),
  context_cutoff_at: z.string(),
  runtime: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  content: z.string().optional(),
  events: z.array(z.unknown()).optional(),
  quoted_message: z.object({ speaker: z.string().optional(), preview: z.string().optional() }).nullable().optional(),
});

export const StageDetailSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  issue_id: z.string(),
  type: z.string(),
  status: StageStatusSchema,
  sequence: z.number(),
  created_at: z.string().optional(),
  active_roles: z.array(z.string()).optional(),
  stage_definition: z.object({
    key: z.string(),
    title: z.string(),
    input_description: z.string().nullable(),
    output_description: z.string().nullable(),
    acceptance_focus: z.array(z.string()),
  }).nullable(),
});

export const IssueDetailSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  closed_at: z.string().nullable(),
  stages: z.array(StageDetailSchema),
  current_stage: StageDetailSchema.nullable(),
  conversation_count: z.number(),
  boss_pending_count: z.number(),
});

export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  module: z.string(),
  conversation_count: z.number(),
  stage_count: z.number(),
  issue_count: z.number(),
  boss_pending_count: z.number(),
});
