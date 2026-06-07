/**
 * Workspace CRUD mutation service.
 *
 * Pure functions extracted from WorkspaceManager that operate on workspaces,
 * including .snail directory loading and initialization.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";
import type { ConversationStore } from "../persistence/store";
import { logger } from "../logger";
import { createInitialWorkflow } from "./workflow";
import { resolveWorkspaceRoot } from "./default-workspace-dir";
import { buildIssueDetail } from "./manager-detail";
import { sumBossPendingCount } from "./manager-events";
import { hasSnailDirectory, loadWorkspaceContext, initializeSnailDirectory, type YamlStageDefinition } from "./snail-loader";
import type { WorkspaceDetail, WorkspaceSummary } from "./manager-types";
import type { IssueServiceDeps } from "./issue-service";
import * as issueService from "./issue-service";

export interface WorkspaceServiceDeps {
  store: ConversationStore;
  issueDeps: IssueServiceDeps;
}

export function createWorkspace(
  deps: WorkspaceServiceDeps,
  name: string,
  input: { summary?: string; workspaceRoot?: string; sopId: string; roleSnailMapping?: Record<string, Record<string, string>>; loadFromSnail?: boolean },
) {
  const { store, issueDeps } = deps;
  const workspaceId = randomUUID();
  const resolvedRoot = resolveWorkspaceRoot(workspaceId, input.workspaceRoot || undefined);

  if (input.loadFromSnail) {
    if (!hasSnailDirectory(resolvedRoot)) {
      initializeSnailDirectory(resolvedRoot, { name, summary: input.summary, sopKey: input.sopId });
      logger.info("WorkspaceService initialized .snail directory", { workspaceId, workspaceRoot: resolvedRoot });
    }
    loadWorkspaceFromSnail(store, workspaceId, resolvedRoot);
    const workspace = store.fileConfigStore.getWorkspace(workspaceId);
    if (workspace) {
      const issueResult = issueService.createIssue(issueDeps, workspaceId, "初始研发迭代", "工作区创建时自动生成的默认 issue。", input.sopId, {});
      logger.info("WorkspaceService created workspace from .snail", { workspaceId, issueId: issueResult.issue.id, stageId: issueResult.stage.id, conversationId: issueResult.conversation.id });
      return { workspace, ...issueResult };
    }
  }

  const result = createInitialWorkflow(
    { store },
    { name, summary: input.summary, workspaceRoot: resolvedRoot, workspaceId, sopId: input.sopId, roleSnailMapping: input.roleSnailMapping ?? {} },
  );
  logger.info("WorkspaceService initialized workspace workflow", { workspaceId: result.workspace.id, issueId: result.issue.id, stageId: result.stage.id, conversationId: result.conversation.id });
  return result;
}

export function loadWorkspaceFromSnail(store: ConversationStore, workspaceId: string, workspaceRoot: string): boolean {
  if (!hasSnailDirectory(workspaceRoot)) {
    throw new Error(`.snail directory not found in ${workspaceRoot}`);
  }

  const context = loadWorkspaceContext(workspaceRoot);
  const sopDir = path.join(workspaceRoot, ".snail", "config", "sop");

  const sopSeeds = context.sopDefinitions.map((sopDef) => ({
    sop: {
      id: `${workspaceId}#${sopDef.key}`,
      source: "workspace" as const,
      sourceRef: workspaceId,
      key: sopDef.key,
      name: sopDef.name,
      description: sopDef.description ?? null,
    },
    stage_definitions: resolveHandbookRefs(sopDef.stage_definitions, sopDir),
  }));

  store.fileConfigStore.replaceWorkspaceConfigs(workspaceId, {
    workspaceUpdate: { name: context.config.name, summary: context.config.summary },
    sopSeeds,
  });

  logger.info("WorkspaceService loaded workspace from .snail", {
    workspaceId,
    workspaceRoot,
    sopCount: context.sopDefinitions.length,
    promptCount: context.prompts.length,
    skillCount: context.skills.length,
  });

  return true;
}

export function hasSnailConfig(workspaceRoot: string): boolean {
  return hasSnailDirectory(workspaceRoot);
}

export function listWorkspaces(store: ConversationStore, limit = 50, offset = 0): WorkspaceSummary[] {
  return store.fileConfigStore.listWorkspaces(limit, offset).map((workspace) => ({
    ...workspace,
    conversation_count: store.listConversationsByWorkspace(workspace.id).length,
    stage_count: store.listStages(workspace.id).length,
    issue_count: store.listIssues(workspace.id).length,
    boss_pending_count: sumBossPendingCount(store.listConversationsByWorkspace(workspace.id), (cid) => store.listBossPendingDispatches(cid).length),
  }));
}

export function getWorkspace(store: ConversationStore, workspaceId: string): WorkspaceDetail | null {
  const workspace = store.fileConfigStore.getWorkspace(workspaceId);
  if (!workspace) return null;
  const stages = store.listStages(workspaceId);
  const issues = store.listIssues(workspaceId).map((f) => buildIssueDetail(store, f));
  return {
    ...workspace,
    conversation_count: store.listConversationsByWorkspace(workspaceId).length,
    stage_count: stages.length,
    issue_count: issues.length,
    issues,
    boss_pending_count: sumBossPendingCount(store.listConversationsByWorkspace(workspace.id), (cid) => store.listBossPendingDispatches(cid).length),
  };
}

/**
 * Resolve @file references in stage_definitions handbook fields.
 * Mutates the passed-in role.handbook property in place, returns the same reference.
 */
function resolveHandbookRefs(stageDefinitions: YamlStageDefinition[], sopDir: string): YamlStageDefinition[] {
  for (const sd of stageDefinitions) {
    for (const role of sd.roles ?? []) {
      if (typeof role.handbook === "string" && role.handbook.startsWith("@")) {
        const filePath = path.join(sopDir, role.handbook.slice(1));
        if (fs.existsSync(filePath)) {
          role.handbook = fs.readFileSync(filePath, "utf8");
        }
      }
    }
  }
  return stageDefinitions;
}
