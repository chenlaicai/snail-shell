import type { Conversation, ConversationStore, Issue, Workspace, Stage } from "../persistence/store";
import { createIssueWorkflow } from "./workflow";
import type { RoleRegistry } from "../roles";

const WORKSPACE_NAME = "Snail Shell";

export interface SeedSelfWorkspaceResult {
  created: boolean;
  workspace: Workspace;
  issue: Issue | null;
  stage: Stage | null;
  conversation: Conversation | null;
}

function getDefaultConversation(store: ConversationStore, stage: Stage | null): Conversation | null {
  if (!stage) return null;
  return store.getInitialConversationByStage(stage.id) ?? null;
}

export function seedSelfWorkspace(store: ConversationStore, roleRegistry: RoleRegistry): SeedSelfWorkspaceResult {
  const existingWorkspace = store.findWorkspaceByName(WORKSPACE_NAME);
  if (!existingWorkspace) {
    throw new Error(`Self workspace "${WORKSPACE_NAME}" not found. Ensure config/workspaces.json defines it.`);
  }
  const issues = store.listIssues(existingWorkspace.id);
  let issue = issues.find((item) => {
    const activeStage = store.getActiveStage(item.id);
    return activeStage !== undefined;
  }) ?? issues[0] ?? null;
  let stage = issue ? store.getActiveStage(issue.id) ?? null : null;
  let conversation = getDefaultConversation(store, stage);
  if (!issue) {
    const created = createIssueWorkflow({ store, roleRegistry }, { workspace: existingWorkspace, title: "初始设计与实现", summary: "工作区创建时自动生成的默认 issue。" });
    issue = created.issue;
    stage = created.stage;
    conversation = created.conversation;
  }
  return { created: false, workspace: existingWorkspace, issue, stage, conversation };
}
