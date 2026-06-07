export { WorkspaceManager } from "./manager";
export type { WorkspaceManagerDeps, SummaryGenerationInput } from "./manager-types";

// Domain types — 直接从 shared 导出
export type {
  WorkspaceSummary,
  WorkspaceDetail,
  IssueDetail,
  StageDetail,
  ConversationDetail,
  ConversationMessagesPage,
  ConversationRecentMessagesSnapshot,
  ConversationHistoryWindow,
  ConversationHistorySearchPage,
  BossMentionItem,
  ConversationDispatchState,
} from "../shared/types";

export { createInitialWorkflow, createIssueWorkflow, transitionIssueStage } from "./workflow";
export type { IssueWorkflowResult, IssueTransitionResult } from "./workflow";
export { hasSnailDirectory, loadWorkspaceContext } from "./snail-loader";
