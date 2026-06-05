import type { Stage, StageStatus } from "../../shared";
import type { StageGateEvidence } from "../../shared/domain-types";

// Stage entity (re-exported for convenience)
export type StageDto = Stage;

// StageDetail = Stage + enrichment (from buildStageDetail in manager-detail.ts)
export type StageDetailDto = Stage & {
  input_artifacts: Record<string, unknown>;
  boss_pending_count: number;
  stage_definition: {
    key: string;
    title: string;
    input_description: string | null;
    output_description: string | null;
    acceptance_focus: string[];
  } | null;
  role_definitions: Array<{
    name: string;
    snail_template_id: string | null;
    is_primary: boolean;
    description: string;
    handbook: string | null;
  }>;
};

// PATCH /api/stages/:id request body
export type UpdateStageBody = {
  status?: StageStatus;
  entered_at?: string;
  left_at?: string;
  gate_evidence?: StageGateEvidence | null;
  output_artifacts?: Record<string, unknown>;
};

export type { StageStatus };
