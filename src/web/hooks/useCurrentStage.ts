import { useSearchParams } from "react-router-dom";
import type { IssueDto } from "../types";

/**
 * Derive the current stage from URL `?stage=` param + issue detail.
 * Single source of truth — no store involved.
 */
export function useCurrentStage(issue: IssueDto | null | undefined) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStageId = searchParams.get("stage");
  const stages = issue?.stages ?? [];
  const currentStage = stages.find((s) => s.id === selectedStageId)
    ?? issue?.current_stage
    ?? stages.at(-1)
    ?? null;

  return { currentStage, selectedStageId, setSearchParams };
}
