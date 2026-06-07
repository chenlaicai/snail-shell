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
  runtime: z.enum(["claude", "opencode", "codex", "system", "unknown"]).nullable(),
  status: z.enum(["streaming", "completed", "failed", "interrupted", "cancelled", "pending_approval"]),
  created_at: z.string(),
  updated_at: z.string(),
  content: z.string().optional(),
  quoted_message: z.object({ speaker: z.string().optional(), preview: z.string().optional() }).nullable().optional(),
});

export const StageDetailSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  issue_id: z.string(),
  stage_definition_id: z.string(),
  type: z.string(),
  sequence: z.number(),
  status: StageStatusSchema,
  output_artifacts: z.record(z.unknown()),
  gate_evidence: z.object({
    items: z.array(z.object({
      checklistId: z.string(),
      status: z.enum(["passed", "failed", "skipped"]),
      evidence: z.string(),
    })),
    preparedAt: z.string(),
    preparedBy: z.string(),
  }).nullable(),
  entered_at: z.string().nullable(),
  left_at: z.string().nullable(),
  input_artifacts: z.record(z.unknown()),
  boss_pending_count: z.number(),
  stage_definition: z.object({
    key: z.string(),
    title: z.string(),
    input_description: z.string().nullable(),
    output_description: z.string().nullable(),
    acceptance_focus: z.array(z.string()),
  }).nullable(),
  role_definitions: z.array(z.object({
    name: z.string(),
    snail_template_id: z.string().nullable(),
    is_primary: z.boolean(),
    description: z.string(),
    handbook: z.string().nullable(),
  })),
});

export const IssueDetailSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  task_anchor: z.string().nullable(),
  sop_snapshot: z.record(z.unknown()),
  role_snail_mapping: z.record(z.record(z.string())),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable(),
  stages: z.array(StageDetailSchema),
  current_stage: StageDetailSchema.nullable(),
  conversation_count: z.number(),
  boss_pending_count: z.number(),
});

export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  workspace_root: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  guard_profile: z.record(z.unknown()).nullable(),
  conversation_count: z.number(),
  stage_count: z.number(),
  issue_count: z.number(),
  boss_pending_count: z.number(),
});
