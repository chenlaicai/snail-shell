import assert from "assert";
import fs from "fs";
import path from "path";
import os from "os";
import { loadProjectPrompts, mergePrompts, listPrompts, type PromptDocument } from "../../src/prompt-center";
import { resolveHandbookRef } from "../../src/prompt-center/builder";
import { PLATFORM_ROOT, PLATFORM_META } from "../../src/shared/platform-paths";

function createTempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "snail-overlay-test-"));
}

function writePromptFile(dir: string, filename: string, id: string, title: string, stability: string, body: string): void {
  const content = `---\nid: ${id}\ntitle: ${title}\nstability: ${stability}\n---\n\n${body}`;
  fs.writeFileSync(path.join(dir, filename), content, "utf8");
}

// ── P1: loadProjectPrompts ──

function testLoadProjectPromptsNonexistentDir(): void {
  const result = loadProjectPrompts("/nonexistent/path");
  assert.deepStrictEqual(result, [], "should return empty array when .snail/prompts/ doesn't exist");
}

function testLoadProjectPromptsEmptyDir(): void {
  const projectRoot = createTempProjectDir();
  fs.mkdirSync(path.join(projectRoot, ".snail", "prompts"), { recursive: true });
  const result = loadProjectPrompts(projectRoot);
  assert.deepStrictEqual(result, [], "should return empty array when .snail/prompts/ is empty");
  fs.rmSync(projectRoot, { recursive: true });
}

function testLoadProjectPromptsWithPrompts(): void {
  const projectRoot = createTempProjectDir();
  const promptsDir = path.join(projectRoot, ".snail", "prompts");
  fs.mkdirSync(promptsDir, { recursive: true });

  writePromptFile(promptsDir, "P-01-custom-handbook.md", "P-01", "Custom Handbook", "static", "## Custom Handbook\n\nProject-specific handbook content.");

  const result = loadProjectPrompts(projectRoot);
  assert.strictEqual(result.length, 1, "should load 1 prompt from project overlay");
  assert.strictEqual(result[0].id, "P-01");
  assert.strictEqual(result[0].title, "Custom Handbook");
  assert.strictEqual(result[0].stability, "static");
  assert(result[0].content.includes("Project-specific handbook content"), "content should include body text");
  assert(result[0].filePath.includes(".snail"), "filePath should reference .snail directory");

  fs.rmSync(projectRoot, { recursive: true });
}

function testLoadProjectPromptsDefaultStability(): void {
  const projectRoot = createTempProjectDir();
  const promptsDir = path.join(projectRoot, ".snail", "prompts");
  fs.mkdirSync(promptsDir, { recursive: true });

  const content = `---\nid: P-02\ntitle: No Stability\n---\n\n## Body\n\nNo stability field.`;
  fs.writeFileSync(path.join(promptsDir, "P-02-no-stability.md"), content, "utf8");

  const result = loadProjectPrompts(projectRoot);
  assert.strictEqual(result[0].stability, "static", "stability should default to static when not specified");

  fs.rmSync(projectRoot, { recursive: true });
}

function testLoadProjectPromptsSkipsTemplates(): void {
  const projectRoot = createTempProjectDir();
  const promptsDir = path.join(projectRoot, ".snail", "prompts");
  fs.mkdirSync(promptsDir, { recursive: true });

  writePromptFile(promptsDir, "P-01-real.md", "P-01", "Real", "static", "## Real\n\nReal content.");
  fs.writeFileSync(path.join(promptsDir, "_template-prompt.md"), "template content", "utf8");
  fs.writeFileSync(path.join(promptsDir, "something.template"), "template content", "utf8");

  const result = loadProjectPrompts(projectRoot);
  assert.strictEqual(result.length, 1, "should skip template files");
  assert.strictEqual(result[0].id, "P-01");

  fs.rmSync(projectRoot, { recursive: true });
}

// ── P1: mergePrompts ──

function testMergePromptsNoOverlap(): void {
  const global: PromptDocument[] = [
    { id: "S-03", title: "Global Dev", stability: "static", content: "global dev", filePath: "/g/S-03.md" },
  ];
  const project: PromptDocument[] = [
    { id: "P-01", title: "Project Custom", stability: "static", content: "project custom", filePath: "/p/P-01.md" },
  ];
  const merged = mergePrompts(global, project);
  assert.strictEqual(merged.length, 2, "merged should have both prompts");
  assert(merged.some((p) => p.id === "S-03"), "should contain global prompt");
  assert(merged.some((p) => p.id === "P-01"), "should contain project prompt");
}

function testMergePromptsOverride(): void {
  const global: PromptDocument[] = [
    { id: "S-03", title: "Global Dev", stability: "static", content: "global content", filePath: "/g/S-03.md" },
    { id: "S-04", title: "Global Review", stability: "static", content: "review content", filePath: "/g/S-04.md" },
  ];
  const project: PromptDocument[] = [
    { id: "S-03", title: "Project Dev", stability: "dynamic", content: "project content", filePath: "/p/S-03.md" },
  ];
  const merged = mergePrompts(global, project);
  assert.strictEqual(merged.length, 2, "should not duplicate same-ID prompts");
  const s03 = merged.find((p) => p.id === "S-03")!;
  assert.strictEqual(s03.title, "Project Dev", "project should override global on same ID");
  assert.strictEqual(s03.stability, "dynamic", "override should carry project's stability");
  assert.strictEqual(s03.content, "project content", "override should carry project's content");
  const s04 = merged.find((p) => p.id === "S-04")!;
  assert.strictEqual(s04.title, "Global Review", "non-overridden global prompt should remain");
}

function testMergePromptsEmptyProject(): void {
  const global = listPrompts();
  const merged = mergePrompts(global, []);
  assert.strictEqual(merged.length, global.length, "merging with empty project should return all global prompts");
}

// ── P1: resolveHandbookRef ──

function testResolveHandbookRefGlobalScope(): void {
  assert.strictEqual(resolveHandbookRef("global:S-03"), "S-03", "should extract ID from global: prefix");
}

function testResolveHandbookRefProjectScope(): void {
  assert.strictEqual(resolveHandbookRef("project:P-01"), "P-01", "should extract ID from project: prefix");
}

function testResolveHandbookRefBareId(): void {
  assert.strictEqual(resolveHandbookRef("S-03"), "S-03", "bare ID should pass through");
}

function testResolveHandbookRefNull(): void {
  assert.strictEqual(resolveHandbookRef(null), null, "null should return null");
  assert.strictEqual(resolveHandbookRef(undefined), null, "undefined should return null");
  assert.strictEqual(resolveHandbookRef(""), null, "empty string should return null");
}

// ── P2: platform paths ──

function testPlatformRootExists(): void {
  assert(typeof PLATFORM_ROOT === "string" && PLATFORM_ROOT.length > 0, "PLATFORM_ROOT should be a non-empty string");
  assert(fs.existsSync(PLATFORM_ROOT), "PLATFORM_ROOT should point to an existing directory");
}

function testPlatformMetaDerived(): void {
  assert.strictEqual(PLATFORM_META, path.join(PLATFORM_ROOT, ".meta"), "PLATFORM_META should be PLATFORM_ROOT/.meta");
}

// ── Run ──

testLoadProjectPromptsNonexistentDir();
testLoadProjectPromptsEmptyDir();
testLoadProjectPromptsWithPrompts();
testLoadProjectPromptsDefaultStability();
testLoadProjectPromptsSkipsTemplates();
testMergePromptsNoOverlap();
testMergePromptsOverride();
testMergePromptsEmptyProject();
testResolveHandbookRefGlobalScope();
testResolveHandbookRefProjectScope();
testResolveHandbookRefBareId();
testResolveHandbookRefNull();
testPlatformRootExists();
testPlatformMetaDerived();

console.log("project-overlay tests passed");
