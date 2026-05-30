import path from "path";
import { ConversationStore } from "../src/persistence/store";
import type { SeedSelfWorkspaceResult } from "../src/workspace-workflow/self-workspace-seed";
import { seedSelfWorkspace } from "../src/workspace-workflow/self-workspace-seed";
import { RoleRegistry } from "../src/roles";

function getDbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
}

function printResult(result: SeedSelfWorkspaceResult): void {
  console.log(result.created ? "Created default self workspace." : "Default self workspace already exists.");
  console.log(`workspace_id=${result.workspace.id}`);
  console.log(`stage_id=${result.stage?.id ?? ""}`);
  console.log(`conversation_id=${result.conversation?.id ?? ""}`);
}

if (require.main === module) {
  const store = new ConversationStore(getDbPath());
  try {
    printResult(seedSelfWorkspace(store, new RoleRegistry(store)));
  } finally {
    store.close();
  }
}
