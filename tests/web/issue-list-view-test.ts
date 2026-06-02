import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function importWebModule<T>(relativePath: string): Promise<T> {
  const modulePath = path.resolve(__dirname, relativePath);
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<T>;
  return dynamicImport(moduleUrl);
}

async function main(): Promise<void> {
  const { buildIssueGroups } = await importWebModule<{ buildIssueGroups: (issues: any[]) => { activeIssues: any[]; archivedIssues: any[] } }>("../../src/web/issue-list-view.js");
  const issues = [
    { id: "new-active", closed_at: null },
    { id: "new-archived", closed_at: "2024-01-01" },
    { id: "old-review", closed_at: null },
    { id: "old-archived", closed_at: "2023-06-15" },
  ];

  const groups = buildIssueGroups(issues);
  assert(groups.activeIssues.map((issue) => issue.id).join(",") === "new-active,old-review", "non-archived issues should keep backend time order above archive group");
  assert(groups.archivedIssues.map((issue) => issue.id).join(",") === "new-archived,old-archived", "archived issues should keep backend time order inside the archive group");

  console.log("issue-list-view tests passed");
}

main().catch((error) => {
  throw error;
});
