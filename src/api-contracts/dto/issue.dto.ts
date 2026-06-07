import type { Issue, IssueDetail, StageDetail, Conversation } from "../../shared";

export type { Issue, IssueDetail };

// POST /api/workspaces/:id/issues — creation response
export type CreateIssueResult = {
  issue: Issue;
  stage: StageDetail;
  conversation: Conversation;
};

// POST /api/issues/:id/advance, bounce-stage, confirm-stage-suggestion
export type AdvanceIssueResult = {
  completed_stage: StageDetail;
  next_stage: StageDetail | null;
  conversation: Conversation | null;
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
