import type {
  Sop,
  SopTransition,
  StageRoleDefinition,
  SopSnapshot,
  StageChecklistItem,
  TransitionGuard,
  SopStageDefinition,
} from "../../shared";

// Re-export Sop types directly (no zero-value aliases)
export type { Sop, SopTransition, SopSnapshot, TransitionGuard, StageChecklistItem };

// Backward-compatible aliases
export type SopDto = Sop;
export type SopTransitionDto = SopTransition;

// GET /api/sops/:id — Sop + enrichment (stage_definitions with roles + transitions)
export type SopDetailDto = Sop & {
  stage_definitions: SopStageDefinitionWithRolesDto[];
  transitions: SopTransition[];
};

// SopStageDefinition + embedded roles (from listSopStageDefinitionsWithRoles)
export type SopStageDefinitionWithRolesDto = SopStageDefinition & {
  roles: StageRoleDefinition[];
};

// POST/PATCH /api/sops — stage_definitions input item
export type SopStageDefinitionInputDto = {
  key: string;
  title: string;
  sequence: number;
  input_description?: string | null;
  output_description?: string | null;
  acceptance_focus?: string[];
  acceptance_checklist?: StageChecklistItem[];
  roles: Array<{
    key: string;
    name: string;
    description?: string;
    snail_template_id?: string | null;
    is_primary?: boolean;
    count?: number;
    handbook?: string | null;
  }>;
};

// DELETE /api/sops/:id
export type DeleteSopResult = {
  affected_workspaces: string[];
};
