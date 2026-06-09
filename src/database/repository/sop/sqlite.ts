/**
 * SQLite SOP Repository 实现
 *
 * 基于 better-sqlite3 实现 SOP Repository 接口。
 * SOP 配置存储在 SQLite 数据库中，确保重启后数据持久化。
 */

import type { DatabaseConnection } from "../../connection/types";
import type {
  SopRepository,
  Sop,
  SopStageDefinition,
  SopStageRoleDefinition,
  SopTransition,
  CreateSopInput,
  CreateSopStageDefinitionInput,
  CreateSopStageRoleDefinitionInput,
  CreateSopTransitionInput,
  SopSource,
} from "../../../sop";

/**
 * SQLite SOP Repository 实现
 *
 * 使用 SQLite 表存储 SOP 配置，确保数据持久化。
 */
export class SqliteSopRepository implements SopRepository {
  constructor(private connection: DatabaseConnection) {}

  // ═══ Sop CRUD ═══

  async getSop(id: string): Promise<Sop | null> {
    const result = await this.connection.query<Sop>(
      "SELECT * FROM sop WHERE id = ?",
      [id]
    );
    return result.rows[0] ?? null;
  }

  async getSopByKey(source: SopSource, key: string): Promise<Sop | null> {
    const result = await this.connection.query<Sop>(
      "SELECT * FROM sop WHERE source = ? AND key = ?",
      [source, key]
    );
    return result.rows[0] ?? null;
  }

  async listSops(source?: SopSource): Promise<Sop[]> {
    if (source) {
      const result = await this.connection.query<Sop>(
        "SELECT * FROM sop WHERE source = ? ORDER BY name",
        [source]
      );
      return result.rows;
    }
    const result = await this.connection.query<Sop>(
      "SELECT * FROM sop ORDER BY name"
    );
    return result.rows;
  }

  async saveSop(input: CreateSopInput): Promise<Sop> {
    const id = `sop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.connection.execute(
      `INSERT INTO sop (id, source, source_ref, key, name, description, first_stage, shared_handbook)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.source,
        input.source_ref ?? null,
        input.key,
        input.name,
        input.description ?? null,
        input.first_stage ?? null,
        input.shared_handbook ?? null,
      ]
    );
    const sop = await this.getSop(id);
    if (!sop) throw new Error("Failed to save sop");
    return sop;
  }

  async deleteSop(id: string): Promise<void> {
    await this.connection.execute(
      "DELETE FROM sop WHERE id = ?",
      [id]
    );
  }

  // ═══ SopStageDefinition CRUD ═══

  async getSopStageDefinition(id: string): Promise<SopStageDefinition | null> {
    const result = await this.connection.query<SopStageDefinition>(
      "SELECT * FROM sop_stage_definition WHERE id = ?",
      [id]
    );
    if (result.rows[0]) {
      return {
        ...result.rows[0],
        acceptance_focus: JSON.parse(result.rows[0].acceptance_focus as unknown as string),
        acceptance_checklist: JSON.parse(result.rows[0].acceptance_checklist as unknown as string),
      };
    }
    return null;
  }

  async listSopStageDefinitions(sopId: string): Promise<SopStageDefinition[]> {
    const result = await this.connection.query<SopStageDefinition>(
      "SELECT * FROM sop_stage_definition WHERE sop_id = ? ORDER BY sequence ASC",
      [sopId]
    );
    return result.rows.map((row) => ({
      ...row,
      acceptance_focus: JSON.parse(row.acceptance_focus as unknown as string),
      acceptance_checklist: JSON.parse(row.acceptance_checklist as unknown as string),
    }));
  }

  async saveSopStageDefinition(input: CreateSopStageDefinitionInput): Promise<SopStageDefinition> {
    const id = `stage-def-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.connection.execute(
      `INSERT INTO sop_stage_definition (id, sop_id, key, title, sequence, input_description, output_description, acceptance_focus, acceptance_checklist)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.sop_id,
        input.key,
        input.title,
        input.sequence,
        input.input_description ?? null,
        input.output_description ?? null,
        JSON.stringify(input.acceptance_focus ?? []),
        JSON.stringify(input.acceptance_checklist ?? []),
      ]
    );
    const definition = await this.getSopStageDefinition(id);
    if (!definition) throw new Error("Failed to save sop stage definition");
    return definition;
  }

  // ═══ SopStageRoleDefinition CRUD ═══

  async getSopStageRoleDefinition(id: string): Promise<SopStageRoleDefinition | null> {
    const result = await this.connection.query<SopStageRoleDefinition>(
      "SELECT * FROM sop_stage_role_definition WHERE id = ?",
      [id]
    );
    return result.rows[0] ?? null;
  }

  async listSopStageRoleDefinitions(stageDefinitionId: string): Promise<SopStageRoleDefinition[]> {
    const result = await this.connection.query<SopStageRoleDefinition>(
      "SELECT * FROM sop_stage_role_definition WHERE stage_definition_id = ?",
      [stageDefinitionId]
    );
    return result.rows;
  }

  async saveSopStageRoleDefinition(input: CreateSopStageRoleDefinitionInput): Promise<SopStageRoleDefinition> {
    const id = `role-def-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.connection.execute(
      `INSERT INTO sop_stage_role_definition (id, stage_definition_id, key, name, description, handbook, is_primary, count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.stage_definition_id,
        input.key,
        input.name,
        input.description ?? "",
        input.handbook ?? null,
        input.is_primary ? 1 : 0,
        input.count ?? 1,
      ]
    );
    const definition = await this.getSopStageRoleDefinition(id);
    if (!definition) throw new Error("Failed to save sop stage role definition");
    return definition;
  }

  // ═══ SopTransition CRUD ═══

  async getSopTransitions(sopId: string): Promise<SopTransition[]> {
    const result = await this.connection.query<SopTransition>(
      "SELECT * FROM sop_transition WHERE sop_id = ?",
      [sopId]
    );
    return result.rows.map((row) => ({
      ...row,
      guard: row.guard ? JSON.parse(row.guard as unknown as string) : null,
    }));
  }

  async getForwardTransitions(sopId: string, fromStageKey: string): Promise<SopTransition[]> {
    const result = await this.connection.query<SopTransition>(
      "SELECT * FROM sop_transition WHERE sop_id = ? AND from_stage_key = ?",
      [sopId, fromStageKey]
    );
    return result.rows.map((row) => ({
      ...row,
      guard: row.guard ? JSON.parse(row.guard as unknown as string) : null,
    }));
  }

  async saveSopTransition(input: CreateSopTransitionInput): Promise<SopTransition> {
    const id = `transition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.connection.execute(
      `INSERT INTO sop_transition (id, sop_id, from_stage_key, to_stage_key, guard)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        input.sop_id,
        input.from_stage_key,
        input.to_stage_key,
        input.guard ? JSON.stringify(input.guard) : null,
      ]
    );
    const transition: SopTransition = {
      id,
      sop_id: input.sop_id,
      from_stage_key: input.from_stage_key,
      to_stage_key: input.to_stage_key,
      guard: input.guard ?? null,
    };
    return transition;
  }

  // ═══ 查询方法 ═══

  async validateTransition(sopId: string, fromStageKey: string, toStageKey: string): Promise<SopTransition | null> {
    const transitions = await this.getForwardTransitions(sopId, fromStageKey);
    return transitions.find((t) => t.to_stage_key === toStageKey) ?? null;
  }

  async listSopStageDefinitionsWithRoles(sopId: string): Promise<Array<SopStageDefinition & { roles: SopStageRoleDefinition[] }>> {
    const definitions = await this.listSopStageDefinitions(sopId);
    const result: Array<SopStageDefinition & { roles: SopStageRoleDefinition[] }> = [];
    for (const def of definitions) {
      const roles = await this.listSopStageRoleDefinitions(def.id);
      result.push({ ...def, roles });
    }
    return result;
  }
}
