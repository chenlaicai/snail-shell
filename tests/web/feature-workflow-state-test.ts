import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/feature-workflow-state.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{ canRestartFeatureDevelopment: (feature: any, stage: any) => boolean }>;
  const { canRestartFeatureDevelopment } = await dynamicImport(moduleUrl);

  assert(canRestartFeatureDevelopment({ status: "active", current_stage: { id: "development-1" } }, { id: "development-1", type: "development", status: "in_progress" }), "active development stage should be restartable");
  assert(canRestartFeatureDevelopment({ status: "waiting_merge", current_stage: { id: "review-2" } }, { id: "review-2", type: "review", status: "completed" }), "waiting merge feature should allow restarting from latest completed review stage");
  assert(!canRestartFeatureDevelopment({ status: "waiting_merge", current_stage: { id: "review-2" } }, { id: "review-1", type: "review", status: "completed" }), "waiting merge feature should not allow restarting from stale completed review stage");
  assert(!canRestartFeatureDevelopment({ status: "in_review", current_stage: { id: "review-1" } }, { id: "review-1", type: "review", status: "in_progress" }), "in-progress review should not bypass normal review completion");
  assert(!canRestartFeatureDevelopment({ status: "waiting_merge", current_stage: { id: "development-1" } }, { id: "development-1", type: "development", status: "completed" }), "waiting merge feature should only restart from the completed review stage");
  assert(!canRestartFeatureDevelopment(null, { type: "development", status: "in_progress" }), "missing feature should not be restartable");

  console.log("feature-workflow-state tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
