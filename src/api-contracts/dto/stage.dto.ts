import type { StageStatus, StageDetail, StageGateEvidence } from "../../shared";

export type { StageDetail };

// PATCH /api/stages/:id request body
export type UpdateStageBody = {
  status?: StageStatus;
  entered_at?: string;
  left_at?: string;
  gate_evidence?: StageGateEvidence | null;
  output_artifacts?: Record<string, unknown>;
};

export type { StageStatus };
