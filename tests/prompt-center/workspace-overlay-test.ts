import assert from "assert";
import fs from "fs";
import path from "path";
import os from "os";
import { mergePrompts, listPrompts, assembleSystemPrompt, type PromptDocument, type PromptLayer } from "../../src/prompt-center";
import { loadWorkspaceContext } from "../../src/workspace-workflow";
import { resolveHandbookRef, type HandbookRef } from "../../src/prompt-center/builder";
import { PLATFORM_ROOT, PLATFORM_META } from "../../src/shared/platform-paths";

function mp(id: string, title: string, layer: PromptLayer, priority: number, stability: "static"|"dynamic", content: string): PromptDocument {
  return { id, title, layer, priority, stability, content, filePath: `/fake/${id}.md` };
}

function createTemp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "snail-ov-")); }

function testLoadNonexistent(): void {
  try { loadWorkspaceContext("/nonexist"); assert.fail("should throw"); }
  catch (e) { assert(e instanceof Error && e.message.includes(".snail directory not found")); }
}

function testLoadEmpty(): void {
  const r = createTemp(); fs.mkdirSync(path.join(r, ".snail", "prompts"), { recursive: true });
  fs.writeFileSync(path.join(r, ".snail", "workspace.json"), JSON.stringify({ name: "Test" }));
  assert.deepStrictEqual(loadWorkspaceContext(r, { loadSopDefinitions: false }).prompts, []);
  fs.rmSync(r, { recursive: true });
}

function testLoadWithPrompts(): void {
  const r = createTemp(); const d = path.join(r, ".snail", "prompts");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(r, ".snail", "workspace.json"), JSON.stringify({ name: "Test" }));
  fs.writeFileSync(path.join(d, "P-01-custom.md"), '---\nid: P-01\ntitle: Custom\nlayer: workspace\npriority: 10\nstability: static\n---\n\n## C\n\ncontent.');
  const res = loadWorkspaceContext(r, { loadSopDefinitions: false }).prompts;
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, "P-01");
  assert.strictEqual(res[0].layer, "workspace");
  assert.strictEqual(res[0].priority, 10);
  fs.rmSync(r, { recursive: true });
}

function testMergeNoOverlap(): void {
  const m = mergePrompts([mp("S-03","G","sop",70,"static","g")], [mp("P-01","P","workspace",10,"static","p")]);
  assert.strictEqual(m.length, 2);
  assert(m.some(x => x.id === "S-03"));
  assert(m.some(x => x.id === "P-01"));
}

function testMergeOverride(): void {
  const m = mergePrompts(
    [mp("S-03","G","sop",70,"static","g"), mp("S-04","GR","sop",70,"static","gr")],
    [mp("S-03","P","workspace",10,"dynamic","p")]
  );
  assert.strictEqual(m.length, 2);
  assert.strictEqual(m.find(x=>x.id==="S-03")!.title, "P");
}

function testResolveHandbook(): void {
  const r = resolveHandbookRef("global:S-03") as HandbookRef;
  assert.strictEqual(r.id, "S-03"); assert.strictEqual(r.scope, "global");
  assert.strictEqual(resolveHandbookRef(null), null);
  assert.strictEqual(resolveHandbookRef(""), null);
}

function testWorkspaceScopeNoFallback(): void {
  const ref = resolveHandbookRef("workspace:S-03") as HandbookRef;
  assert.strictEqual(ref.scope, "workspace");
  const found = (ref.scope==="workspace"?[] as PromptDocument[]:[]).find(p=>p.id===ref.id);
  assert.strictEqual(found, undefined);
}

function testAssembleUsesMerge(): void {
  const ap = listPrompts();
  const ovr = mp("B-01","Override","platform",10,"static","## O\n\nOVERRIDDEN");
  const merged = mergePrompts(ap, [ovr]).filter(p=>p.id!=="S-05"&&p.id!=="S-06");
  const r = assembleSystemPrompt({prompts:merged,matchContext:{runtime:"claude-code-cli",stageType:"development",roleName:"研发者"},variables:{}});
  assert(r.systemPrompt.includes("OVERRIDDEN"));
}

function testPlatformPaths(): void {
  assert(fs.existsSync(PLATFORM_ROOT));
  assert.strictEqual(PLATFORM_META, path.join(PLATFORM_ROOT, ".meta"));
}

testLoadNonexistent(); testLoadEmpty(); testLoadWithPrompts();
testMergeNoOverlap(); testMergeOverride();
testResolveHandbook(); testWorkspaceScopeNoFallback();
testAssembleUsesMerge(); testPlatformPaths();

console.log("workspace-overlay tests passed");
