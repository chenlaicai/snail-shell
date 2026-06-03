import assert from "assert";
import { resolveSnailDisplayName, type CollaborationDeps } from "../../src/workspace-workflow/manager-collaboration";
import type { RoleDefinition } from "../../src/roles";
import type { CollaborationInvocationOptions } from "../../src/message-bus/collaboration";
import type { SnailTemplate } from "../../src/snail-den";

/**
 * resolveSnailDisplayName 单元测试。
 *
 * 验证注入链路：activeRole.snail_template_id → SnailDen.getTemplate().name → 系统提示词。
 * 签名漂移的根因是该值从未注入，此测试防止回归。
 */

function mockDeps(getTemplateResult?: SnailTemplate): CollaborationDeps {
  return {
    store: {} as never,
    roleRegistry: {} as never,
    systemAI: {} as never,
    snailDen: {
      getTemplate: () => getTemplateResult,
    },
  } as unknown as CollaborationDeps;
}

function mockRole(snailTemplateId?: string): RoleDefinition {
  return {
    id: "role-1",
    stage_definition_id: "sd-1",
    key: "developer",
    name: "研发者",
    description: "test role",
    snail_template_id: snailTemplateId ?? null,
    is_primary: 1,
    count: 1,
    content: null,
    working_rules: [],
  };
}

function mockOptions(overrides?: Partial<CollaborationInvocationOptions>): CollaborationInvocationOptions {
  return {
    activeRoleName: "研发者",
    remainingRounds: 10,
    mentionAllowed: true,
    forcedWrapUp: false,
    runtime: "claude-code-cli",
    ...overrides,
  };
}

function testTemplateExists(): void {
  const template: SnailTemplate = {
    id: "claude-code-stateful",
    name: "Claude Code Stateful + Sonnet",
    runtime: "claude-code" as never,
    model: "sonnet",
    contextProvider: "shell",
  };
  const result = resolveSnailDisplayName(mockDeps(template), mockRole("claude-code-stateful"), mockOptions());
  assert.strictEqual(result, "Claude Code Stateful + Sonnet");
}

function testTemplateNotFoundFallsBackToOptions(): void {
  const deps = mockDeps(undefined); // getTemplate returns undefined
  const result = resolveSnailDisplayName(deps, mockRole("nonexistent"), mockOptions({ snailDisplayName: "fallback-name" }));
  assert.strictEqual(result, "fallback-name");
}

function testNoTemplateIdFallsBackToOptions(): void {
  const result = resolveSnailDisplayName(mockDeps(), mockRole(undefined), mockOptions({ snailDisplayName: "from-options" }));
  assert.strictEqual(result, "from-options");
}

function testNoTemplateIdNoOptionsFallsBackToRuntime(): void {
  const result = resolveSnailDisplayName(mockDeps(), mockRole(undefined), mockOptions({ runtime: "opencode-cli" }));
  assert.strictEqual(result, "opencode-cli");
}

function testAllEmptyFallsBackToUnknown(): void {
  const result = resolveSnailDisplayName(mockDeps(), mockRole(undefined), mockOptions({ runtime: undefined }));
  assert.strictEqual(result, "unknown");
}

function testUndefinedActiveRoleFallsBack(): void {
  const result = resolveSnailDisplayName(mockDeps(), undefined, mockOptions({ snailDisplayName: "role-undefined-fallback" }));
  assert.strictEqual(result, "role-undefined-fallback");
}

main();

function main(): void {
  testTemplateExists();
  testTemplateNotFoundFallsBackToOptions();
  testNoTemplateIdFallsBackToOptions();
  testNoTemplateIdNoOptionsFallsBackToRuntime();
  testAllEmptyFallsBackToUnknown();
  testUndefinedActiveRoleFallsBack();
  console.log("resolve-snail-display-name tests passed");
}
