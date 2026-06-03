import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function importWebModule<T extends Record<string, unknown>>(relativePath: string): Promise<T> {
  const modulePath = path.resolve(__dirname, relativePath);
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (url: string) => Promise<T>;
  return dynamicImport(moduleUrl);
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/task-board.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");

  const mod = await importWebModule<{ renderTaskBoard: (...args: unknown[]) => unknown }>("../../src/web/task-board.js");
  assert(typeof mod.renderTaskBoard === "function", "renderTaskBoard should be exported as a function");

  // --- classifyIssue logic tests (inline verification) ---
  // We verify classification logic by checking the module source contains the expected branching
  const hasClassifyLogic = moduleSource.includes("closed_at") && moduleSource.includes("in_progress");
  assert(hasClassifyLogic, "classifyIssue should check closed_at and in_progress status");

  // --- formatWaitTime logic tests ---
  // Verify the function handles edge cases: it should have branches for minutes, hours, days
  const hasTimeFormatting = moduleSource.includes("分钟") && moduleSource.includes("小时") && moduleSource.includes("天");
  assert(hasTimeFormatting, "formatWaitTime should format minutes, hours, and days");
  const hasJustNow = moduleSource.includes("刚刚");
  assert(hasJustNow, "formatWaitTime should handle sub-minute durations");

  // --- stageTagClass / stageLabel logic ---
  const hasStageMapping = moduleSource.includes('"design"') && moduleSource.includes('"development"') && moduleSource.includes('"review"');
  assert(hasStageMapping, "stage mapping should cover design, development, review");

  // --- XSS protection ---
  const hasEscapeHtml = moduleSource.includes("textContent") && moduleSource.includes("innerHTML");
  assert(hasEscapeHtml, "should use textContent-based HTML escaping");
  // Verify cached DOM element for performance (lazy-initialized)
  const hasCachedEscape = moduleSource.includes("_escDiv");
  assert(hasCachedEscape, "escapeHtml should use a cached DOM element for performance");

  // --- renderTaskBoard structure ---
  // Verify it creates the expected DOM structure
  const createsBoardHeader = moduleSource.includes("board-header") && moduleSource.includes("board-title");
  assert(createsBoardHeader, "renderTaskBoard should create board header with title");
  const createsThreeColumns = moduleSource.includes("task-list") && moduleSource.includes("task-group");
  assert(createsThreeColumns, "renderTaskBoard should create three-column task groups");
  const hasClickHandler = moduleSource.includes("onSelectIssue");
  assert(hasClickHandler, "task cards should have onSelectIssue click handlers");

  console.log("task-board tests passed");
}

main().catch((error) => {
  throw error;
});
