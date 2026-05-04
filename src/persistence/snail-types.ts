import type { SnailName, StageType } from "./types";

export type SnailKind = "human" | "agent";
export type SnailStatus = "active" | "archived";
export type ProjectSnailAssignmentStatus = "active" | "archived";

export interface Snail {
  id: string;
  name: SnailName;
  kind: SnailKind;
  runtime: string | null;
  profile: string | null;
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
  system_prompt_asset: string | null;
  status: SnailStatus;
  created_at: string;
  updated_at: string;
}

export interface ProjectSnailAssignment {
  id: string;
  project_id: string;
  snail_id: string;
  role_key: string;
  role_title: string;
  role_description: string | null;
  stage_types: StageType[];
  working_rules: string[];
  preferred_artifact_types: string[];
  status: ProjectSnailAssignmentStatus;
  created_at: string;
  updated_at: string;
}

export interface UpsertSnailInput {
  id: string;
  name: SnailName;
  kind: SnailKind;
  runtime?: string | null;
  profile?: string | null;
  capabilityExpectations?: string[];
  workingRules?: string[];
  preferredArtifactTypes?: string[];
  systemPromptAsset?: string | null;
  status?: SnailStatus;
}

export interface UpsertProjectSnailAssignmentInput {
  id: string;
  projectId: string;
  snailId: string;
  roleKey: string;
  roleTitle: string;
  roleDescription?: string | null;
  stageTypes?: StageType[];
  workingRules?: string[];
  preferredArtifactTypes?: string[];
  status?: ProjectSnailAssignmentStatus;
}
