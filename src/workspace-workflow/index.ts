export { WorkspaceManager } from "./manager";
export type {
  WorkspaceManagerDeps,
  WorkspaceSummary,
  WorkspaceDetail,
  FeatureDetail,
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

export { createInitialWorkflow, createFeatureWorkflow, createStageConversation, advanceFeatureWorkflow, bounceFeatureWorkflow } from "./workflow";
export type { FeatureWorkflowResult, FeatureAdvanceResult } from "./workflow";

export { buildBossMentionItem, buildConversationBadgePayload, sumBossPendingCount } from "./manager-events";

export { ConversationQueue } from "./conversation-queue";

export { cleanupFeatureRepoContext } from "./repo-cleanup";
export type { RepoCleanupStep, RepoCleanupResult } from "./repo-cleanup";

export { seedSelfWorkspace } from "./self-workspace-seed";
export type { SeedSelfWorkspaceResult } from "./self-workspace-seed";

export { recoverOrphanedStreamingAssistantMessages } from "./startup-recovery";
export type { StartupRecoveryResult } from "./startup-recovery";

export { refreshConversationSummary, buildSummaryGenerationInput } from "./summary-input";

export { describeToolUse } from "./tool-use";
