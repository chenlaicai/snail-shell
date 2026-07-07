import { describe, it, expect, vi } from "vitest";
import { createSnailIssueContextServer } from "@domain/snail-mcp-server/_internal/servers/snail-issue-context";
import type { IssuePort } from "@domain/issue/port";
import type { IssueManagementPort } from "@domain/snail-mcp-server/port";
import type { Issue, Stage } from "@domain/issue/model";
import { Scope } from "@domain/workspace/model";

function createMockIssuePort(overrides: Partial<IssuePort> = {}): IssuePort {
  return {
    findIssue: vi.fn(),
    listIssues: vi.fn(),
    previewSopStages: vi.fn(),
    validateSnailAssignmentPlan: vi.fn(),
    updateContext: vi.fn(),
    closeIssue: vi.fn(),
    updateCloseSummary: vi.fn(),
    ...overrides,
  };
}

function createMockIssueManagement(overrides: Partial<IssueManagementPort> = {}): IssueManagementPort {
  return {
    spawnIssue: vi.fn(),
    ...overrides,
  };
}

function createIssue(): Issue {
  return {
    id: "new-issue-1",
    workspace_path: "/workspace",
    title: "New Issue",
    summary: null,
    sop_snapshot: { key: "code-delivery", name: "Code Delivery", description: null, shared_skill: null, stage_definitions: [], transitions: [], scope: Scope.Workspace },
    snail_assignment_plan: {},
    context: {},
    created_at: new Date().toISOString(),
    closed_at: null,
    close_summary: null,
  };
}

function createStage(): Stage {
  return {
    id: "s1",
    workspace_path: "/workspace",
    issue_id: "new-issue-1",
    key: "design",
    title: "Design",
    description: "",
    default_role_instance: "architect-1",
    role_instances: ["architect-1"],
    from_stage_id: null,
    available_transitions: [],
    output_artifacts: {},
    entered_at: new Date().toISOString(),
    left_at: null,
  };
}

describe("create_issue handler", () => {
  function getHandler(issueManagement: IssueManagementPort) {
    const server = createSnailIssueContextServer(createMockIssuePort(), issueManagement);
    const tool = server.tools.find(t => t.name === "create_issue");
    if (!tool) throw new Error("create_issue tool not found");
    return tool.handler;
  }

  it("B1: 全参数调用 — 调用 spawnIssue 并返回结果", async () => {
    const issue = createIssue();
    const stage = createStage();
    const spawnIssueSpy = vi.fn().mockResolvedValue({ issue, stage });
    const handler = getHandler(createMockIssueManagement({ spawnIssue: spawnIssueSpy }));

    const result = await handler({
      workspace_path: "/workspace",
      title: "New Issue",
      sop_key: "code-delivery",
      summary: "继承上下文",
      source_issue_id: "source-issue-1",
    });

    expect(spawnIssueSpy).toHaveBeenCalled();
    const callArg = spawnIssueSpy.mock.calls[0][0];
    expect(callArg.workspace_path).toBe("/workspace");
    expect(callArg.title).toBe("New Issue");
    expect(callArg.summary).toBe("继承上下文");
    expect(callArg.adopted_sop_key).toBe("code-delivery");
    expect(callArg.source_issue_id).toBe("source-issue-1");
    expect(result).toEqual({
      issue_id: "new-issue-1",
      issue_title: "New Issue",
      stage_id: "s1",
      stage_key: "design",
    });
  });

  it("B4: 不传 source_issue_id — spawnIssue 收到 undefined", async () => {
    const issue = createIssue();
    const stage = createStage();
    const spawnIssueSpy = vi.fn().mockResolvedValue({ issue, stage });
    const handler = getHandler(createMockIssueManagement({ spawnIssue: spawnIssueSpy }));

    await handler({
      workspace_path: "/workspace",
      title: "Independent Issue",
      sop_key: "general-assistant",
    });

    expect(spawnIssueSpy).toHaveBeenCalled();
    const callArg = spawnIssueSpy.mock.calls[0][0];
    expect(callArg.workspace_path).toBe("/workspace");
    expect(callArg.title).toBe("Independent Issue");
    expect(callArg.summary).toBeUndefined();
    expect(callArg.adopted_sop_key).toBe("general-assistant");
    expect(callArg.source_issue_id).toBeUndefined();
  });

  it("B5: 不传 summary — spawnIssue 收到 undefined", async () => {
    const issue = createIssue();
    const stage = createStage();
    const spawnIssueSpy = vi.fn().mockResolvedValue({ issue, stage });
    const handler = getHandler(createMockIssueManagement({ spawnIssue: spawnIssueSpy }));

    await handler({
      workspace_path: "/workspace",
      title: "No Summary",
      sop_key: "code-delivery",
      source_issue_id: "source-1",
    });

    expect(spawnIssueSpy.mock.calls[0][0].summary).toBeUndefined();
  });

  it("spawnIssue 抛错时透传错误", async () => {
    const spawnIssueSpy = vi.fn().mockRejectedValue(new Error("No snail available in the den"));
    const handler = getHandler(createMockIssueManagement({ spawnIssue: spawnIssueSpy }));

    await expect(handler({
      workspace_path: "/workspace",
      title: "Test",
      sop_key: "code-delivery",
    })).rejects.toThrow("No snail available in the den");
  });
});
