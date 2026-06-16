import type { StageChecklistItem, TransitionGuard } from "./domain-types";

/** Issue 创建时从 SOP 模板快照的全量配置，后续运行时只读快照不读模板。 */
export interface SopSnapshot {
  sop_id: string;
  source: "platform" | "workspace";
  source_ref: string | null;
  name: string;
  description: string | null;
  first_stage: string | null;
  shared_handbook: string | null;
  stage_definitions: Array<{
    key: string;
    title: string;
    sequence: number;
    input_description: string | null;
    output_description: string | null;
    acceptance_focus: string[];
    acceptance_checklist: StageChecklistItem[];
    roles: Array<{
      key: string;
      name: string;
      description: string;
      is_primary: boolean;
      count: number;
      handbook: string | null;
    }>;
  }>;
  transitions: Array<{
    from: string;
    to: string;
    guard: TransitionGuard | null;
  }>;
}
