import type { Issue, Stage, RoleSnailAssignment } from "@domain/issue/model";

// ── Issue Repository ──────────────────────────────────────────────────

export interface IssueRepository {
  findById(id: string): Issue | undefined;
  listByWorkspace(workspacePath: string, limit?: number, offset?: number): Issue[];
  create(issue: Issue): void;
}

export class InMemoryIssueRepository implements IssueRepository {
  private issues = new Map<string, Issue>();

  findById(id: string): Issue | undefined {
    return this.issues.get(id);
  }

  listByWorkspace(workspacePath: string, limit = 50, offset = 0): Issue[] {
    return [...this.issues.values()]
      .filter(i => i.workspace_path === workspacePath)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(offset, offset + limit);
  }

  create(issue: Issue): void {
    if (this.issues.has(issue.id)) throw new Error(`Issue already exists: ${issue.id}`);
    this.issues.set(issue.id, issue);
  }
}

// ── Stage Repository ──────────────────────────────────────────────────

export interface StageRepository {
  findById(id: string): Stage | undefined;
  listByIssue(issueId: string): Stage[];
  create(stage: Stage): void;
}

export class InMemoryStageRepository implements StageRepository {
  private stages = new Map<string, Stage>();

  findById(id: string): Stage | undefined {
    return this.stages.get(id);
  }

  listByIssue(issueId: string): Stage[] {
    return [...this.stages.values()]
      .filter(s => s.issue_id === issueId)
      .sort((a, b) => a.entered_at.localeCompare(b.entered_at));
  }

  create(stage: Stage): void {
    if (this.stages.has(stage.id)) throw new Error(`Stage already exists: ${stage.id}`);
    this.stages.set(stage.id, stage);
  }
}

// ── RoleSnailAssignment Repository ──────────────────────────────────────

export interface RoleSnailAssignmentRepository {
  /** 追加一条记录 */
  append(session: RoleSnailAssignment): void;
  /** 获取指定角色实例的最新记录 */
  getLatest(stageId: string, roleInstance: string): RoleSnailAssignment | null;
  /** 获取 stage 下每个角色实例的最新记录 */
  listLatestByStage(stageId: string): RoleSnailAssignment[];
  /** 设置 snail 实例 ID */
  setSnailInstanceId(stageId: string, roleInstance: string, snailInstanceId: string): void;
}

export class InMemoryRoleSnailAssignmentRepository implements RoleSnailAssignmentRepository {
  private sessions: RoleSnailAssignment[] = [];

  append(session: RoleSnailAssignment): void {
    this.sessions.push(session);
  }

  getLatest(stageId: string, roleInstance: string): RoleSnailAssignment | null {
    const matches = this.sessions
      .filter(s => s.stage_id === stageId && s.role_instance === roleInstance)
      .sort((a, b) => b.seq - a.seq);
    return matches[0] ?? null;
  }

  listLatestByStage(stageId: string): RoleSnailAssignment[] {
    const byRole = new Map<string, RoleSnailAssignment>();
    for (const s of this.sessions) {
      if (s.stage_id !== stageId) continue;
      const existing = byRole.get(s.role_instance);
      if (!existing || s.seq > existing.seq) {
        byRole.set(s.role_instance, s);
      }
    }
    return [...byRole.values()];
  }

  setSnailInstanceId(stageId: string, roleInstance: string, snailInstanceId: string): void {
    const latest = this.getLatest(stageId, roleInstance);
    if (!latest) throw new Error(`RoleSnailAssignment not found: ${stageId}:${roleInstance}`);
    latest.snail_instance_id = snailInstanceId;
  }
}
