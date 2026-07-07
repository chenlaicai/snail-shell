import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueTemplateAdapter } from "@domain/issue-template/_internal/adapter";
import type { IssueTemplateRepository } from "@domain/issue-template/_internal/repository";
import type { CreateIssuePort } from "@domain/issue-template/port";
import type { IssueTemplate, IssueTemplateExecution } from "@domain/issue-template/model";
import type { Sop } from "@domain/sop/model";
import type { IssueSnailAssignmentPlan } from "@domain/issue/model";
import { Scope } from "@domain/workspace/model";

function createTestSop(): Sop {
  return {
    key: "code-delivery", name: "Code Delivery", description: "Standard code delivery SOP",
    shared_skill: null,
    stage_definitions: [
      { key: "design", title: "Design", description: "Design stage", roles: [{ key: "architect", name: "architect", description: "Architect role", is_primary: true, count: 1, skill: "cd-design", prohibition: null, self_check: null }] },
      { key: "development", title: "Development", description: "Dev stage", roles: [{ key: "developer", name: "developer", description: "Developer role", is_primary: true, count: 1, skill: "cd-development", prohibition: null, self_check: null }] },
    ],
    transitions: [{ from: "design", to: "development", guard: null }],
    scope: Scope.Platform,
  };
}

function createTestPlan(): IssueSnailAssignmentPlan {
  return { design: { architect: "snail-1" }, development: { developer: "snail-1" } };
}

function createTestTemplate(overrides: Partial<IssueTemplate> = {}): IssueTemplate {
  return {
    id: "tpl-1", workspace_path: "/workspace", title: "Weekly Code Review",
    sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(),
    cron_expression: "0 9 * * 1", enabled: true, last_spawned_at: null, consecutive_failures: 0,
    created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function createMockRepo(templates: IssueTemplate[] = []): IssueTemplateRepository {
  const execs: IssueTemplateExecution[] = [];
  const children: { template_id: string; child_issue_id: string; created_at: string }[] = [];
  return {
    findAll: vi.fn(() => templates.map(t => ({ ...t, last_status: execs.filter(e => e.template_id === t.id).at(-1)?.status ?? null, last_child_issue_id: execs.filter(e => e.template_id === t.id).at(-1)?.child_issue_id ?? null }))),
    findById: vi.fn((id: string) => templates.find(t => t.id === id)),
    create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    findEnabled: vi.fn(() => templates.filter(t => t.enabled)),
    updateSpawned: vi.fn((id: string, lastSpawnedAt: string, failures: number) => { const t = templates.find(t => t.id === id); if (t) { t.last_spawned_at = lastSpawnedAt; t.consecutive_failures = failures; } }),
    toggleEnabled: vi.fn((id: string, enabled: boolean) => { const t = templates.find(t => t.id === id); if (t) t.enabled = enabled; }),
    createExecution: vi.fn((exec: Omit<IssueTemplateExecution, "id">) => { const r = { ...exec, id: `exec-${execs.length + 1}` }; execs.push(r); return r; }),
    listExecutions: vi.fn(() => execs),
    updateExecution: vi.fn((id: string, status: "success" | "failed", childIssueId: string | null, error: string | null) => { const e = execs.find(e => e.id === id); if (e) { e.status = status; e.child_issue_id = childIssueId; e.error = error; } }),
    findLastExecution: vi.fn(),
    insertChild: vi.fn((tid: string, cid: string) => children.push({ template_id: tid, child_issue_id: cid, created_at: new Date().toISOString() })),
    listChildren: vi.fn(() => children.map(c => ({ ...c, title: "Child Issue", status: "open" as const, workspace_path: "/test" }))),
  };
}

function createMockCollaboration(): CreateIssuePort {
  return { createIssue: vi.fn().mockResolvedValue({ issue: { id: "issue-child-1" }, stage: { id: "stage-1" } }) };
}

describe("IssueTemplateAdapter - create", () => {
  let repo: IssueTemplateRepository;
  let collaboration: CreateIssuePort;
  let adapter: IssueTemplateAdapter;

  beforeEach(() => {
    repo = createMockRepo();
    collaboration = createMockCollaboration();
    adapter = new IssueTemplateAdapter(repo, collaboration);
  });

  it("creates template with valid input", () => {
    repo.create = vi.fn(() => createTestTemplate({ id: "tpl-new" }));
    const result = adapter.create({ workspace_path: "/workspace", title: "Test", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    expect(result.id).toBe("tpl-new");
    expect(repo.create).toHaveBeenCalled();
  });

  it("rejects invalid cron expression (B10)", () => {
    expect(() => adapter.create({ workspace_path: "/ws", title: "T", sop_key: "k", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "invalid" })).toThrow("Invalid cron expression");
  });

  it("rejects empty cron expression (B10)", () => {
    expect(() => adapter.create({ workspace_path: "/ws", title: "T", sop_key: "k", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "" })).toThrow("cron_expression is required");
  });

  it("B11: rejects snail_assignment_plan missing a stage", () => {
    const incompletePlan: IssueSnailAssignmentPlan = { design: { architect: "snail-1" } };
    expect(() => adapter.create({ workspace_path: "/ws", title: "T", sop_key: "k", sop_snapshot: createTestSop(), snail_assignment_plan: incompletePlan, cron_expression: "0 9 * * 1" })).toThrow("snail assignment");
  });

  it("B11: rejects snail_assignment_plan with missing role in a stage", () => {
    const incompletePlan: IssueSnailAssignmentPlan = { design: {}, development: { developer: "snail-1" } };
    expect(() => adapter.create({ workspace_path: "/ws", title: "T", sop_key: "k", sop_snapshot: createTestSop(), snail_assignment_plan: incompletePlan, cron_expression: "0 9 * * 1" })).toThrow("snail assignment");
  });

  it("B11: rejects update with mismatched snail_assignment_plan", () => {
    const template = createTestTemplate();
    const repo = createMockRepo([template]);
    const adapter = new IssueTemplateAdapter(repo, createMockCollaboration());
    const mismatchedPlan: IssueSnailAssignmentPlan = { design: { architect: "snail-1" } };
    expect(() => adapter.update("tpl-1", { snail_assignment_plan: mismatchedPlan })).toThrow("snail assignment");
  });
});

describe("IssueTemplateAdapter - toggle", () => {
  it("toggles enabled status", () => {
    const repo = createMockRepo([createTestTemplate({ enabled: true })]);
    const adapter = new IssueTemplateAdapter(repo, createMockCollaboration());
    const result = adapter.toggle("tpl-1");
    expect(result.enabled).toBe(false);
    expect(repo.toggleEnabled).toHaveBeenCalled();
  });
});

describe("IssueTemplateAdapter - scheduler", () => {
  it("B2: fires when cron next fire time has passed", async () => {
    const template = createTestTemplate({ cron_expression: "* * * * *", last_spawned_at: new Date(Date.now() - 120_000).toISOString() });
    const repo = createMockRepo([template]);
    const collaboration = createMockCollaboration();
    const adapter = new IssueTemplateAdapter(repo, collaboration);
    adapter.start();
    await vi.waitFor(() => expect(collaboration.createIssue).toHaveBeenCalled());
    adapter.stop();
  });

  it("B4: does not fire when next fire time is in the future", async () => {
    const template = createTestTemplate({ cron_expression: "* * * * *", last_spawned_at: new Date().toISOString() });
    const repo = createMockRepo([template]);
    const collaboration = createMockCollaboration();
    const adapter = new IssueTemplateAdapter(repo, collaboration);
    adapter.start();
    await new Promise(r => setTimeout(r, 100));
    expect(collaboration.createIssue).not.toHaveBeenCalled();
    adapter.stop();
  });

  it("B1: catch-up fires on start for missed schedule", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    const template = createTestTemplate({ cron_expression: "0 * * * *", last_spawned_at: twoHoursAgo });
    const repo = createMockRepo([template]);
    const collaboration = createMockCollaboration();
    const adapter = new IssueTemplateAdapter(repo, collaboration);
    adapter.start();
    await vi.waitFor(() => expect(collaboration.createIssue).toHaveBeenCalled());
    adapter.stop();
  });

  it("B3: records failure and increments consecutive_failures", async () => {
    const template = createTestTemplate({ cron_expression: "* * * * *", last_spawned_at: new Date(Date.now() - 120_000).toISOString() });
    const repo = createMockRepo([template]);
    const collaboration: CreateIssuePort = { createIssue: vi.fn().mockRejectedValue(new Error("SOP not found: missing")) };
    const adapter = new IssueTemplateAdapter(repo, collaboration);
    adapter.start();
    await vi.waitFor(() => expect(repo.updateExecution).toHaveBeenCalled());
    const execs = repo.listExecutions("tpl-1");
    expect(execs[0].status).toBe("failed");
    expect(execs[0].error).toBe("SOP not found: missing");
    adapter.stop();
  });

  it("B3: auto-disables after 3 consecutive failures", async () => {
    const template = createTestTemplate({ cron_expression: "* * * * *", last_spawned_at: new Date(Date.now() - 120_000).toISOString(), consecutive_failures: 2 });
    const repo = createMockRepo([template]);
    const collaboration: CreateIssuePort = { createIssue: vi.fn().mockRejectedValue(new Error("fail")) };
    const adapter = new IssueTemplateAdapter(repo, collaboration);
    adapter.start();
    await vi.waitFor(() => expect(repo.toggleEnabled).toHaveBeenCalled());
    expect(template.enabled).toBe(false);
    adapter.stop();
  });

  it("B3: failure does not update last_spawned_at (allows retry)", async () => {
    const originalLastSpawned = new Date(Date.now() - 120_000).toISOString();
    const template = createTestTemplate({ cron_expression: "* * * * *", last_spawned_at: originalLastSpawned });
    const repo = createMockRepo([template]);
    const collaboration: CreateIssuePort = { createIssue: vi.fn().mockRejectedValue(new Error("fail")) };
    const adapter = new IssueTemplateAdapter(repo, collaboration);
    adapter.start();
    await vi.waitFor(() => expect(repo.updateSpawned).toHaveBeenCalled());
    /** On failure, last_spawned_at should remain unchanged */
    expect(template.last_spawned_at).toBe(originalLastSpawned);
    adapter.stop();
  });

  it("B12: passes sop_snapshot to createIssue (D10)", async () => {
    const sop = createTestSop();
    const template = createTestTemplate({ cron_expression: "* * * * *", last_spawned_at: new Date(Date.now() - 120_000).toISOString(), sop_snapshot: sop });
    const repo = createMockRepo([template]);
    const collaboration = createMockCollaboration();
    const adapter = new IssueTemplateAdapter(repo, collaboration);
    adapter.start();
    await vi.waitFor(() => expect(collaboration.createIssue).toHaveBeenCalled());
    adapter.stop();
  });

  it("B3: resets consecutive_failures on success", async () => {
    const template = createTestTemplate({ cron_expression: "* * * * *", last_spawned_at: new Date(Date.now() - 120_000).toISOString(), consecutive_failures: 2 });
    const repo = createMockRepo([template]);
    const collaboration = createMockCollaboration();
    const adapter = new IssueTemplateAdapter(repo, collaboration);
    adapter.start();
    await vi.waitFor(() => expect(repo.updateSpawned).toHaveBeenCalled());
    expect(template.consecutive_failures).toBe(0);
    adapter.stop();
  });

  it("does not fire disabled templates", async () => {
    const template = createTestTemplate({ enabled: false, cron_expression: "* * * * *", last_spawned_at: new Date(Date.now() - 120_000).toISOString() });
    const repo = createMockRepo([template]);
    const collaboration = createMockCollaboration();
    const adapter = new IssueTemplateAdapter(repo, collaboration);
    adapter.start();
    await new Promise(r => setTimeout(r, 100));
    expect(collaboration.createIssue).not.toHaveBeenCalled();
    adapter.stop();
  });
});
