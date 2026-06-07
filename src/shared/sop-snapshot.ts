/**
 * SOP Snapshot 类型定义。
 *
 * StageChecklistItem 和 TransitionGuard 定义在此文件（SOP 领域概念），
 * domain-types.ts 从这里 re-export，避免循环依赖。
 */

/** 阶段验收清单项。定义在 stage_definition 上，描述该阶段需要满足的验收条件。 */
export interface StageChecklistItem {
  id: string;
  description: string;
  required: boolean;
}

/** SOP 转移守卫配置。 */
export interface TransitionGuard {
  /**
   * 守卫类型。当前仅支持 requires_artifacts。
   * 使用 string 而非字面量联合类型，以便在 checkGuard 中捕获未知类型并抛错，
   * 而非在类型检查阶段就阻止非法值进入运行时。
   */
  type: string;
  /** 守卫参数。requires_artifacts 时为必须存在的 artifact key 列表。 */
  config: Record<string, unknown>;
}

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
