import { describe, it, expect } from "vitest";
import { SystemPromptBuilder } from "@app/issue-collaboration/_internal/system-prompt-builder";
import type { Issue, Stage } from "@domain/issue/model";
import type { Sop, StageDefinition, RoleDefinition } from "@domain/sop/model";
import { Scope } from "@domain/workspace/model";
import type { MessagePort } from "@domain/message/port";
import type { SnailPort } from "@domain/snail/port";
import type { StagePort } from "@domain/issue/port";
import type { Snail } from "@domain/snail/model";

function makeSnail(): Snail {
  return { key: "test-snail", name: "Test Snail", agent_name: "test-agent", model: "test-model" };
}

function makeRoleDef(): RoleDefinition {
  return { key: "reviewer", name: "审查者", description: "", is_primary: true, count: 1, skill: "cd-review", prohibition: null, self_check: null };
}

function makeStageDef(key: string, roleDef: RoleDefinition): StageDefinition {
  return { key, title: `Stage ${key}`, description: "", roles: [roleDef] };
}

function makeSop(stageDefs: StageDefinition[]): Sop {
  return {
    key: "code-delivery",
    name: "Code Delivery",
    description: null,
    shared_skill: "cd-shared",
    stage_definitions: stageDefs,
    transitions: [],
    scope: Scope.Platform,
  };
}

function makeStage(overrides: Partial<Stage> & Pick<Stage, "id" | "key">): Stage {
  return {
    workspace_path: "/ws",
    issue_id: "issue-1",
    title: `Stage ${overrides.key}`,
    description: "",
    default_role_instance: "reviewer-1",
    role_instances: ["reviewer-1"],
    from_stage_id: null,
    available_transitions: [],
    output_artifacts: {},
    entered_at: "2026-07-08T10:00:00Z",
    left_at: null,
    ...overrides,
  };
}

function makeIssue(context: Record<string, string>, stageDefs: StageDefinition[]): Issue {
  return {
    id: "issue-1",
    workspace_path: "/ws",
    title: "Test Issue",
    summary: "Test summary",
    sop_snapshot: makeSop(stageDefs),
    snail_assignment_plan: { stages: {} } as never,
    context,
    created_at: "2026-07-08T10:00:00Z",
    closed_at: null,
    close_summary: null,
  };
}

function createMockMessagePort(): MessagePort {
  return {
    createMessage: () => ({ id: 1, stage_id: "s1", from_speaker: null, to_speakers: [], status: "streaming", created_at: "", ended_at: null }),
    getMessage: () => undefined,
    listMessages: () => [],
    listMessagesWindow: () => [],
    searchByFts: () => [],
    searchContext: () => [],
    listMessagesByStatus: () => [],
    updateMessageTargets: () => {},
    completeMessage: () => {},
    appendEvent: () => ({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
    getMessageEvents: () => [],
    getContext: () => null,
    setContext: () => {},
    getCursor: () => 0,
    advanceCursor: () => {},
    getUnreadMessages: () => [],
    initCursor: () => {},
    findLatestRespondingSpeaker: () => null,
    findLatestMessage: () => undefined,
    findLatestMessageByIssueId: () => undefined,
    findLatestMessageBySpeaker: () => undefined,
  } as MessagePort;
}

function createMockStagePort(stages: Stage[]): StagePort {
  return {
    findStage: (id: string) => stages.find(s => s.id === id),
    listStages: () => stages,
    listOpenStageIds: () => [],
    listAllOpenStageIds: () => [],
    previewStage: () => undefined,
  } as unknown as StagePort;
}

function createMockSnailPort(): Pick<SnailPort, "findByKey"> {
  return { findByKey: () => makeSnail() };
}

function buildBuilder(stages: Stage[]) {
  return new SystemPromptBuilder({
    messagePort: createMockMessagePort(),
    snailPort: createMockSnailPort(),
    stagePort: createMockStagePort(stages),
  });
}

describe("SystemPromptBuilder - re-review hint", () => {
  const roleDef = makeRoleDef();
  const stageDef = makeStageDef("review", roleDef);

  it("injects re-review hint when re-entering review stage with review_comment_url in context", () => {
    /** First review stage (completed) -> second review stage (current, re-entry) */
    const firstReview = makeStage({ id: "s1", key: "review", from_stage_id: null, left_at: "2026-07-08T11:00:00Z" });
    const secondReview = makeStage({ id: "s2", key: "review", from_stage_id: "s1" });
    const issue = makeIssue(
      { review_comment_url: "https://github.com/owner/repo/pull/1#issuecomment-999" },
      [stageDef],
    );
    const builder = buildBuilder([firstReview, secondReview]);

    const result = builder.buildSystemReminder({
      issue,
      stage: secondReview,
      roleInstance: "审查者-1",
      roleKey: "reviewer",
      snailKey: "test-snail",
    });

    expect(result).toContain("复检提示");
    expect(result).toContain("检测到重新进入 review 阶段");
    expect(result).toContain("https://github.com/owner/repo/pull/1#issuecomment-999");
    expect(result).toContain("发布新的 PR 评论");
  });

  it("does not inject re-review hint on first entry to review stage", () => {
    const firstReview = makeStage({ id: "s1", key: "review", from_stage_id: null });
    const issue = makeIssue({}, [stageDef]);
    const builder = buildBuilder([firstReview]);

    const result = builder.buildSystemReminder({
      issue,
      stage: firstReview,
      roleInstance: "审查者-1",
      roleKey: "reviewer",
      snailKey: "test-snail",
    });

    expect(result).not.toContain("复检提示");
  });

  it("does not inject re-review hint when re-entering non-review stage", () => {
    /** Re-entering development stage (not review) */
    const firstDev = makeStage({ id: "s1", key: "development", from_stage_id: null, left_at: "2026-07-08T11:00:00Z" });
    const secondDev = makeStage({ id: "s2", key: "development", from_stage_id: "s1" });
    const devStageDef = makeStageDef("development", roleDef);
    const issue = makeIssue(
      { review_comment_url: "https://github.com/owner/repo/pull/1#issuecomment-999" },
      [devStageDef],
    );
    const builder = buildBuilder([firstDev, secondDev]);

    const result = builder.buildSystemReminder({
      issue,
      stage: secondDev,
      roleInstance: "开发者",
      roleKey: "reviewer",
      snailKey: "test-snail",
    });

    expect(result).not.toContain("复检提示");
  });

  it("does not inject re-review hint when re-entering review but review_comment_url is absent", () => {
    const firstReview = makeStage({ id: "s1", key: "review", from_stage_id: null, left_at: "2026-07-08T11:00:00Z" });
    const secondReview = makeStage({ id: "s2", key: "review", from_stage_id: "s1" });
    const issue = makeIssue({}, [stageDef]);
    const builder = buildBuilder([firstReview, secondReview]);

    const result = builder.buildSystemReminder({
      issue,
      stage: secondReview,
      roleInstance: "审查者-1",
      roleKey: "reviewer",
      snailKey: "test-snail",
    });

    expect(result).not.toContain("复检提示");
  });
});
