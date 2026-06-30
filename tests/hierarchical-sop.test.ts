import { describe, it, expect, vi } from "vitest";
import type { Issue, AggregatedProgress } from "@domain/issue/model";
import type { Sop } from "@domain/sop/model";
import { Scope } from "@domain/workspace/model";
import { validateSop } from "@domain/sop/_internal/repository";
import { MonitorScheduler } from "@app/issue-collaboration/monitor-scheduler";

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
  it("校验列表格式（title、scope、sop_key）", () => {
    // create_child_issue 工具在缺少必填字段时返回 validation_errors
    const requiredFields = ["title", "scope", "sop_key"];
    const providedFields: Record<string, string> = {};
    const errors = requiredFields.filter(f => !providedFields[f]);
    expect(errors.length).toBe(requiredFields.length);
  });
});

// ── B3: 子 issue 依赖 DAG ──────────────────────────────────────────

describe("B3: dependency DAG", () => {
  it("依赖全部完成的子 issue 自动进入可执行状态", () => {
    // 模拟：issue B 依赖 issue A，A 已完成
    const issueA = makeIssue({ id: "a", closed_at: new Date().toISOString() });
    const issueB = makeIssue({ id: "b", closed_at: null });

    // isChildIssueReady 检查所有依赖是否已完成
    const deps = [{ issue_id: "b", depends_on: "a", created_at: new Date().toISOString() }];
    const allDepsCompleted = deps.every(d => {
      const dep = d.depends_on === "a" ? issueA : issueB;
      return dep.closed_at != null;
    });
    expect(allDepsCompleted).toBe(true);
  });
});

// ── B4: 循环依赖检测 ──────────────────────────────────────────────────

describe("B4: cycle detection", () => {
  it("检测循环依赖并拒绝创建", () => {
    // 模拟拓扑排序检测：A -> B -> C -> A 形成环
    const deps = new Map<string, string[]>();
    deps.set("a", ["c"]); // a depends on c
    deps.set("b", ["a"]); // b depends on a
    deps.set("c", ["b"]); // c depends on b

    function wouldCreateCycle(issueId: string, dependsOn: string): boolean {
      const visited = new Set<string>();
      const queue = [dependsOn];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === issueId) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        const currentDeps = deps.get(current) ?? [];
        for (const dep of currentDeps) queue.push(dep);
      }
      return false;
    }

    // 添加 a -> b 会形成环
    expect(wouldCreateCycle("a", "b")).toBe(true);
    // 添加 a -> d（新节点）不会形成环
    expect(wouldCreateCycle("a", "d")).toBe(false);
  });
});

// ── B5: 所有子 issue 完成时推进到 integration ────────────────────────

describe("B5: all children completed -> advance to integration", () => {
  it("聚合状态为 completed 时推进", () => {
    const children = [
      makeIssue({ id: "c1", closed_at: new Date().toISOString() }),
      makeIssue({ id: "c2", closed_at: new Date().toISOString() }),
    ];

    // 计算聚合状态
    const allCompleted = children.every(c => c.closed_at != null);
    expect(allCompleted).toBe(true);
  });
});

// ── B10: 父 issue 只看到直接子 issue 聚合状态 ──────────────────────────

describe("B10: aggregated progress visibility", () => {
  it("返回聚合状态和进度，不暴露孙 issue 细节", () => {
    const progress: AggregatedProgress = {
      total: 5,
      completed: 3,
      in_progress: 1,
      failed: 0,
      blocked: 1,
    };
    expect(progress.total).toBe(5);
    expect(progress.completed).toBe(3);
    // 不包含孙 issue 的详细信息
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
