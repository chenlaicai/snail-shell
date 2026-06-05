import type { Workspace } from "../../shared";
import type { IssueDetailDto, IssueDto } from "./issue.dto";
import type { StageDetailDto } from "./stage.dto";
import type { ConversationDto } from "./conversation.dto";

// GET /api/workspaces — Workspace + enrichment counts
export type WorkspaceSummaryDto = Workspace & {
  conversation_count: number;
  stage_count: number;
  issue_count: number;
  boss_pending_count: number;
};

// GET /api/workspaces/:id — WorkspaceSummary + nested issues
export type WorkspaceDetailDto = WorkspaceSummaryDto & {
  issues: IssueDetailDto[];
};

// POST /api/workspaces — creation response
export type CreateWorkspaceResult = {
  workspace: Workspace;
  issue: IssueDto;
  stage: StageDetailDto;
  conversation: ConversationDto;
};

// POST /api/workspaces/detect-snail
export type DetectSnailResult = {
  has_snail: boolean;
  config: { name: string; summary?: string; default_sop_key?: string } | null;
};

// POST /api/workspaces/:id/load-snail
export type LoadSnailResult = {
  success: boolean;
  message: string;
};
