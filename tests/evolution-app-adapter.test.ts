import { describe, it, expect, vi } from "vitest";
import { EvolutionAppAdapter } from "@app/evolution/_internal/adapter";
import type { EvolutionPort } from "@domain/evolution/port";
import type { EvolutionItem } from "@domain/evolution/model";
import { EvolutionStatus } from "@domain/evolution/model";
import type { CollaborationInput } from "@app/issue-collaboration/port";
import type { IssuePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";

function createMockEvolutionPort(overrides: Partial<EvolutionPort> = {}): EvolutionPort {
  return {
    findById: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

function createMockCollaborationInput(overrides: Partial<CollaborationInput> = {}): CollaborationInput {
  return {
    createIssue: vi.fn(),
    sendMessage: vi.fn(),
    interruptMessage: vi.fn(),
    registerIssueConsumer: vi.fn(),
    unregisterIssueConsumer: vi.fn(),
    registerWorkspaceConsumer: vi.fn(),
    unregisterWorkspaceConsumer: vi.fn(),
    listStageTransitionSuggestions: vi.fn(),
    dismissSuggestion: vi.fn(),
    advanceStage: vi.fn(),
    forceAdvance: vi.fn(),
    rollbackStage: vi.fn(),
    getStageAuditTrail: vi.fn(),
    closeIssue: vi.fn(),
    isInvoking: vi.fn(),
    getActivityStatus: vi.fn(),
    resumeRoute: vi.fn(),
    restoreSuggestions: vi.fn(),
    evaluateAdvance: vi.fn(),
    ...overrides,
  };
}

function createMockIssuePort(overrides: Partial<IssuePort> = {}): IssuePort {
  return {
    findIssue: vi.fn(),
    listIssues: vi.fn(),
    previewSopStages: vi.fn().mockReturnValue([
      {
        key: "design",
        name: "Design",
        role_instances: [{ role_instance: "architect" }],
      },
      {
        key: "development",
        name: "Development",
        role_instances: [{ role_instance: "developer" }],
      },
    ]),
    validateSnailAssignmentPlan: vi.fn(),
    updateContext: vi.fn(),
    closeIssue: vi.fn(),
    updateCloseSummary: vi.fn(),
    ...overrides,
  };
}

function createMockSnailPort(overrides: Partial<SnailPort> = {}): SnailPort {
  return {
    list: vi.fn().mockReturnValue([{ key: "snail-1", name: "Snail 1" }]),
    findByKey: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    invokeFirstCall: vi.fn(),
    invokeResume: vi.fn(),
    ...overrides,
  };
}

function createCandidateItem(overrides: Partial<EvolutionItem> = {}): EvolutionItem {
  return {
    id: "evo-1",
    workspace_id: "/workspace",
    status: EvolutionStatus.Candidate,
    issue_id: null,
    title: "Test Evolution",
    content: "Test content",
    tags: [],
    result: null,
    metadata: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("EvolutionAppAdapter", () => {
  describe("createIssueFromItem", () => {
    it("creates issue and updates evolution item with issue_id", async () => {
      const item = createCandidateItem();
      const updatedItem = { ...item, status: EvolutionStatus.InProgress, issue_id: "issue-1" };

      const updateSpy = vi.fn().mockReturnValue(updatedItem);
      const evolutionPort = createMockEvolutionPort({
        findById: vi.fn().mockReturnValue(item),
        update: updateSpy,
      });

      const createIssueSpy = vi.fn().mockResolvedValue({
        issue: { id: "issue-1" },
        stage: { id: "stage-1" },
      });
      const collaboration = createMockCollaborationInput({
        createIssue: createIssueSpy,
      });

      const issuePort = createMockIssuePort();
      const snailPort = createMockSnailPort();

      const adapter = new EvolutionAppAdapter(evolutionPort, collaboration, issuePort, snailPort);
      const result = await adapter.createIssueFromItem("evo-1");

      // Verify update was called with issue_id
      expect(updateSpy).toHaveBeenCalled();
      const updateCall = updateSpy.mock.calls[0];
      expect(updateCall[0]).toBe("evo-1");
      expect(updateCall[1].status).toBe(EvolutionStatus.InProgress);
      expect(updateCall[1].issue_id).toBe("issue-1");

      // Verify createIssue was called with correct input
      expect(createIssueSpy).toHaveBeenCalled();
      const createIssueCall = createIssueSpy.mock.calls[0][0];
      expect(createIssueCall.workspace_path).toBe("/workspace");
      expect(createIssueCall.title).toBe("[Evolution] Test Evolution");
      expect(createIssueCall.summary).toBe("Test content");
      expect(createIssueCall.adopted_sop_key).toBe("evolution");

      // Verify result
      expect(result).toEqual(updatedItem);
    });

    it("throws if item not found", async () => {
      const evolutionPort = createMockEvolutionPort({
        findById: vi.fn().mockReturnValue(undefined),
      });

      const adapter = new EvolutionAppAdapter(
        evolutionPort,
        createMockCollaborationInput(),
        createMockIssuePort(),
        createMockSnailPort(),
      );

      await expect(adapter.createIssueFromItem("nonexistent")).rejects.toThrow(
        "Evolution item not found: nonexistent",
      );
    });

    it("throws if item is not in candidate status", async () => {
      const item = createCandidateItem({ status: EvolutionStatus.InProgress });
      const evolutionPort = createMockEvolutionPort({
        findById: vi.fn().mockReturnValue(item),
      });

      const adapter = new EvolutionAppAdapter(
        evolutionPort,
        createMockCollaborationInput(),
        createMockIssuePort(),
        createMockSnailPort(),
      );

      await expect(adapter.createIssueFromItem("evo-1")).rejects.toThrow(
        'Cannot create issue for item in status "in_progress", must be "candidate"',
      );
    });

    it("throws if no snails configured", async () => {
      const item = createCandidateItem();
      const evolutionPort = createMockEvolutionPort({
        findById: vi.fn().mockReturnValue(item),
      });

      const snailPort = createMockSnailPort({
        list: vi.fn().mockReturnValue([]),
      });

      const adapter = new EvolutionAppAdapter(
        evolutionPort,
        createMockCollaborationInput(),
        createMockIssuePort(),
        snailPort,
      );

      await expect(adapter.createIssueFromItem("evo-1")).rejects.toThrow(
        "Cannot create evolution issue without configured snails",
      );
    });
  });
});
