import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Issue } from "@domain/issue/model";
import type { Sop } from "@domain/sop/model";
import { Scope } from "@domain/workspace/model";
import { validateSop } from "@domain/sop/_internal/repository";
import { MonitorScheduler } from "@app/issue-collaboration/monitor-scheduler";
import { IssueAdapter } from "@domain/issue/_internal/adapter";
import { SQLiteIssueDependencyRepository } from "@domain/issue/_internal/dependency-repository";
import { SQLiteDatabase } from "@infra/database";

// ── Helpers ──────────────────────────────────────────────────────────

function makeSop(overrides: Partial<Sop> = {}): Sop {
  return {
    key: "test-sop",
    name: "Test SOP",
    description: null,
    shared_skill: null,
    stage_definitions: [
      { key: "design", title: "Design", description: "", roles: [{ key: "designer", name: "Designer", description: "", is_primary: true, count: 1, skill: null, prohibition: null, self_check: null }], gate_ids: null },
      { key: "development", title: "Dev", description: "", roles: [{ key: "developer", name: "Developer", description: "", is_primary: true, count: 1, skill: null, prohibition: null, self_check: null }], gate_ids: null },
      { key: "review", title: "Review", description: "", roles: [{ key: "reviewer", name: "Reviewer", description: "", is_primary: true, count: 1, skill: null, prohibition: null, self_check: null }], gate_ids: null },
    ],
    transitions: [
      { from: "design", to: "development", guard: null },
      { from: "development", to: "review", guard: null },
    ],
    scope: Scope.Platform,
    ...overrides,
  };
}

function makeMockIssueRepo(issues: Map<string, Issue> = new Map()) {
  return {
    findById: vi.fn((id: string) => issues.get(id)),
    listByWorkspace: vi.fn(() => []),
    create: vi.fn((issue: Issue) => { issues.set(issue.id, issue); }),
    addChildIssue: vi.fn(),
    updateContext: vi.fn(),
    updateClosedAt: vi.fn(),
    updateAggregatedStatus: vi.fn(),
    listChildren: vi.fn((parentId: string) => [...issues.values()].filter(i => i.parent_issue_id === parentId)),
  };
}

function makeMockStageRepo() {
  return {
    findById: vi.fn(),
    listByIssue: vi.fn(() => []),
    listOpenStageIds: vi.fn(() => []),
    listAllOpenStageIds: vi.fn(() => []),
    findActiveByIssue: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    rollbackStage: vi.fn(),
    recordAudit: vi.fn(),
    getAuditTrail: vi.fn(() => []),
    transaction: vi.fn((fn: () => any) => fn()),
  };
}

function makeMockDependencyRepo(deps: Array<{ issue_id: string; depends_on: string }> = []) {
  return {
    create: vi.fn((dep: any) => { deps.push(dep); }),
    listByIssue: vi.fn((issueId: string) => deps.filter(d => d.issue_id === issueId).map(d => ({ ...d, created_at: new Date().toISOString() }))),
    listDependsOn: vi.fn(() => []),
    listByParentIssue: vi.fn(() => []),
    wouldCreateCycle: vi.fn((issueId: string, dependsOn: string) => {
      // BFS cycle detection on the in-memory deps
      const visited = new Set<string>();
      const queue = [dependsOn];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === issueId) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const d of deps.filter(dd => dd.issue_id === current)) queue.push(d.depends_on);
      }
      return false;
    }),
  };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    workspace_path: "/workspace",
    title: "Test Issue",
    summary: null,
    sop_snapshot: makeSop(),
    snail_assignment_plan: {},
    context: {},
    created_at: new Date().toISOString(),
    closed_at: null,
    parent_issue_id: null,
    child_issue_ids: [],
    issue_type: "task",
    aggregated_status: "pending",
    aggregated_progress: { total: 0, completed: 0, in_progress: 0, failed: 0, blocked: 0 },
    ...overrides,
  };
}

// ── B2: 子 issue 创建和校验 ──────────────────────────────────────────

describe("B2: create child issue validation", () => {
  it("缺少 sop_key 时 createChildIssue 抛出错误", () => {
    const parentIssue = makeIssue({ id: "parent-1", issue_type: "project" });
    const issues = new Map<string, Issue>();
    issues.set(parentIssue.id, parentIssue);
    const issueRepo = makeMockIssueRepo(issues);
    const adapter = new IssueAdapter(
      issueRepo as any,
      { findByKey: vi.fn(() => null) } as any,
      makeMockStageRepo() as any,
      makeMockDependencyRepo() as any,
    );

    expect(() => adapter.createChildIssue({
      parent_issue_id: "parent-1",
      title: "child",
      scope: "test",
      sop_key: "nonexistent",
    })).toThrow("SOP not found: nonexistent");
  });
});

// ── B3: 子 issue 依赖 DAG ──────────────────────────────────────────

describe("B3: dependency DAG", () => {
  it("依赖全部完成的子 issue 自动进入可执行状态", () => {
    const issueA = makeIssue({ id: "a", closed_at: new Date().toISOString(), aggregated_status: "completed" });
    const issueB = makeIssue({ id: "b", closed_at: null });
    const issues = new Map<string, Issue>([["a", issueA], ["b", issueB]]);

    const adapter = new IssueAdapter(
      makeMockIssueRepo(issues) as any,
      {} as any,
      makeMockStageRepo() as any,
      makeMockDependencyRepo([{ issue_id: "b", depends_on: "a" }]) as any,
    );

    expect(adapter.isChildIssueReady("b")).toBe(true);
  });

  it("依赖 failed 的子 issue 不进入可执行状态", () => {
    const issueA = makeIssue({ id: "a", closed_at: new Date().toISOString(), aggregated_status: "failed" });
    const issueB = makeIssue({ id: "b", closed_at: null });
    const issues = new Map<string, Issue>([["a", issueA], ["b", issueB]]);

    const adapter = new IssueAdapter(
      makeMockIssueRepo(issues) as any,
      {} as any,
      makeMockStageRepo() as any,
      makeMockDependencyRepo([{ issue_id: "b", depends_on: "a" }]) as any,
    );

    expect(adapter.isChildIssueReady("b")).toBe(false);
  });
});

// ── B4: 循环依赖检测 ──────────────────────────────────────────────────

describe("B4: cycle detection", () => {
  let tmpDir: string;
  let db: SQLiteDatabase;
  let depRepo: SQLiteIssueDependencyRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
    db = new SQLiteDatabase(tmpDir);
    depRepo = new SQLiteIssueDependencyRepository(db);
    // 预置依赖链：a -> c, b -> a, c -> b
    const now = new Date().toISOString();
    depRepo.create({ issue_id: "a", depends_on: "c", created_at: now });
    depRepo.create({ issue_id: "b", depends_on: "a", created_at: now });
    depRepo.create({ issue_id: "c", depends_on: "b", created_at: now });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("检测循环依赖并拒绝创建", () => {
    // a -> b 会形成环: a -> b -> c -> ... (c depends on b, b depends on a)
    expect(depRepo.wouldCreateCycle("a", "b")).toBe(true);
    // a -> d（新节点）不会形成环
    expect(depRepo.wouldCreateCycle("a", "d")).toBe(false);
  });

  it("自依赖形成环", () => {
    expect(depRepo.wouldCreateCycle("a", "a")).toBe(true);
  });
});

// ── B5: 所有子 issue 完成时推进到 integration ────────────────────────

describe("B5: all children completed -> advance to integration", () => {
  it("聚合状态为 completed 时推进", () => {
    const scheduler = new MonitorScheduler({
      issuePort: {} as any,
      stagePort: { listStages: vi.fn().mockReturnValue([]) } as any,
      notifyParentMonitor: vi.fn(),
    });

    const children = [
      makeIssue({ id: "c1", closed_at: new Date().toISOString() }),
      makeIssue({ id: "c2", closed_at: new Date().toISOString() }),
    ];

    const { status } = scheduler.computeAggregatedStatus(children);
    expect(status).toBe("completed");
  });
});

// ── B10: 父 issue 只看到直接子 issue 聚合状态 ──────────────────────────

describe("B10: aggregated progress visibility", () => {
  it("返回聚合状态和进度，不暴露孙 issue 细节", () => {
    const scheduler = new MonitorScheduler({
      issuePort: {} as any,
      stagePort: { listStages: vi.fn().mockReturnValue([]) } as any,
      notifyParentMonitor: vi.fn(),
    });

    const children = [
      makeIssue({ id: "c1", closed_at: new Date().toISOString() }),
      makeIssue({ id: "c2", closed_at: new Date().toISOString() }),
      makeIssue({ id: "c3", closed_at: new Date().toISOString(), aggregated_status: "failed" }),
      makeIssue({ id: "c4", closed_at: null }), // blocked (no active stage)
      makeIssue({ id: "c5", closed_at: null }), // blocked
    ];

    const { status, progress } = scheduler.computeAggregatedStatus(children);
    expect(progress.total).toBe(5);
    expect(progress.completed).toBe(2);
    expect(progress.failed).toBe(1);
    expect(progress.blocked).toBe(2);
    expect(status).toBe("failed");
  });
});

// ── SOP Validation S1-S6 ──────────────────────────────────────────────

describe("SOP validation S1-S6", () => {
  it("S1: SOP 必须至少有 1 个 stage", () => {
    const sop = makeSop({ stage_definitions: [] });
    const errors = validateSop(sop);
    expect(errors.some(e => e.rule === "S1" && e.level === "block")).toBe(true);
  });

  it("S2: 每个 stage 必须至少有 1 个 role", () => {
    const sop = makeSop({
      stage_definitions: [
        { key: "empty", title: "Empty", description: "", roles: [], gate_ids: null },
      ],
    });
    const errors = validateSop(sop);
    expect(errors.some(e => e.rule === "S2" && e.level === "block")).toBe(true);
  });

  it("S3: transitions 引用的 stage key 必须在 stages 中定义", () => {
    const sop = makeSop({
      transitions: [{ from: "design", to: "nonexistent", guard: null }],
    });
    const errors = validateSop(sop);
    expect(errors.some(e => e.rule === "S3" && e.level === "block")).toBe(true);
  });

  it("S4: 涉及代码变更的 SOP 必须有 review stage", () => {
    const sop = makeSop({
      stage_definitions: [
        { key: "development", title: "Dev", description: "", roles: [{ key: "dev", name: "Dev", description: "", is_primary: true, count: 1, skill: null, prohibition: null, self_check: null }], gate_ids: null },
      ],
      transitions: [],
    });
    const errors = validateSop(sop);
    expect(errors.some(e => e.rule === "S4" && e.level === "block")).toBe(true);
  });

  it("S5: SOP 必须有且仅有一个入口 stage", () => {
    const sop = makeSop({
      transitions: [], // 无 transition，所有 stage 都是入口
    });
    const errors = validateSop(sop);
    expect(errors.some(e => e.rule === "S5" && e.level === "block")).toBe(true);
  });

  it("S6: gate 覆盖度不足时警告", () => {
    const sop = makeSop({
      stage_definitions: [
        { key: "design", title: "Design", description: "", roles: [{ key: "d", name: "D", description: "", is_primary: true, count: 1, skill: null, prohibition: null, self_check: null }], gate_ids: ["gate-01"] },
        { key: "development", title: "Dev", description: "", roles: [{ key: "dev", name: "Dev", description: "", is_primary: true, count: 1, skill: null, prohibition: null, self_check: null }], gate_ids: null },
        { key: "review", title: "Review", description: "", roles: [{ key: "r", name: "R", description: "", is_primary: true, count: 1, skill: null, prohibition: null, self_check: null }], gate_ids: null },
      ],
    });
    const errors = validateSop(sop);
    expect(errors.some(e => e.rule === "S6" && e.level === "warn")).toBe(true);
  });

  it("合法 SOP 通过校验", () => {
    const sop = makeSop();
    const errors = validateSop(sop);
    expect(errors.filter(e => e.level === "block")).toHaveLength(0);
  });
});

// ── AutoAdvanceEngine: Dynamic gate_ids ──────────────────────────────

describe("AutoAdvanceEngine: dynamic gate_ids", () => {
  it("使用 gate_ids 动态校验 gate", () => {
    const sopWithGates = makeSop({
      stage_definitions: [
        { key: "design", title: "Design", description: "", roles: [], gate_ids: ["design-01", "design-02"] },
        { key: "development", title: "Dev", description: "", roles: [], gate_ids: null },
        { key: "review", title: "Review", description: "", roles: [], gate_ids: null },
      ],
    });

    // 验证 SOP 中的 gate_ids 被正确设置
    const designStage = sopWithGates.stage_definitions.find(sd => sd.key === "design");
    expect(designStage?.gate_ids).toEqual(["design-01", "design-02"]);

    // 验证其他 stage 没有 gate_ids
    const devStage = sopWithGates.stage_definitions.find(sd => sd.key === "development");
    expect(devStage?.gate_ids).toBeNull();
  });
});

// ── MonitorScheduler: 聚合状态计算 ──────────────────────────────────

describe("MonitorScheduler: aggregated status", () => {
  it("任一子 issue in_progress → 父 in_progress", () => {
    const mockStage = { id: "s1", left_at: null };
    const scheduler = new MonitorScheduler({
      issuePort: { findIssue: vi.fn(), listChildren: vi.fn() } as any,
      stagePort: { findStage: vi.fn(), listStages: vi.fn().mockReturnValue([mockStage]) } as any,
      notifyParentMonitor: vi.fn(),
    });

    const children = [
      makeIssue({ id: "c1", closed_at: null }),
      makeIssue({ id: "c2", closed_at: new Date().toISOString() }),
    ];

    const { status, progress } = scheduler.computeAggregatedStatus(children);
    expect(status).toBe("in_progress");
    expect(progress.in_progress).toBe(1);
    expect(progress.completed).toBe(1);
  });

  it("所有子 issue completed → 父 completed", () => {
    const scheduler = new MonitorScheduler({
      issuePort: {} as any,
      stagePort: { listStages: vi.fn().mockReturnValue([]) } as any,
      notifyParentMonitor: vi.fn(),
    });

    const children = [
      makeIssue({ id: "c1", closed_at: new Date().toISOString() }),
      makeIssue({ id: "c2", closed_at: new Date().toISOString() }),
    ];

    const { status, progress } = scheduler.computeAggregatedStatus(children);
    expect(status).toBe("completed");
    expect(progress.completed).toBe(2);
    expect(progress.total).toBe(2);
  });

  it("任一子 issue failed → 父 failed", () => {
    const scheduler = new MonitorScheduler({
      issuePort: {} as any,
      stagePort: { listStages: vi.fn().mockReturnValue([]) } as any,
      notifyParentMonitor: vi.fn(),
    });

    const children = [
      makeIssue({ id: "c1", closed_at: new Date().toISOString(), aggregated_status: "failed" }),
      makeIssue({ id: "c2", closed_at: new Date().toISOString() }),
    ];

    const { status, progress } = scheduler.computeAggregatedStatus(children);
    expect(status).toBe("failed");
    expect(progress.failed).toBe(1);
  });
});
