/**
 * Enriched View Types — 聚合视图，用于 API 响应和 manager 层。
 *
 * 从 domain-types.ts 拆出以满足文件行数限制（max 400）。
 * 这些类型扩展了核心实体，添加了聚合计数和嵌套详情。
 */
import type {
  Workspace,
  Issue,
  Stage,
  Conversation,
  RoleName,
  MessageDispatch,
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  ConversationHistorySearchResult,
  MessageWithEvents,
  SnailAgentSession,
} from "./domain-types";

export type { SnailAgentSession };

/** Workspace 聚合计数视图。 */
export interface WorkspaceSummary extends Workspace {
  conversation_count: number;
  stage_count: number;
  issue_count: number;
  boss_pending_count: number;
}

/** Workspace 详情视图，包含嵌套的 Issue 列表。 */
export interface WorkspaceDetail extends WorkspaceSummary {
  issues: IssueDetail[];
}

/** Issue 详情视图，包含嵌套的 Stage 列表和聚合信息。 */
export interface IssueDetail extends Issue {
  stages: StageDetail[];
  conversation_count: number;
  boss_pending_count: number;
  current_stage: StageDetail | null;
}

/** Stage 详情视图，包含 stage definition 和 role definition 信息。 */
export interface StageDetail extends Stage {
  input_artifacts: Record<string, unknown>;
  boss_pending_count: number;
  stage_definition: {
    key: string;
    title: string;
    input_description: string | null;
    output_description: string | null;
    acceptance_focus: string[];
  } | null;
  role_definitions: Array<{
    name: string;
    snail_template_id: string | null;
    is_primary: boolean;
    description: string;
    handbook: string | null;
  }>;
}

/** Conversation 详情视图，包含消息计数。 */
export interface ConversationDetail extends Conversation {
  message_count: number;
  boss_pending_count: number;
}

/** Conversation 消息分页视图。 */
export interface ConversationMessagesPage {
  items: MessageWithEvents[];
  next_offset: number;
  has_more: boolean;
}

/** Conversation 最近消息快照。 */
export interface ConversationRecentMessagesSnapshot {
  items: MessageWithEvents[];
  last_event_id: number;
}

/** Conversation 历史窗口视图。 */
export interface ConversationHistoryWindow {
  items: MessageWithEvents[];
}

/** Conversation 历史搜索结果分页。 */
export interface ConversationHistorySearchPage {
  items: ConversationHistorySearchResult[];
  next_offset: number;
  has_more: boolean;
}

/** Boss @mention 预览项。 */
export interface BossMentionItem {
  dispatch_id: number;
  message_id: number;
  from_role: RoleName | null;
  created_at: string;
  preview: string;
}

/** Conversation dispatch 状态视图。 */
export interface ConversationDispatchState {
  dispatches: MessageDispatch[];
  inbox_groups: Array<DispatchInboxGroup & { messages: DispatchInboxPreviewItem[] }>;
}

// ═══════════════════════════════════════════════════════════
// 辅助类型 — 从 persistence 和 agent 模块迁入
// ═══════════════════════════════════════════════════════════

/** GuardProfile 安全守护策略。 */
export interface GuardProfile {
  /** 放行列表：匹配的工具调用直接放行，不触发审批 */
  allow: string[];
  /** 拒绝列表：匹配的工具调用直接拒绝（优先于 allow） */
  deny: string[];
}

/** SOP 种子项，用于从 .snail 目录或 JSON 种子加载 SOP。 */
export interface SopSeedItem {
  sop: { id: string; source: "platform" | "workspace"; sourceRef: string | null; key: string; name: string; description?: string | null };
  stage_definitions: Array<{
    key: string; title: string; sequence: number;
    input_description?: string | null; output_description?: string | null;
    acceptance_focus?: string[]; acceptance_checklist?: Array<{ id: string; description: string; required: boolean }>;
    roles: Array<{ key: string; name: string; description?: string; handbook?: string | null; is_primary?: boolean; count?: number }>;
  }>;
}
