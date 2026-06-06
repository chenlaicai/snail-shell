import type { StageStatus, StageDetail, StageGateEvidence } from "../../shared";

// Re-export enriched view types from shared (single source of truth)
export type { StageDetail as StageDetailDto };

// PATCH /api/stages/:id request body
export type UpdateStageBody = {
  status?: StageStatus;
  entered_at?: string;
  left_at?: string;
  gate_evidence?: StageGateEvidence | null;
  output_artifacts?: Record<string, unknown>;
};

export type { StageStatus };
