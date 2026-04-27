import path from "path";
import { ConversationStore } from "../src/persistence/store";
import type { Conversation, Project, Stage } from "../src/persistence/store";
import { createInitialWorkflow } from "../src/project/workflow";
import { SnailRegistry } from "../src/snails";

const PROJECT_NAME = "Snail Shell";
const PROJECT_KIND = "system_self";
const PROJECT_SUMMARY = "用于迭代 Snail Shell 自身的默认项目。";

interface SeedResult {
  created: boolean;
  project: Project;
  stage: Stage | null;
  conversation: Conversation | null;
}

function getDbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
}

function getDefaultConversation(store: ConversationStore, stage: Stage | null): Conversation | null {
  if (!stage) return null;
  return store.listConversationsByStage(stage.id)[0] ?? null;
}

export function seedSelfProject(store: ConversationStore): SeedResult {
  const existingProject = store.findProjectByNameAndKind(PROJECT_NAME, PROJECT_KIND);
  if (existingProject) {
    const stage = store.getActiveStage(existingProject.id) ?? null;
    return {
      created: false,
      project: existingProject,
      stage,
      conversation: getDefaultConversation(store, stage),
    };
  }

  const result = createInitialWorkflow(
    { store, snailRegistry: new SnailRegistry() },
    PROJECT_NAME,
    PROJECT_SUMMARY,
    PROJECT_KIND
  );
  return { created: true, project: result.project, stage: result.stage, conversation: result.conversation };
}

function printResult(result: SeedResult): void {
  console.log(result.created ? "Created default self project." : "Default self project already exists.");
  console.log(`project_id=${result.project.id}`);
  console.log(`stage_id=${result.stage?.id ?? ""}`);
  console.log(`conversation_id=${result.conversation?.id ?? ""}`);
}

if (require.main === module) {
  const store = new ConversationStore(getDbPath());
  try {
    printResult(seedSelfProject(store));
  } finally {
    store.close();
  }
}
