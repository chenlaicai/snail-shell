import type { StageStatus, StageGateEvidence } from "../../shared";

// PATCH /api/stages/:id request body
export type UpdateStageBody = {
  status?: StageStatus;
  entered_at?: string;
  left_at?: string;
  gate_evidence?: StageGateEvidence | null;
  output_artifacts?: Record<string, unknown>;
};
