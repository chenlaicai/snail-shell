export { WorkspaceManager } from "./manager";
export type {
  WorkspaceManagerDeps,
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
  SummaryGenerationInput,
} from "./manager-types";

export { createInitialWorkflow, createIssueWorkflow, createStageConversation, advanceIssueWorkflow, bounceIssueWorkflow } from "./workflow";
export type { IssueWorkflowResult, IssueAdvanceResult } from "./workflow";

export { buildBossMentionItem, buildConversationBadgePayload, sumBossPendingCount } from "./manager-events";

export { ConversationQueue } from "./conversation-queue";

export { cleanupIssueRepoContext } from "./repo-cleanup";
export type { RepoCleanupStep, RepoCleanupResult } from "./repo-cleanup";

export { seedSelfWorkspace } from "./self-workspace-seed";
export type { SeedSelfWorkspaceResult } from "./self-workspace-seed";

export { recoverOrphanedStreamingAssistantMessages } from "./startup-recovery";
export type { StartupRecoveryResult } from "./startup-recovery";

export { refreshConversationSummary, buildSummaryGenerationInput } from "./summary-input";

export { describeToolUse } from "./tool-use";

export { hasSnailDirectory, loadWorkspaceContext, loadWorkspaceConfigOnly, loadSopYamlDefinitions, initializeSnailDirectory, snailPaths, SNAIL_DIR_NAME } from "./snail-loader";
export type { WorkspaceContext, SnailWorkspaceConfig, SopYamlDefinition } from "./snail-loader";
