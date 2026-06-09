import type { Issue } from "../../shared";
import type { StageDetailDto } from "./stage.dto";
import type { ConversationDto } from "./conversation.dto";

// Issue entity (re-exported for convenience)
export type IssueDto = Issue;

// GET /api/issues/:id — Issue + enrichment (from buildIssueDetail in manager-detail.ts)
export type IssueDetailDto = Issue & {
  stages: StageDetailDto[];
  current_stage: StageDetailDto | null;
  conversation_count: number;
  boss_pending_count: number;
};

// POST /api/workspaces/:id/issues — creation response
export type CreateIssueResult = {
  issue: IssueDto;
  stage: StageDetailDto;
  conversation: ConversationDto;
};

// POST /api/issues/:id/advance, bounce-stage, confirm-stage-suggestion
export type AdvanceIssueResult = {
  completed_stage: StageDetailDto;
  next_stage: StageDetailDto | null;
  conversation: ConversationDto | null;
  issue: IssueDto;
};

// POST /api/issues/:id/complete, archive
export type IssueCleanupResult = {
  issue: IssueDto;
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
