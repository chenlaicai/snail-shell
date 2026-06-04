/**
 * SopSnapshotReader — issue 运行时的 SOP 配置唯一读取来源。
 *
 * 从 issue.sop_snapshot（JSON）解析数据，提供与 ConversationStore SOP 查询方法
 * 相同的接口，但不经过 FileConfigStore，不读文件，不走缓存。
 *
 * Why: 快照机制保证 issue 创建后 SOP 模板变更不影响已有 issue。
 */
import type {
  SopSnapshot,
  Sop,
  SopStageDefinition,
  SopTransition,
  StageRoleDefinition,
  StageChecklistItem,
} from "../shared/types";

export class SopSnapshotReader {
  constructor(private snapshot: SopSnapshot) {
    if (!snapshot.sop_id) {
      throw new Error("Issue has no SOP snapshot. This issue was created before the snapshot mechanism was introduced. Please recreate the issue or rebuild the database.");
    }
  }

  getSop(): Sop {
    return {
      id: this.snapshot.sop_id,
      /** Why: 旧快照（source 字段引入前创建）不含 source，默认 platform。 */
      source: this.snapshot.source ?? "platform",
      source_ref: this.snapshot.source_ref ?? null,
      key: this.snapshot.sop_id,
      name: this.snapshot.name,
      description: this.snapshot.description ?? null,
      first_stage: this.snapshot.first_stage ?? null,
      shared_handbook: this.snapshot.shared_handbook ?? null,
      created_at: "",
      updated_at: "",
    };
  }

  getSopStageDefinitionByKey(key: string): SopStageDefinition | undefined {
    const sd = this.snapshot.stage_definitions.find((s) => s.key === key);
    return sd ? this.toStageDefinition(sd) : undefined;
  }

  listSopStageDefinitions(): SopStageDefinition[] {
    return [...this.snapshot.stage_definitions]
      .sort((a, b) => a.sequence - b.sequence)
      .map((sd) => this.toStageDefinition(sd));
  }

  listSopStageDefinitionsWithRoles(): Array<SopStageDefinition & { roles: StageRoleDefinition[] }> {
    return this.listSopStageDefinitions().map((sd) => ({
      ...sd,
      roles: this.listRoleDefinitionsByStage(sd.id),
    }));
  }

  getSopTransitions(): SopTransition[] {
    return this.snapshot.transitions.map((t, i) => ({
      id: `st-${this.snapshot.sop_id}-${t.from}-${t.to}-${i}`,
      sop_id: this.snapshot.sop_id,
      from_stage_key: t.from,
      to_stage_key: t.to,
      guard: t.guard ?? null,
    }));
  }

  getForwardTransitions(fromStageKey: string): SopTransition[] {
    return this.getSopTransitions().filter((t) => t.from_stage_key === fromStageKey);
  }

  validateTransition(fromStageKey: string, toStageKey: string): SopTransition {
    const found = this.getSopTransitions().find(
      (t) => t.from_stage_key === fromStageKey && t.to_stage_key === toStageKey,
    );
    if (!found) {
      const available = this.getForwardTransitions(fromStageKey);
      const targets = available.map((t) => t.to_stage_key).join(", ") || "(none)";
      throw new Error(
        `Invalid transition: ${fromStageKey} → ${toStageKey} not in SOP ${this.snapshot.sop_id} transitions. Available targets from ${fromStageKey}: ${targets}`,
      );
    }
    return found;
  }

  getStageDefinition(stageDefinitionId: string, workspaceId?: string): (SopStageDefinition & { workspace_id: string; created_at: string; updated_at: string }) | undefined {
    // stageDefinitionId format: sd-<sopId>-<key>
    const prefix = `sd-${this.snapshot.sop_id}-`;
    if (!stageDefinitionId.startsWith(prefix)) return undefined;
    const key = stageDefinitionId.slice(prefix.length);
    const sd = this.getSopStageDefinitionByKey(key);
    if (!sd) return undefined;
    const now = new Date().toISOString();
    return { ...sd, workspace_id: workspaceId ?? "", created_at: now, updated_at: now };
  }

  listRoleDefinitionsByStage(stageDefinitionId: string): StageRoleDefinition[] {
    // Direct lookup from snapshot — no workspace_id dependency
    const prefix = `sd-${this.snapshot.sop_id}-`;
    if (!stageDefinitionId.startsWith(prefix)) return [];
    const key = stageDefinitionId.slice(prefix.length);
    const snapshotSd = this.snapshot.stage_definitions.find((s) => s.key === key);
    if (!snapshotSd) return [];
    return snapshotSd.roles.flatMap((role) => expandRole(role, stageDefinitionId));
  }

  collectSopRoleKeys(): Set<string> {
    const keys = new Set<string>();
    for (const sd of this.snapshot.stage_definitions) {
      for (const role of sd.roles) {
        keys.add(role.key);
      }
    }
    return keys;
  }

  private toStageDefinition(sd: SopSnapshot["stage_definitions"][number]): SopStageDefinition {
    return {
      id: `sd-${this.snapshot.sop_id}-${sd.key}`,
      sop_id: this.snapshot.sop_id,
      key: sd.key,
      title: sd.title,
      sequence: sd.sequence,
      input_description: sd.input_description ?? null,
      output_description: sd.output_description ?? null,
      acceptance_focus: sd.acceptance_focus ?? [],
      acceptance_checklist: (sd.acceptance_checklist ?? []) as StageChecklistItem[],
    };
  }
}

/** Expand a role definition by its count (e.g. count=2 produces two instances). */
function expandRole(role: SopSnapshot["stage_definitions"][number]["roles"][number], stageDefinitionId: string): StageRoleDefinition[] {
  const count = role.count ?? 1;
  const result: StageRoleDefinition[] = [];
  for (let i = 1; i <= count; i++) {
    const suffix = count > 1 && i > 1 ? `-${i}` : "";
    result.push({
      id: `srd-${stageDefinitionId}-${role.key}${suffix}`,
      stage_definition_id: stageDefinitionId,
      key: role.key,
      name: `${role.name}${suffix}`,
      snail_template_id: null,
      is_primary: (role.is_primary && i === 1) ? 1 : 0,
      count,
      description: role.description ?? "",
      handbook: role.handbook ?? null,
    });
  }
  return result;
}
