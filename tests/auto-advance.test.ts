import { describe, it, expect, vi } from "vitest";
import { AutoAdvanceEngine } from "@app/issue-collaboration/auto-advance";
import type { AutoAdvanceDeps } from "@app/issue-collaboration/auto-advance";
import type { Stage } from "@domain/issue/model";
import type { AutoAdvanceConfig, StageDefinition } from "@domain/sop/model";
import type { StageTransitionSuggestion } from "@app/issue-collaboration/port";

const DESIGN_CONFIG: AutoAdvanceConfig = {
  required_context_fields: ["worktree_path", "branch_name"],
  gate_ids: ["design-01", "design-02"],
  accepted_signal_types: ["adversarial_consensus"],
};

const DEVELOPMENT_CONFIG: AutoAdvanceConfig = {
  required_context_fields: ["worktree_path", "branch_name", "pr_url"],
  gate_ids: ["dev-01", "dev-02", "dev-03", "dev-04", "dev-06"],
  accepted_signal_types: ["gate_complete"],
};

const REVIEW_CONFIG: AutoAdvanceConfig = {
  required_context_fields: ["pr_url"],
  gate_ids: ["rev-01", "rev-02", "rev-03", "rev-04"],
  accepted_signal_types: ["adversarial_consensus"],
  blocking_rules: [
    { type: "incompatible_tag" },
    { type: "unresolved_findings" },
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
      sop_snapshot: { stage_definitions: ALL_STAGE_DEFS },
    }),
    ...overrides,
  };
}

/** 构造 mustGetIssue mock，支持自定义 context 但保留 sop_snapshot */
function mustGetIssueWithContext(context: Record<string, string>): AutoAdvanceDeps["mustGetIssue"] {
  return vi.fn().mockReturnValue({
    context,
    sop_snapshot: { stage_definitions: ALL_STAGE_DEFS },
  });
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

/** 断言 notifyConsumers 被以 onContextMissing 事件调用，且 missing_fields 精确匹配预期字段集合 */
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

    it("blocks auto-advance when branch_name is missing", async () => {
      const deps = createDeps({
        mustGetIssue: mustGetIssueWithContext({ worktree_path: "/wt", pr_url: "https://github.com/pr/1" }),
      });
      const engine = new AutoAdvanceEngine(deps);
      const result = await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
      assertContextMissing(deps, ["branch_name"]);
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

    it("blocks auto-advance when all context fields are missing", async () => {
      const deps = createDeps({
        mustGetIssue: mustGetIssueWithContext({}),
      });
      const engine = new AutoAdvanceEngine(deps);
      const result = await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
      assertContextMissing(deps, ["worktree_path", "branch_name", "pr_url"]);
    });

    it("blocks auto-advance when context field is empty string", async () => {
      const deps = createDeps({
        mustGetIssue: mustGetIssueWithContext({ worktree_path: "", branch_name: "feature-x", pr_url: "https://github.com/pr/1" }),
      });
      const engine = new AutoAdvanceEngine(deps);
      const result = await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
      assertContextMissing(deps, ["worktree_path"]);
    });

    it("allows auto-advance when all context fields are present", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const result = await engine.evaluate(createStage({ key: "development" }), [createSuggestion()]);

      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
      expect(result.reasons[0].code).toBe("AUTO_ADVANCED");
    });

    it("blocks when gate_evidence is missing required gates", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const result = await engine.evaluate(createStage({ key: "development" }), [createSuggestion({
        gate_evidence: { "dev-01": "implemented" }, // missing dev-02, dev-03, dev-04, dev-06
      })]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("GATE_FAILED");
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
        consensus: true,
        from_speaker: "architect-1",
        target_key: "development",
        gate_evidence: { "design-01": "locked", "design-02": "resolved" },
      });
      const suggestion2 = { ...suggestion, from_speaker: "architect-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "design" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
      assertContextMissing(deps, ["worktree_path", "branch_name"]);
    });

    it("allows auto-advance when context fields are present", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 1000).toISOString();
      const adversarialArtifact1 = {
        independent_verification: [{ command: "tsc --noEmit", actual_output: "no errors found after full type check across all modules", executed_at: now }],
        adversarial_findings: [{ dimension: "completeness", finding: "found gap in error handling", disposition: "added to backlog" }],
        audit_trail: { events: [
          { timestamp: now, event_type: 'review_started' as const, detail: "started" },
          { timestamp: later, event_type: 'cross_review_read' as const, detail: "read" },
        ] },
        critique_obligation: { items: [
          { type: 'risk' as const, content: "risk 1" },
          { type: 'risk' as const, content: "risk 2" },
          { type: 'gap' as const, content: "gap 1" },
          { type: 'alternative' as const, content: "alt 1" },
        ] },
        independent_analysis: { my_conclusion: "ok", comparison_with_peer: "same", points_of_agreement: ["a"], points_of_disagreement: [] },
        scenario_coverage: { scenarios_reviewed: 5, scenarios_identified: 5, coverage_ratio: 1.0, constructed_scenarios: [
          { scenario: "when stage transitions fail mid-flight", question: "should the system auto-retry or escalate?" },
          { scenario: "when two reviewers submit conflicting findings", question: "should developer resolve or escalate?" },
        ] },
      };
      const adversarialArtifact2 = {
        ...adversarialArtifact1,
        independent_verification: [{ command: "npm run lint", actual_output: "zero warnings and zero errors across all source files", executed_at: now }],
      };
      const suggestion = createSuggestion({
        signal_type: "adversarial_consensus",
        consensus: true,
        from_speaker: "architect-1",
        target_key: "development",
        gate_evidence: { "design-01": "locked", "design-02": "resolved" },
        adversarial_artifact: adversarialArtifact1,
      });
      const suggestion2 = { ...suggestion, from_speaker: "architect-2", message_id: 2, adversarial_artifact: adversarialArtifact2 };
      const result = await engine.evaluate(createStage({ key: "design" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
    });

    it("blocks auto-advance when critique_obligation is missing (R4 safe check)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 1000).toISOString();
      const artifact = {
        independent_verification: [{ command: "tsc", actual_output: "no errors found in the codebase", executed_at: now }],
        adversarial_findings: [{ dimension: "completeness", finding: "found gap", disposition: "tracked" }],
        audit_trail: { events: [
          { timestamp: now, event_type: 'review_started' as const, detail: "started" },
          { timestamp: later, event_type: 'cross_review_read' as const, detail: "read" },
        ] },
        independent_analysis: { my_conclusion: "ok", comparison_with_peer: "same", points_of_agreement: ["a"], points_of_disagreement: [] },
        scenario_coverage: { scenarios_reviewed: 5, scenarios_identified: 5, coverage_ratio: 1.0 },
      };
      const suggestion = createSuggestion({
        signal_type: "adversarial_consensus",
        consensus: true,
        from_speaker: "architect-1",
        target_key: "development",
        gate_evidence: { "design-01": "locked", "design-02": "resolved" },
        adversarial_artifact: artifact as any,
      });
      const suggestion2 = { ...suggestion, from_speaker: "architect-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "design" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
    });

    it("blocks auto-advance when critique_obligation.items < 4 (R4)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 1000).toISOString();
      const artifact = {
        independent_verification: [{ command: "tsc", actual_output: "no errors found in the codebase", executed_at: now }],
        adversarial_findings: [{ dimension: "completeness", finding: "found gap", disposition: "tracked" }],
        audit_trail: { events: [
          { timestamp: now, event_type: 'review_started' as const, detail: "started" },
          { timestamp: later, event_type: 'cross_review_read' as const, detail: "read" },
        ] },
        critique_obligation: { items: [
          { type: 'risk' as const, content: "risk 1" },
          { type: 'gap' as const, content: "gap 1" },
        ] },
        independent_analysis: { my_conclusion: "ok", comparison_with_peer: "same", points_of_agreement: ["a"], points_of_disagreement: [] },
        scenario_coverage: { scenarios_reviewed: 5, scenarios_identified: 5, coverage_ratio: 1.0 },
      };
      const suggestion = createSuggestion({
        signal_type: "adversarial_consensus",
        consensus: true,
        from_speaker: "architect-1",
        target_key: "development",
        gate_evidence: { "design-01": "locked", "design-02": "resolved" },
        adversarial_artifact: artifact as any,
      });
      const suggestion2 = { ...suggestion, from_speaker: "architect-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "design" }), [suggestion, suggestion2]);

      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
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
      mustGetIssue: mustGetIssueWithContext({ pr_url: "https://github.com/pr/1", pr_title: "[Incompatible] Breaking change" }),
    });
    const engine = new AutoAdvanceEngine(deps);
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 1000).toISOString();
    const artifact = {
      independent_verification: [{ command: "tsc", actual_output: "compiled successfully with zero type errors in the project", executed_at: now }],
      adversarial_findings: [{ dimension: "completeness", finding: "found issue", disposition: "fixed" }],
      audit_trail: { events: [
        { timestamp: now, event_type: 'review_started' as const, detail: "started" },
        { timestamp: later, event_type: 'cross_review_read' as const, detail: "read" },
      ] },
      file_coverage: { files_reviewed: 1, files_in_diff: 1, coverage_ratio: 1.0 },
    };
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: artifact as any });
    const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
    const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("INCOMPATIBLE_BLOCKED");
  });
});

/** 构造带有效对抗产物的 review 阶段建议 */
function createReviewArtifact(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 1000).toISOString();
  return {
    independent_verification: [{ command: "tsc --noEmit", actual_output: "compiled successfully with zero type errors in the project", executed_at: now }],
    adversarial_findings: [{ dimension: "completeness", finding: "found a potential issue", disposition: "fixed" }],
    audit_trail: { events: [
      { timestamp: now, event_type: 'review_started' as const, detail: "started" },
      { timestamp: later, event_type: 'cross_review_read' as const, detail: "read" },
    ] },
    file_dispositions: [{ path: "src/app/issue-collaboration/port.ts", status: 'reviewed' as const, issues_found: 0 }],
    cross_review: { peer_conclusion_summary: "ok", my_independent_check: "ok", alignment_or_conflict: "aligned" },
    ci_independence: { source: 'github_api' as const, status: "passed", confirmed_at: now },
    file_coverage: { files_reviewed: 1, files_in_diff: 1, coverage_ratio: 1.0 },
    ...overrides,
  };
}

describe("adversarial artifact validation", () => {
  describe("review stage context", () => {
    it("blocks when pr_url is missing", async () => {
      const deps = createDeps({
        mustGetIssue: mustGetIssueWithContext({ worktree_path: "/wt", branch_name: "feature-x" }),
      });
      const engine = new AutoAdvanceEngine(deps);
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" } });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
      assertContextMissing(deps, ["pr_url"]);
    });

    it("allows when all fields present", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const a2 = { ...createReviewArtifact(), independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: createReviewArtifact() });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
    });
  });

  describe("rev-04 feature numbering validation", () => {
    it("blocks when rev-04 is missing", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed" }, adversarial_artifact: createReviewArtifact() });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("GATE_FAILED");
      expect(result.reasons[0].details?.failed_gates).toContain("rev-04");
    });

    it("blocks when rev-04 has legacy format FYYYYMMDDNN", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F2026070101" }, adversarial_artifact: createReviewArtifact() });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("GATE_FAILED");
      expect(result.reasons[0].details?.failed_gates).toContain("rev-04");
    });

    it("blocks when rev-04 is empty string", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "" }, adversarial_artifact: createReviewArtifact() });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("GATE_FAILED");
      expect(result.reasons[0].details?.failed_gates).toContain("rev-04");
    });

    it("allows when rev-04 has valid format", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: createReviewArtifact() });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
    });
  });

  describe("R1-R3 rejection", () => {
    it("blocks when adversarial_artifact is missing", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" } });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_ARTIFACT_MISSING");
    });

    it("blocks when cross_review_read event is missing", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const artifact = createReviewArtifact({ audit_trail: { events: [{ timestamp: new Date().toISOString(), event_type: 'review_started' as const, detail: "started" }] } });
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: artifact as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
    });

    it("blocks when adversarial_findings is empty array", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const artifact = createReviewArtifact({ adversarial_findings: [] });
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: artifact as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
    });

    it("blocks when actual_output < 20 chars", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const artifact = createReviewArtifact({ independent_verification: [{ command: "tsc", actual_output: "ok", executed_at: new Date().toISOString() }] });
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: artifact as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
    });
  });

  describe("R4-R5 safe field checks", () => {
    it("blocks when file_coverage is missing (R5)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const artifact = { ...createReviewArtifact(), file_coverage: undefined } as any;
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: artifact as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
    });

    it("blocks when cross_review_read timestamp <= review_started", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const later = new Date(Date.now() + 1000).toISOString();
      const now = new Date().toISOString();
      const artifact = createReviewArtifact({ audit_trail: { events: [
        { timestamp: later, event_type: 'review_started' as const, detail: "started" },
        { timestamp: now, event_type: 'cross_review_read' as const, detail: "read" },
      ] } });
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: artifact as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
    });
  });

  describe("R6 cross-speaker similarity (warning, not blocking)", () => {
    it("allows but warns when verification outputs are identical", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const sameOutput = "no errors found in the codebase after running tsc";
      const artifact = createReviewArtifact({ independent_verification: [{ command: "tsc", actual_output: sameOutput, executed_at: new Date().toISOString() }] });
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: artifact as any });
      const s2 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-2", message_id: 2, target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: artifact as any });
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
      expect(result.reasons.some(r => r.code === "R6_SIMILARITY_DETECTED")).toBe(true);
    });

    it("allows but warns when outputs are similar but not identical (>80% LCS)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const outputA = "typescript compilation completed with zero errors across all source files";
      const outputB = "typescript compilation completed with zero errors across all modified files";
      const a1 = createReviewArtifact({ independent_verification: [{ command: "tsc", actual_output: outputA, executed_at: new Date().toISOString() }] });
      const a2 = createReviewArtifact({ independent_verification: [{ command: "tsc", actual_output: outputB, executed_at: new Date().toISOString() }] });
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-2", message_id: 2, target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a2 as any });
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
      expect(result.reasons.some(r => r.code === "R6_SIMILARITY_DETECTED")).toBe(true);
    });

    it("allows without R6 warning when outputs are sufficiently different", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const outputA = "tsc type check passed with no errors in the project";
      const outputB = "all unit tests succeeded with zero failures or skips";
      const a1 = createReviewArtifact({ independent_verification: [{ command: "tsc --noEmit", actual_output: outputA, executed_at: new Date().toISOString() }] });
      const a2 = createReviewArtifact({ independent_verification: [{ command: "npm test", actual_output: outputB, executed_at: new Date().toISOString() }] });
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-2", message_id: 2, target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a2 as any });
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
      expect(result.reasons.some(r => r.code === "R6_SIMILARITY_DETECTED")).toBe(false);
    });
  });
});

describe("R7/R8 adversarial findings validation", () => {
  describe("R7 all-clear warning", () => {
    it("allows but warns when all findings are 'no issues'", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const now = new Date().toISOString();
      const a1 = createReviewArtifact({ adversarial_findings: [{ dimension: "completeness", finding: "no issues", disposition: "none" }] });
      const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: now }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
      const r7Reasons = result.reasons.filter(r => r.code === "R7_ALL_CLEAR_WARNING");
      expect(r7Reasons.length).toBe(2);
      expect(r7Reasons[0].severity).toBe("warning");
    });

    it("does not trigger allClear when findings have real issues with resolved disposition", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const a1 = createReviewArtifact({ adversarial_findings: [
        { dimension: "completeness", finding: "no issues", disposition: "none" },
        { dimension: "correctness", finding: "found bug", disposition: "fixed" },
      ] });
      const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
      const r7Reasons = result.reasons.filter(r => r.code === "R7_ALL_CLEAR_WARNING");
      expect(r7Reasons.length).toBe(0);
    });
  });

  describe("R8 unresolved disposition blocking", () => {
    it("blocks when finding has disposition 'none' (B1)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const a1 = createReviewArtifact({ adversarial_findings: [
        { dimension: "completeness", finding: "found bug", disposition: "none" },
      ] });
      const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
      expect(result.reasons[0].details?.rule).toBe("R8");
    });

    it("blocks when finding has empty string disposition (B2)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const a1 = createReviewArtifact({ adversarial_findings: [
        { dimension: "completeness", finding: "found bug", disposition: "" },
      ] });
      const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
      expect(result.reasons[0].details?.rule).toBe("R8");
    });

    it("allows when all dispositions are resolved (B3)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const a1 = createReviewArtifact({ adversarial_findings: [
        { dimension: "completeness", finding: "found bug", disposition: "在当前 PR 修复" },
      ] });
      const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
    });

    it("skips R8 when finding is 'no issues' even with disposition 'none' (B4)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const a1 = createReviewArtifact({ adversarial_findings: [
        { dimension: "completeness", finding: "no issues", disposition: "none" },
      ] });
      const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
    });

    it("allows when disposition is 'withdrawn' (B5)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const a1 = createReviewArtifact({ adversarial_findings: [
        { dimension: "completeness", finding: "found bug", disposition: "withdrawn" },
      ] });
      const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
    });

    it("R8 blocks when all findings have disposition 'none' and finding !== 'no issues' (B8)", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const a1 = createReviewArtifact({ adversarial_findings: [
        { dimension: "completeness", finding: "found bug A", disposition: "none" },
        { dimension: "correctness", finding: "found bug B", disposition: "none" },
      ] });
      const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
      expect(result.reasons[0].details?.rule).toBe("R8");
    });

    it("R8 does not apply to design stage", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 1000).toISOString();
      const a1 = {
        independent_verification: [{ command: "tsc --noEmit", actual_output: "no errors found after full type check across all modules", executed_at: now }],
        adversarial_findings: [{ dimension: "completeness", finding: "found gap", disposition: "none" }],
        audit_trail: { events: [
          { timestamp: now, event_type: 'review_started' as const, detail: "started" },
          { timestamp: later, event_type: 'cross_review_read' as const, detail: "read" },
        ] },
        critique_obligation: { items: [
          { type: 'risk' as const, content: "risk 1" },
          { type: 'risk' as const, content: "risk 2" },
          { type: 'gap' as const, content: "gap 1" },
          { type: 'alternative' as const, content: "alt 1" },
        ] },
        independent_analysis: { my_conclusion: "ok", comparison_with_peer: "same", points_of_agreement: ["a"], points_of_disagreement: [] },
        scenario_coverage: { scenarios_reviewed: 5, scenarios_identified: 5, coverage_ratio: 1.0, constructed_scenarios: [
          { scenario: "when stage transitions fail mid-flight", question: "should the system auto-retry or escalate?" },
          { scenario: "when two reviewers submit conflicting findings", question: "should developer resolve or escalate?" },
        ] },
      };
      const a2 = { ...a1, independent_verification: [{ command: "npm run lint", actual_output: "zero warnings and zero errors across all source files", executed_at: now }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "architect-1", target_key: "development", gate_evidence: { "design-01": "locked", "design-02": "resolved" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "architect-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "design" }), [s1, s2]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
    });

    it("reports correct count of unresolved findings in R8 message", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      const a1 = createReviewArtifact({ adversarial_findings: [
        { dimension: "completeness", finding: "bug A", disposition: "none" },
        { dimension: "correctness", finding: "bug B", disposition: "" },
        { dimension: "security", finding: "bug C", disposition: "fixed" },
      ] });
      const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
      const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
      const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
      const result = await engine.evaluate(createStage({ key: "review" }), [s1, s2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_VALIDATION_FAILED");
      expect(result.reasons[0].details?.rule).toBe("R8");
      expect(result.reasons[0].message).toContain("2 finding(s)");
    });
  });

  describe("backward compatibility (signal_type inference)", () => {
    it("infers gate_complete when signal_type is missing and no adversarial_artifact", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      // Old format: no signal_type, consensus: true, gate_evidence present
      const oldFormatSuggestion = createSuggestion({
        signal_type: undefined,
        consensus: true, // old agents included this
        gate_evidence: {
          "dev-01": "implemented",
          "dev-02": "check passed",
          "dev-03": "doc updated",
          "dev-04": "PR created",
          "dev-06": "verified",
        },
      });
      const result = await engine.evaluate(createStage({ key: "development" }), [oldFormatSuggestion]);
      expect(deps.advanceStage).toHaveBeenCalled();
      expect(result.action).toBe("auto_advanced");
    });

    it("routes design stage old format signal (consensus: true, no adversarial_artifact) to adversarial path, not gate_complete", async () => {
      const deps = createDeps();
      const engine = new AutoAdvanceEngine(deps);
      // Old format: no signal_type, consensus: true, gate_evidence present, but NO adversarial_artifact
      // This should route to evaluateAdversarialConsensus (not evaluateGateComplete)
      // and be blocked by R1 (missing adversarial_artifact) with ADVERSARIAL_ARTIFACT_MISSING
      const oldFormatSuggestion = createSuggestion({
        signal_type: undefined,
        consensus: true,
        from_speaker: "architect-1",
        target_key: "development",
        gate_evidence: { "design-01": "locked", "design-02": "resolved" },
        // intentionally no adversarial_artifact
      });
      const oldFormatSuggestion2 = { ...oldFormatSuggestion, from_speaker: "architect-2", message_id: 2 };
      const result = await engine.evaluate(createStage({ key: "design" }), [oldFormatSuggestion, oldFormatSuggestion2]);
      expect(deps.advanceStage).not.toHaveBeenCalled();
      expect(result.action).toBe("blocked");
      expect(result.reasons[0].code).toBe("ADVERSARIAL_ARTIFACT_MISSING");
    });
  });
});

describe("decision_mode validation (B3)", () => {
  it("blocks when suggestive mode is missing recommendation", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const suggestion = createSuggestion({
      decision_mode: "suggestive",
      reason: "should proceed",
      alternatives: ["stay", "rollback"],
      // recommendation is missing
    });
    const result = await engine.evaluate(createStage({ key: "development" }), [suggestion]);
    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("SUGGESTIVE_MISSING_RECOMMENDATION");
  });

  it("blocks when suggestive mode is missing reason", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const suggestion = createSuggestion({
      decision_mode: "suggestive",
      recommendation: "proceed to review",
      alternatives: ["stay", "rollback"],
      reason: "", // empty reason
    });
    const result = await engine.evaluate(createStage({ key: "development" }), [suggestion]);
    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("SUGGESTIVE_MISSING_REASON");
  });

  it("blocks when suggestive mode is missing alternatives", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const suggestion = createSuggestion({
      decision_mode: "suggestive",
      recommendation: "proceed to review",
      // alternatives is missing
    });
    const result = await engine.evaluate(createStage({ key: "development" }), [suggestion]);
    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("SUGGESTIVE_MISSING_ALTERNATIVES");
  });

  it("blocks when suggestive mode has empty alternatives array", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const suggestion = createSuggestion({
      decision_mode: "suggestive",
      recommendation: "proceed to review",
      alternatives: [],
    });
    const result = await engine.evaluate(createStage({ key: "development" }), [suggestion]);
    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("SUGGESTIVE_MISSING_ALTERNATIVES");
  });

  it("blocks when suggestive + disagreement combination", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const suggestion = createSuggestion({
      signal_type: "disagreement",
      decision_mode: "suggestive",
      recommendation: "proceed",
      reason: "done",
      alternatives: ["stay"],
      consensus: false,
    });
    const result = await engine.evaluate(createStage({ key: "development" }), [suggestion]);
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("INVALID_DECISION_MODE_COMBINATION");
  });

  it("allows autonomous mode without recommendation/reason/alternatives", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const suggestion = createSuggestion({ decision_mode: "autonomous" });
    const result = await engine.evaluate(createStage({ key: "development" }), [suggestion]);
    expect(deps.advanceStage).toHaveBeenCalled();
    expect(result.action).toBe("auto_advanced");
  });

  it("defaults to autonomous when decision_mode is missing (backward compat)", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const suggestion = createSuggestion({ decision_mode: undefined });
    const result = await engine.evaluate(createStage({ key: "development" }), [suggestion]);
    expect(deps.advanceStage).toHaveBeenCalled();
    expect(result.action).toBe("auto_advanced");
  });

  it("allows suggestive mode with all required fields for gate_complete", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const suggestion = createSuggestion({
      decision_mode: "suggestive",
      recommendation: "proceed to review",
      reason: "all gates passed",
      alternatives: ["stay in development", "rollback"],
    });
    const result = await engine.evaluate(createStage({ key: "development" }), [suggestion]);
    expect(deps.advanceStage).toHaveBeenCalled();
    expect(result.action).toBe("auto_advanced");
  });
});

describe("evaluateAdvance (L2 manual advance gate)", () => {
  it("returns blocked when R8 would block (unresolved findings)", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const a1 = createReviewArtifact({ adversarial_findings: [
      { dimension: "completeness", finding: "found bug", disposition: "none" },
    ] });
    const a2 = { ...a1, independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: a1 as any });
    const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 as any };
    const result = await engine.evaluateAdvance(createStage({ key: "review" }), [s1, s2]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].details?.rule).toBe("R8");
  });

  it("returns auto_advanced when all checks pass but does NOT call advanceStage", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const a2 = { ...createReviewArtifact(), independent_verification: [{ command: "npm test", actual_output: "all seventeen tests passed with no failures or skips", executed_at: new Date().toISOString() }] };
    const s1 = createSuggestion({ signal_type: "adversarial_consensus", consensus: true, from_speaker: "reviewer-1", target_key: "merge", gate_evidence: { "rev-01": "done", "rev-02": "verified", "rev-03": "signed", "rev-04": "F20260701tj92" }, adversarial_artifact: createReviewArtifact() });
    const s2 = { ...s1, from_speaker: "reviewer-2", message_id: 2, adversarial_artifact: a2 };
    const result = await engine.evaluateAdvance(createStage({ key: "review" }), [s1, s2]);

    expect(result.action).toBe("auto_advanced");
    expect(deps.advanceStage).not.toHaveBeenCalled();
  });

  it("returns blocked when gate_evidence is missing (gate_complete)", async () => {
    const deps = createDeps();
    const engine = new AutoAdvanceEngine(deps);
    const result = await engine.evaluateAdvance(createStage({ key: "development" }), [createSuggestion({
      gate_evidence: { "dev-01": "implemented" },
    })]);

    expect(deps.advanceStage).not.toHaveBeenCalled();
    expect(result.action).toBe("blocked");
    expect(result.reasons[0].code).toBe("GATE_FAILED");
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
