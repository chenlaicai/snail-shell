import type { Issue, Stage, CreateIssueInput } from "@domain/issue/model";
import type { FileSystem } from "@infra/file-system";

/** Issue 持久层接口 */
export interface IssueRepository {
  findById(id: string): Issue | undefined;
  listByWorkspace(workspaceId: string, limit?: number, offset?: number): Issue[];
  create(issue: Issue): void;
  update(id: string, updates: Partial<Issue>): void;
}

/** Stage 持久层接口 */
export interface StageRepository {
  findById(id: string): Stage | undefined;
  listByIssue(issueId: string): Stage[];
  create(stage: Stage): void;
  update(id: string, updates: Partial<Stage>): void;
}

/** Issue 内存存储实现 */
export class InMemoryIssueRepository implements IssueRepository {
  private issues = new Map<string, Issue>();

  findById(id: string): Issue | undefined {
    return this.issues.get(id);
  }

  listByWorkspace(workspaceId: string, limit = 50, offset = 0): Issue[] {
    return [...this.issues.values()]
      .filter(i => i.workspace_id === workspaceId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(offset, offset + limit);
  }

  create(issue: Issue): void {
    if (this.issues.has(issue.id)) {
      throw new Error(`Issue already exists: ${issue.id}`);
    }
    this.issues.set(issue.id, issue);
  }

  update(id: string, updates: Partial<Issue>): void {
    const issue = this.issues.get(id);
    if (!issue) {
      throw new Error(`Issue not found: ${id}`);
    }
    Object.assign(issue, updates, { updated_at: new Date().toISOString() });
  }
}

/** Stage 内存存储实现 */
export class InMemoryStageRepository implements StageRepository {
  private stages = new Map<string, Stage>();

  findById(id: string): Stage | undefined {
    return this.stages.get(id);
  }

  listByIssue(issueId: string): Stage[] {
    return [...this.stages.values()]
      .filter(s => s.issue_id === issueId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  create(stage: Stage): void {
    if (this.stages.has(stage.id)) {
      throw new Error(`Stage already exists: ${stage.id}`);
    }
    this.stages.set(stage.id, stage);
  }

  update(id: string, updates: Partial<Stage>): void {
    const stage = this.stages.get(id);
    if (!stage) {
      throw new Error(`Stage not found: ${id}`);
    }
    Object.assign(stage, updates);
  }
}
