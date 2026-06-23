import type { Issue, Stage } from "@domain/issue/model";
import type { Message } from "@domain/message/model";

/** Issue MCP 端口定义 */
export interface IssueMCPPort {
  // ── Stage 操作 ──────────────────────────────────────────

  /** 记录 stage 的 output_artifacts（合并语义） */
  recordStageContext(
    stageId: string,
    entries: Record<string, unknown>
  ): Promise<{
    ok: true;
    stage_id: string;
    output_artifacts: Record<string, unknown>;
  }>;

  /** 获取 issue 的活跃 stage */
  getActiveStage(issueId: string): Promise<Stage | null>;

  /** 列出所有 stage 的 worktree_path 映射 */
  listStagesForWorkdir(): Promise<Array<{ id: string; worktree_path: string | null }>>;

  // ── Issue 操作 ──────────────────────────────────────────

  /** 设置 issue 的 task_anchor */
  setTaskAnchor(
    issueId: string,
    taskAnchor: string
  ): Promise<{ ok: true; issue_id: string; task_anchor: string }>;

  // ── Context 查询 ──────────────────────────────────────────

  /** 查询当前 conversation 的上下文 */
  queryContext(conversationId: string): Promise<{
    conv: {
      id: string;
      issue_id: string | null;
      stage_id: string | null;
      workspace_id: string | null;
      title: string | null;
      kind: string | null;
      summary: string | null;
      participating_roles: string[];
      from_conversation_ids: string[];
      created_at: string;
    };
    stage: Stage | null;
    stageDef: {
      id: string;
      key: string;
      title: string;
      description: string | null;
      input_description: string | null;
      output_description: string | null;
      acceptance_focus: string[];
    } | null;
    stageRoles: Array<{
      id: string;
      name: string;
      description: string | null;
      working_rules: string[];
    }>;
    issue: Issue | null;
    workspace: {
      id: string;
      name: string;
      summary: string | null;
    } | null;
    inputArtifacts: Record<string, unknown>;
  }>;

  // ── Conversation History 操作 ──────────────────────────────────────────

  /** 全文搜索对话历史 */
  searchHistory(params: {
    issueId?: string;
    conversationId?: string;
    query: string;
    limit?: number;
  }): Promise<{
    mode: string;
    query: string;
    issue_id: string | null;
    context_resolved: string;
    messages: Array<{
      message_id: string;
      conversation_id: string;
      role: string;
      from_role: string | null;
      snippet: string;
    }>;
  }>;

  /** 最近对话 */
  getRecentHistory(params: {
    issueId?: string;
    conversationId?: string;
    limit?: number;
  }): Promise<{
    mode: string;
    issue_id: string | null;
    context_resolved: string;
    messages: Message[];
  }>;

  /** 分页查询对话历史 */
  getPageHistory(params: {
    issueId?: string;
    conversationId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    mode: string;
    issue_id: string | null;
    context_resolved: string;
    messages: Message[];
  }>;

  /** 窗口查询对话历史 */
  getWindowHistory(params: {
    conversationId: string;
    anchorMessageId: number;
    before?: number;
    after?: number;
    direction?: "forward" | "backward";
  }): Promise<{
    mode: string;
    messages: Message[];
  }>;

  /** 按 ID 批量查询对话历史 */
  getHistoryByIds(params: {
    conversationId: string;
    messageIds: number[];
  }): Promise<{
    mode: string;
    messages: Message[];
  }>;

  /** 重建对话历史索引 */
  reindexHistory(params: {
    conversationId?: string;
  }): Promise<{
    mode: string;
    conversation_id: string | null;
    indexed_messages: number;
  }>;
}
