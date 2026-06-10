/** Issue 状态 */
export type IssueStatus = "open" | "closed";

/** Issue 实体 */
export interface Issue {
  id: string;
  workspace_id: string;
  title: string;
  summary: string | null;
  task_anchor: string | null;
  sop_snapshot: SopSnapshot;
  role_snail_mapping: Record<string, Record<string, string>>;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

/** SOP 快照（Issue 创建时冻结） */
export interface SopSnapshot {
  sop_id: string;
  name: string;
  description: string | null;
  first_stage: string | null;
  shared_handbook: string | null;
  stage_definitions: SopStageDefinition[];
  transitions: SopTransition[];
}

/** SOP 阶段定义 */
export interface SopStageDefinition {
  key: string;
  title: string;
  sequence: number;
  input_description: string | null;
  output_description: string | null;
  acceptance_focus: string[];
  acceptance_checklist: SopChecklistItem[];
  roles: SopRoleDefinition[];
}

/** SOP 验收清单项 */
export interface SopChecklistItem {
  id: string;
  description: string;
  required: boolean;
}

/** SOP 角色定义 */
export interface SopRoleDefinition {
  key: string;
  name: string;
  description: string;
  is_primary: boolean;
  count: number;
  handbook: string | null;
}

/** SOP 转移边 */
export interface SopTransition {
  from: string;
  to: string;
  guard: SopTransitionGuard | null;
}

/** SOP 转移守卫 */
export interface SopTransitionGuard {
  type: string;
  config: Record<string, unknown>;
}

/** Stage 状态 */
export type StageStatus = "in_progress" | "completed" | "cancelled";

/** Stage 实体 */
export interface Stage {
  id: string;
  workspace_id: string;
  issue_id: string;
  stage_definition_id: string;
  type: string;
  sequence: number;
  status: StageStatus;
  output_artifacts: Record<string, unknown>;
  gate_evidence: StageGateEvidence | null;
  entered_at: string | null;
  left_at: string | null;
}

/** Stage Gate 证据 */
export interface StageGateEvidence {
  items: StageGateArtifact[];
  prepared_at: string;
  prepared_by: string;
}

/** Stage Gate 验收项 */
export interface StageGateArtifact {
  checklist_id: string;
  status: "passed" | "failed" | "skipped";
  evidence: string;
}

/** 创建 Issue 输入 */
export interface CreateIssueInput {
  workspace_id: string;
  title: string;
  summary?: string;
  adopted_sop_id: string;
  role_snail_mapping: Record<string, Record<string, string>>;
}

/** Issue 创建结果 */
export interface CreateIssueResult {
  issue: Issue;
  stage: Stage;
  conversation: import("@domain/im/model").Conversation;
}
