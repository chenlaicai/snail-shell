import { describe, it, expect, vi } from "vitest";
import { AutoAdvanceEngine } from "@app/issue-collaboration/auto-advance";
import type { AutoAdvanceDeps } from "@app/issue-collaboration/auto-advance";
import type { Stage } from "@domain/issue/model";
import type { StageTransitionSuggestion } from "@app/issue-collaboration/port";

function createStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    workspace_path: "/workspace",
    issue_id: "issue-1",
    key: "development",
    title: "Development",
    description: "",
    default_role_instance: "dev",
    role_instances: ["dev"],
    from_stage_id: null,
    available_transitions: [{ to: "review", guard: null }],
    output_artifacts: {},
    entered_at: new Date().toISOString(),
    left_at: null,
    ...overrides,
  };
}

function createSuggestion(overrides: Partial<StageTransitionSuggestion> = {}): StageTransitionSuggestion {
  return {
    stage_id: "stage-1",
    message_id: 1,
    from_speaker: "dev",
    target_key: "review",
    reason: "done",
    guard: null,
    artifacts: {},
    created_at: new Date().toISOString(),
    consensus: undefined,
    gate_evidence: {
      "dev-01": "implemented",
      "dev-02": "check passed",
      "dev-03": "doc updated",
      "dev-04": "PR created",
      "dev-06": "verified",
    },
    ...overrides,
  };
}

function createDeps(overrides: Partial<AutoAdvanceDeps> = {}): AutoAdvanceDeps {
  return {
    advanceStage: vi.fn().mockResolvedValue(createStage({ key: "review" })),
    recordAuditTrail: vi.fn().mockResolvedValue(undefined),
    notifyConsumers: vi.fn().mockResolvedValue(undefined),
    generateDisagreementCard: vi.fn().mockResolvedValue(undefined),
    mustGetIssue: vi.fn().mockReturnValue({
      context: { worktree_path: "/wt", branch_name: "feature-x", pr_url: "https://github.com/pr/1" },
    }),
    ...overrides,
  };
}

/** 从 notifyConsumers spy 中提取 onContextMissing 事件的 missing_fields */
function getMissingFieldsFromSpy(deps: AutoAdvanceDeps): string[] | undefined {
  const spy = deps.notifyConsumers as ReturnType<typeof vi.fn>;
  for (const call of spy.mock.calls) {
    if (call[1] === "onContextMissing") {
      return (call[2] as { missing_fields: string[] }).missing_fields;
    }
  }
  return undefined;
}

/** 断言 notifyConsumers 被以 onContextMissing 事件调用，且 missing_fields 包含预期字段 */
function assertContextMissing(deps: AutoAdvanceDeps, expectedFields: string[]): void {
  const missing = getMissingFieldsFromSpy(deps);
  expect(missing).toBeDefined();
  for (const field of expectedFields) {
    expect(missing).toContain(field);
  }
}

describe("AutoAdvanceEngine context validation", () => {
  describe("development stage", () => {
    it("blocks auto-advance when worktree_path is missing", async () => {
      const deps = createDeps({
        mustGetIssue: vi.fn().mockReturnValue({
          context: { branch_name: "feature-x", pr_url: "https://github.com/pr/1" },
        }),
      });
      const engine = new AutoAdvanceEngine(deps);
      await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      assertContextMissing(deps, ["worktree_path"]);
    });

    it("blocks auto-advance when branch_name is missing", async () => {
      const deps = createDeps({
        mustGetIssue: vi.fn().mockReturnValue({
          context: { worktree_path: "/wt", pr_url: "https://github.com/pr/1" },
        }),
      });
      const engine = new AutoAdvanceEngine(deps);
      await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      assertContextMissing(deps, ["branch_name"]);
    });

    it("blocks auto-advance when pr_url is missing", async () => {
      const deps = createDeps({
        mustGetIssue: vi.fn().mockReturnValue({
          context: { worktree_path: "/wt", branch_name: "feature-x" },
        }),
      });
      const engine = new AutoAdvanceEngine(deps);
      await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      assertContextMissing(deps, ["pr_url"]);
    });

    it("blocks auto-advance when all context fields are missing", async () => {
      const deps = createDeps({
        mustGetIssue: vi.fn().mockReturnValue({ context: {} }),
      });
      const engine = new AutoAdvanceEngine(deps);
      await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      assertContextMissing(deps, ["worktree_path", "branch_name", "pr_url"]);
    });

    it("blocks auto-advance when context field is empty string", async () => {
      const deps = createDeps({
        mustGetIssue: vi.fn().mockReturnValue({
          context: { worktree_path: "", branch_name: "feature-x", pr_url: "https://github.com/pr/1" },
        }),
      });
      const engine = new AutoAdvanceEngine(deps);
      await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      assertContextMissing(deps, ["worktree_path"]);
    });

    it("allows auto-advance when all context fields are present", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).toHaveBeenCalled();
    });
  });

  describe("design stage", () => {
    it("blocks auto-advance when context fields are missing", async () => {
      const deps = createDeps({
        mustGetIssue: vi.fn().mockReturnValue({ context: {} }),
      });
      const engine = new AutoAdvanceEngine(deps);
      const suggestion = createSuggestion({
        consensus: true,
        from_speaker: "architect-1",
        target_key: "development",
        gate_evidence: { "design-01": "locked", "design-02": "resolved" },
      });
      const suggestion2 = { ...suggestion, from_speaker: "architect-2", message_id: 2 };
      await engine.evaluate(createStage({ key: "design" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      assertContextMissing(deps, ["worktree_path", "branch_name"]);
    });

    it("allows auto-advance when context fields are present", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const suggestion = createSuggestion({
        consensus: true,
        from_speaker: "architect-1",
        target_key: "development",
        gate_evidence: { "design-01": "locked", "design-02": "resolved" },
      });
      const suggestion2 = { ...suggestion, from_speaker: "architect-2", message_id: 2 };
      await engine.evaluate(createStage({ key: "design" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).toHaveBeenCalled();
    });
  });

  describe("review stage", () => {
    it("blocks auto-advance when pr_url is missing", async () => {
      const deps = createDeps({
        mustGetIssue: vi.fn().mockReturnValue({
          context: { worktree_path: "/wt", branch_name: "feature-x" },
        }),
      });
      const engine = new AutoAdvanceEngine(deps);
      const suggestion = createSuggestion({
        consensus: true,
        from_speaker: "reviewer-1",
        target_key: "merge",
        gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed" },
      });
      const suggestion2 = { ...suggestion, from_speaker: "reviewer-2", message_id: 2 };
      await engine.evaluate(createStage({ key: "review" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      assertContextMissing(deps, ["pr_url"]);
    });

    it("allows auto-advance when all context fields are present", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const suggestion = createSuggestion({
        consensus: true,
        from_speaker: "reviewer-1",
        target_key: "merge",
        gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed" },
      });
      const suggestion2 = { ...suggestion, from_speaker: "reviewer-2", message_id: 2 };
      await engine.evaluate(createStage({ key: "review" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).toHaveBeenCalled();
    });
  });
});
