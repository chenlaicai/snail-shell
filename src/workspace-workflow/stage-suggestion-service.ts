/**
 * Stage suggestion service.
 *
 * Pure functions extracted from WorkspaceManager that handle AI-proposed
 * stage transitions (pending suggestions, confirmation, rejection).
 */
import type { ConversationStore, Issue, Workspace, Stage } from "../persistence/store";
import { logger } from "../logger";
import { assertIssueWritable } from "./manager-detail";
import type { StageSuggestion } from "./manager-types";

export interface StageSuggestionServiceDeps {
  store: ConversationStore;
  pendingStageSuggestions: Map<string, StageSuggestion>;
  emit: (event: string, ...args: unknown[]) => void;
  transitionIssueStage: (issueId: string, targetStageKey: string) => unknown;
}

/**
 * Agent output detected a stage_transition — store as pending suggestion
 * and notify the frontend via WebSocket. Does NOT auto-execute the transition.
 */
export function handleAgentStageSuggestion(deps: StageSuggestionServiceDeps, conversationId: string, targetStageKey: string, reason: string | null): void {
  try {
    const context = resolveAgentTransitionContext(deps.store, conversationId);
    if (!context) return;
    const suggestion: StageSuggestion = {
      issueId: context.issue.id,
      fromStageKey: context.activeStage.type,
      toStageKey: targetStageKey,
      reason,
      suggestedAt: new Date().toISOString(),
    };
    deps.pendingStageSuggestions.set(context.issue.id, suggestion);
    deps.emit("stage-suggestion", suggestion);
    logger.info("Agent stage transition suggested", { conversationId, issueId: context.issue.id, from: suggestion.fromStageKey, to: targetStageKey, reason });
  } catch (error) {
    logger.warn("Agent stage suggestion failed", { conversationId, targetStageKey, error: error instanceof Error ? error.message : String(error) });
  }
}

export function getPendingStageSuggestion(deps: StageSuggestionServiceDeps, issueId: string): StageSuggestion | null {
  return deps.pendingStageSuggestions.get(issueId) ?? null;
}

/**
 * Confirm the AI-proposed stage transition and execute it.
 * On failure the suggestion is preserved for retry.
 */
export function confirmStageSuggestion(deps: StageSuggestionServiceDeps, issueId: string) {
  const suggestion = deps.pendingStageSuggestions.get(issueId);
  if (!suggestion) throw new Error("No pending stage suggestion");
  const result = deps.transitionIssueStage(issueId, suggestion.toStageKey);
  // Clear suggestion only on success; on failure preserve for user retry
  deps.pendingStageSuggestions.delete(issueId);
  return result;
}

export function clearStageSuggestion(deps: StageSuggestionServiceDeps, issueId: string): void {
  deps.pendingStageSuggestions.delete(issueId);
}

/** Resolve the agent transition context; returns null with log.warn when context is incomplete. */
function resolveAgentTransitionContext(store: ConversationStore, conversationId: string): { issue: Issue; workspace: Workspace; activeStage: Stage } | null {
  const conversation = store.getConversation(conversationId);
  if (!conversation || !conversation.issue_id || !conversation.stage_id) { logger.warn("stage_transition: conversation context incomplete", { conversationId }); return null; }
  const issue = store.getIssue(conversation.issue_id);
  if (!issue) { logger.warn("stage_transition: issue not found", { issueId: conversation.issue_id }); return null; }
  assertIssueWritable(store, issue);
  const workspace = store.fileConfigStore.getWorkspace(issue.workspace_id);
  if (!workspace) { logger.warn("stage_transition: workspace not found", { workspaceId: issue.workspace_id }); return null; }
  const activeStage = store.getStage(conversation.stage_id);
  if (!activeStage) { logger.warn("stage_transition: stage not found", { stageId: conversation.stage_id }); return null; }
  return { issue, workspace, activeStage };
}
