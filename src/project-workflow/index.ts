export { ProjectManager } from "./manager";
export type {
  ProjectManagerDeps,
  ProjectSummary,
  ProjectDetail,
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

export { createInitialWorkflow, createFeatureWorkflow, createStageConversation, advanceFeatureWorkflow, restartFeatureDevelopmentWorkflow, getStageInputArtifacts } from "./workflow";
export type { FeatureWorkflowResult, FeatureAdvanceResult } from "./workflow";

export { buildBossMentionItem, buildConversationBadgePayload, sumBossPendingCount } from "./manager-events";

export { ConversationQueue } from "./conversation-queue";

export { cleanupFeatureRepoContext } from "./repo-cleanup";
export type { RepoCleanupStep, RepoCleanupResult } from "./repo-cleanup";

export { seedSelfProject } from "./self-project-seed";
export type { SeedSelfProjectResult } from "./self-project-seed";

export { recoverOrphanedStreamingAssistantMessages } from "./startup-recovery";
export type { StartupRecoveryResult } from "./startup-recovery";

export { refreshConversationSummary, buildSummaryGenerationInput } from "./summary-input";

export { buildKnowledgeGovernanceSystemPrompt } from "./knowledge-governance-prompt";

export { describeToolUse } from "./tool-use";
