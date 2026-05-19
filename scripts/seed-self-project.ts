import path from "path";
import { ConversationStore } from "../src/persistence/store";
import type { SeedSelfProjectResult } from "../src/project-workflow/self-project-seed";
import { seedSelfProject } from "../src/project-workflow/self-project-seed";
import { RoleRegistry } from "../src/roles";

function getDbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
}

function printResult(result: SeedSelfProjectResult): void {
  console.log(result.created ? "Created default self project." : "Default self project already exists.");
  console.log(`project_id=${result.project.id}`);
  console.log(`stage_id=${result.stage?.id ?? ""}`);
  console.log(`conversation_id=${result.conversation?.id ?? ""}`);
}

if (require.main === module) {
  const store = new ConversationStore(getDbPath());
  try {
    printResult(seedSelfProject(store, new RoleRegistry(store)));
  } finally {
    store.close();
  }
}
