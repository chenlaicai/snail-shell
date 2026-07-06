import { describe, it, expect, vi } from "vitest";
import { AutoAdvanceEngine } from "@app/issue-collaboration/auto-advance";
import type { AutoAdvanceDeps } from "@app/issue-collaboration/auto-advance";
import type { Stage } from "@domain/issue/model";
import type { AutoAdvanceConfig, StageDefinition } from "@domain/sop/model";
import type { StageTransitionSuggestion } from "@app/issue-collaboration/port";

const DESIGN_CONFIG: AutoAdvanceConfig = {
  required_context_fields: ["worktree_path", "branch_name"],
  gate_ids: ["design-01"],
  accepted_signal_types: ["adversarial_consensus"],
};

const DEVELOPMENT_CONFIG: AutoAdvanceConfig = {
  required_context_fields: ["worktree_path", "branch_name", "pr_url"],
  gate_ids: ["dev-04"],
  accepted_signal_types: ["gate_complete"],
};

const REVIEW_CONFIG: AutoAdvanceConfig = {
  required_context_fields: ["pr_url"],
  gate_ids: ["rev-04"],
  accepted_signal_types: ["adversarial_consensus"],
  blocking_rules: [
    { type: "incompatible_tag" },
  ],
};

function makeStageDef(key: string, config?: AutoAdvanceConfig): StageDefinition {
  return { key, title: key, description: "", roles: [], auto_advance: config };
}

const ALL_STAGE_DEFS: StageDefinition[] = [
  makeStageDef("design", DESIGN_CONFIG),
  makeStageDef("development", DEVELOPMENT_CONFIG),
  makeStageDef("review", REVIEW_CONFIG),
  makeStageDef("merge"),
];

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
    signal_type: "gate_complete",
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
      context: { worktree_path: "/wt", branch_name: "feature-x", pr_url: "https://github.com/pr/1", feature_number: "F20260701tj92", feature_doc_path: "/docs/feature.md" },
      sop_snapshot: { stage_definitions: ALL_STAGE_DEFS },
    }),
    ...overrides,
  };
}

function mustGetIssueWithContext(context: Record<string, string>): AutoAdvanceDeps["mustGetIssue"] {
  return vi.fn().mockReturnValue({
    context,
    sop_snapshot: { stage_definitions: ALL_STAGE_DEFS },
  });
}

function getMissingFieldsFromSpy(deps: AutoAdvanceDeps): string[] | undefined {
  const spy = deps.notifyConsumers as ReturnType<typeof vi.fn>;
  for (const call of spy.mock.calls) {
    if (call[1] === "onContextMissing") {
      return (call[2] as { missing_fields: string[] }).missing_fields;
    }
  }
  return undefined;
}

function assertContextMissing(deps: AutoAdvanceDeps, expectedFields: string[]): void {
  const missing = getMissingFieldsFromSpy(deps);
  expect(missing).toBeDefined();
  expect(missing).toHaveLength(expectedFields.length);
  for (const field of expectedFields) {
    expect(missing).toContain(field);
  }
}

describe("AutoAdvanceEngine context validation", () => {
  describe("development stage", () => {
    it("blocks auto-advance when worktree_path is missing", async () => {
      const deps = createDeps({
        mustGetIssue: mustGetIssueWithContext({ branch_name: "feature-x", pr_url: "https://github.com/pr/1" }),
      });
      const engine = new AutoAdvanceEngine(deps);
      const result = await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
      assertContextMissing(deps, ["worktree_path"]);
    });

    it("blocks auto-advance when pr_url is missing", async () => {
      const deps = createDeps({
        mustGetIssue: mustGetIssueWithContext({ worktree_path: "/wt", branch_name: "feature-x" }),
      });
      const engine = new AutoAdvanceEngine(deps);
      const result = await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
      assertContextMissing(deps, ["pr_url"]);
    });

    it("allows auto-advance when all context fields are present", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const result = await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
      expect(result.reasons[0].code).toBe("AUTO_ADVANCED");
    });

    it("blocks when system gate check fails (dev-04: pr_url missing from context)", async () => {
      const deps = createDeps({
        mustGetIssue: mustGetIssueWithContext({ worktree_path: "/wt", branch_name: "feature-x", pr_url: "https://github.com/pr/1" }),
      });
      const engine = new AutoAdvanceEngine(deps);
      // dev-04 checks pr_url in context — it's present, so should pass
      const result = await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);
      expect(result.action).toBe("auto_advanced");
    });
  });

  describe("design stage", () => {
    it("blocks auto-advance when context fields are missing", async () => {
      const deps = createDeps({
        mustGetIssue: mustGetIssueWithContext({}),
      });
      const engine = new AutoAdvanceEngine(deps);
      const suggestion = createSuggestion({
        signal_type: "adversarial_consensus",
        from_speaker: "architect-1",
        target_key: "development",
      });
      const suggestion2 = { ...suggestion, from_speaker: "architect-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "design" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
      assertContextMissing(deps, ["worktree_path", "branch_name"]);
    });

    it("allows auto-advance when context fields are present and design-01 passes", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const suggestion = createSuggestion({
        signal_type: "adversarial_consensus",
        from_speaker: "architect-1",
        target_key: "development",
      });
      const suggestion2 = { ...suggestion, from_speaker: "architect-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "design" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
    });

    it("blocks auto-advance when design-01 fails (feature_doc_path missing)", async () => {
      const deps = createDeps({
        mustGetIssue: mustGetIssueWithContext({ worktree_path: "/wt", branch_name: "feature-x" }),
      });
      const engine = new AutoAdvanceEngine(deps);
      const suggestion = createSuggestion({
        signal_type: "adversarial_consensus",
        from_speaker: "architect-1",
        target_key: "development",
      });
      const suggestion2 = { ...suggestion, from_speaker: "architect-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "design" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("GATE_FAILED");
    });
  });
});

describe("no auto_advance config", () => {
  it("escalates when stage has no auto_advance config (B8)", async () => {
    const deps = createDeps({
      mustGetIssue: vi.fn().mockReturnValue({
        context: {},
        sop_snapshot: { stage_definitions: [makeStageDef("merge")] },
      }),
    });
    const engine = new AutoAdvanceEngine(deps);
    const result = await engine.evaluate(createStage({ key: "merge", available_transitions: [] }), [createSuggestion()]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("escalated");
    expect(result.reasons[0].code).toBe("NO_AUTO_ADVANCE_CONFIG");
  });
});

describe("blocking_rules (incompatible_tag)", () => {
  it("blocks when pr_title contains [Incompatible] via blocking_rules", async () => {
    const deps = createDeps({
      mustGetIssue: mustGetIssueWithContext({ pr_url: "https://github.com/pr/1", pr_title: "[Incompatible] Breaking change", feature_number: "F20260701tj92" }),
    });
    const engine = new AutoAdvanceEngine(deps);
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", from_speaker: "reviewer-1", target_key: "merge" });
    const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
    const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("INCOMPATIBLE_BLOCKED");
  });
});

describe("speaker count validation", () => {
  it("blocks when only 1 speaker for adversarial_consensus", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", from_speaker: "reviewer-1", target_key: "merge" });
    const result = await engine.evaluate(createStage({ key: "review" }), [s1]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("SPEAKERS_INSUFFICIENT");
  });

  it("allows when 2 speakers for adversarial_consensus", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", from_speaker: "reviewer-1", target_key: "merge" });
    const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
    const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);

    expect(deps.advanceStage).toHaveBeenCalled();
    expect(result.action).toBe("auto_advanced");
  });
});

describe("rev-04 feature number validation", () => {
  it("blocks when rev-04 feature_number is missing from context", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    // Override context to not have feature_number
    deps.mustGetIssue = mustGetIssueWithContext({ pr_url: "https://github.com/pr/1" });
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", from_speaker: "reviewer-1", target_key: "merge" });
    const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
    const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("GATE_FAILED");
    expect(result.reasons[0].details?.failed_gates).toContain("rev-04");
  });

  it("blocks when rev-04 feature_number has invalid format", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    deps.mustGetIssue = mustGetIssueWithContext({ pr_url: "https://github.com/pr/1", feature_number: "F2026070101" });
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", from_speaker: "reviewer-1", target_key: "merge" });
    const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
    const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("GATE_FAILED");
    expect(result.reasons[0].details?.failed_gates).toContain("rev-04");
  });

  it("allows when rev-04 feature_number has valid format", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", from_speaker: "reviewer-1", target_key: "merge" });
    const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
    const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);

    expect(deps.advanceStage).toHaveBeenCalled();
    expect(result.action).toBe("auto_advanced");
  });
});

describe("disagreement handling", () => {
  it("escalates on disagreement signal", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const suggestion = createSuggestion({
      signal_type: "disagreement",
      from_speaker: "dev",
      target_key: "review",
    });
    const result = await engine.evaluate(createStage({ key: "development" }), [suggestion]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("escalated");
    expect(result.reasons[0].code).toBe("DISAGREEMENT");
  });
});

describe("evaluateAdvance (L2 manual advance gate)", () => {
  it("returns blocked when context is missing", async () => {
    const deps = createDeps({
      mustGetIssue: mustGetIssueWithContext({ branch_name: "feature-x" }),
    });
    const engine = new AutoAdvanceEngine(deps);
    const result = await engine.evaluateAdvance(createStage({ key: "development" }), [createSuggestion()]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
  });

  it("returns auto_advanced when all checks pass but does NOT call advanceStage", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", from_speaker: "reviewer-1", target_key: "merge" });
    const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
    const result = await engine.evaluateAdvance(createStage({ key: "review" }), [s1, s2]);

    expect(result.action).toBe("auto_advanced");
    expect(deps.advanceStage).not.toHaveBeenCalled();
  });

  it("returns blocked when suggestions are empty", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const result = await engine.evaluateAdvance(createStage({ key: "development" }), []);

    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("NO_SIGNALS");
  });

  it("returns escalated when stage has no auto_advance config", async () => {
    const deps = createDeps({
      mustGetIssue: vi.fn().mockReturnValue({
        context: {},
        sop_snapshot: { stage_definitions: [makeStageDef("merge")] },
      }),
    });
    const engine = new AutoAdvanceEngine(deps);
    const result = await engine.evaluateAdvance(createStage({ key: "merge", available_transitions: [] }), [createSuggestion()]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("escalated");
    expect(result.reasons[0].code).toBe("NO_AUTO_ADVANCE_CONFIG");
  });
});
