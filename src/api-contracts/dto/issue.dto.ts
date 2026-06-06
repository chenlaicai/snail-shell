import type { Issue, IssueDetail, StageDetail } from "../../shared";
import type { ConversationDto } from "./conversation.dto";

// Re-export enriched view types from shared (single source of truth)
export type { IssueDetail as IssueDetailDto };

// Backward-compatible alias
export type IssueDto = Issue;

// POST /api/workspaces/:id/issues — creation response
export type CreateIssueResult = {
  issue: Issue;
  stage: StageDetail;
  conversation: ConversationDto;
};

// POST /api/issues/:id/advance, bounce-stage, confirm-stage-suggestion
export type AdvanceIssueResult = {
  completed_stage: StageDetail;
  next_stage: StageDetail | null;
  conversation: ConversationDto | null;
  issue: Issue;
};

// POST /api/issues/:id/complete, archive
export type IssueCleanupResult = {
  issue: Issue;
  cleanup: RepoCleanupResult;
};

// RepoCleanupResult (from repo-cleanup.ts)
export type RepoCleanupResult = {
  attempted: boolean;
  steps: RepoCleanupStep[];
};

export type RepoCleanupStep = {
  target: "worktree" | "branch";
  value: string | null;
  status: "removed" | "skipped" | "failed";
  message: string;
};

// GET /api/issues/:id/stage-suggestion
export type StageSuggestion = {
  issueId: string;
  fromStageKey: string;
  toStageKey: string;
  reason: string | null;
  suggestedAt: string;
};
