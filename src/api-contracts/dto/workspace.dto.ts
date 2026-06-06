import type { Workspace, WorkspaceSummary, WorkspaceDetail, StageDetail } from "../../shared";
import type { IssueDto } from "./issue.dto";
import type { ConversationDto } from "./conversation.dto";

// Re-export enriched view types from shared (single source of truth)
export type { WorkspaceSummary as WorkspaceSummaryDto, WorkspaceDetail as WorkspaceDetailDto };

// POST /api/workspaces — creation response
export type CreateWorkspaceResult = {
  workspace: Workspace;
  issue: IssueDto;
  stage: StageDetail;
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
