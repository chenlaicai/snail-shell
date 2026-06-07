import type { Workspace, StageDetail, Issue, Conversation } from "../../shared";

// POST /api/workspaces — creation response
export type CreateWorkspaceResult = {
  workspace: Workspace;
  issue: Issue;
  stage: StageDetail;
  conversation: Conversation;
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
