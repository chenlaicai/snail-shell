import type {
  Sop,
  SopTransition,
  StageRoleDefinition,
  SopSnapshot,
  StageChecklistItem,
  TransitionGuard,
  SopStageDefinition,
} from "../../shared";

export type { Sop, SopTransition, SopSnapshot, TransitionGuard, StageChecklistItem };

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
