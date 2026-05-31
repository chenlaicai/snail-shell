import type Database from "better-sqlite3";
import type { Sop, SopRoleDefinition, SopStageDefinition, StageRole } from "./types";

// ── SOP CRUD ────────────────────────────────────────────────────────

/** 从 YAML 文件加载 SOP 时使用的 upsert 输入。 */
export interface SopUpsertInput {
  id: string;
  source: "platform" | "workspace";
  sourceRef: string | null;
  key: string;
  name: string;
  description: string | null;
}

/**
 * Upsert SOP 定义及其子表（role_definition, stage_definition, stage_role）。
 * 以 YAML 为准：已存在则覆盖更新，不存在则插入。
 *
 * Why: 启动时从 YAML 文件加载 SOP，文件是唯一真实来源，
 * 数据库只是运行时便捷层，必须与文件保持一致。
 */
export function upsertSopFromYaml(
  db: Database.Database,
  sop: SopUpsertInput,
  roleDefinitions: Array<{
    key: string;
    name: string;
    description?: string;
    handbook_prompt_ref?: string | null;
    working_rules?: string[];
  }>,
  stageDefinitions: Array<{
    key: string;
    title: string;
    sequence: number;
    input_description?: string | null;
    output_description?: string | null;
    acceptance_focus?: string[];
    roles: Array<{
      role_key: string;
      is_primary?: boolean;
      working_rules_override?: string[] | null;
    }>;
  }>,
): void {
  db.transaction(() => {
    /* 删除旧的子表数据（CASCADE 会处理 role_definition → stage_role），
       然后重新插入，确保与 YAML 完全一致。 */
    db.prepare("DELETE FROM role_definition WHERE sop_id = ?").run(sop.id);
    db.prepare("DELETE FROM stage_definition WHERE sop_id = ?").run(sop.id);

    /* Upsert SOP 主表 */
    db.prepare(
      `INSERT INTO sop (id, source, source_ref, key, name, description)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source = excluded.source,
         source_ref = excluded.source_ref,
         name = excluded.name,
         description = excluded.description,
         updated_at = datetime('now')`
    ).run(sop.id, sop.source, sop.sourceRef, sop.key, sop.name, sop.description ?? null);

    /* 插入 role_definition */
    const roleIdByKey = new Map<string, string>();
    for (const rd of roleDefinitions) {
      const roleId = `rd-${sop.id}-${rd.key}`;
      db.prepare(
        "INSERT INTO role_definition (id, sop_id, key, name, description, handbook_prompt_ref, working_rules) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(roleId, sop.id, rd.key, rd.name, rd.description ?? "", rd.handbook_prompt_ref ?? null, JSON.stringify(rd.working_rules ?? []));
      roleIdByKey.set(rd.key, roleId);
    }

    /* 插入 stage_definition + stage_role */
    for (const sd of stageDefinitions) {
      const stageDefId = `sd-${sop.id}-${sd.key}`;
      db.prepare(
        "INSERT INTO stage_definition (id, sop_id, key, title, sequence, input_description, output_description, acceptance_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(stageDefId, sop.id, sd.key, sd.title, sd.sequence, sd.input_description ?? null, sd.output_description ?? null, JSON.stringify(sd.acceptance_focus ?? []));
      for (const sr of sd.roles) {
        const roleDefId = roleIdByKey.get(sr.role_key);
        if (!roleDefId) throw new Error(`role_key "${sr.role_key}" not found in SOP "${sop.id}" role_definitions`);
        db.prepare(
          "INSERT INTO stage_role (id, stage_definition_id, role_definition_id, is_primary, working_rules_override) VALUES (?, ?, ?, ?, ?)"
        ).run(`sr-${stageDefId}-${sr.role_key}`, stageDefId, roleDefId, sr.is_primary ? 1 : 0, sr.working_rules_override ? JSON.stringify(sr.working_rules_override) : null);
      }
    }
  })();
}

export function getSop(db: Database.Database, id: string): Sop | undefined {
  return db.prepare("SELECT * FROM sop WHERE id = ?").get(id) as Sop | undefined;
}

export function getSopByKey(db: Database.Database, source: "platform" | "workspace", key: string): Sop | undefined {
  return db.prepare("SELECT * FROM sop WHERE source = ? AND key = ?").get(source, key) as Sop | undefined;
}

export function listSops(db: Database.Database, source?: "platform" | "workspace"): Sop[] {
  if (source) return db.prepare("SELECT * FROM sop WHERE source = ? ORDER BY key ASC").all(source) as Sop[];
  return db.prepare("SELECT * FROM sop ORDER BY source ASC, key ASC").all() as Sop[];
}

export function listSopsByWorkspace(db: Database.Database, workspaceId: string): Sop[] {
  return db.prepare("SELECT s.* FROM sop s JOIN workspace_sop ps ON s.id = ps.sop_id WHERE ps.workspace_id = ? ORDER BY ps.is_default DESC, s.key ASC").all(workspaceId) as Sop[];
}

// ── SOP Role Definition CRUD ────────────────────────────────────────

export function getSopRoleDefinition(db: Database.Database, id: string): SopRoleDefinition | undefined {
  const row = db.prepare("SELECT * FROM role_definition WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapSopRoleDefinition(row) : undefined;
}

export function listSopRoleDefinitions(db: Database.Database, sopId: string): SopRoleDefinition[] {
  const rows = db.prepare("SELECT * FROM role_definition WHERE sop_id = ? ORDER BY key ASC").all(sopId) as Record<string, unknown>[];
  return rows.map(mapSopRoleDefinition);
}

// ── SOP Stage Definition CRUD ───────────────────────────────────────

export function getSopStageDefinition(db: Database.Database, id: string): SopStageDefinition | undefined {
  const row = db.prepare("SELECT * FROM stage_definition WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapSopStageDefinition(row) : undefined;
}

export function getSopStageDefinitionByKey(db: Database.Database, sopId: string, key: string): SopStageDefinition | undefined {
  const row = db.prepare("SELECT * FROM stage_definition WHERE sop_id = ? AND key = ?").get(sopId, key) as Record<string, unknown> | undefined;
  return row ? mapSopStageDefinition(row) : undefined;
}

export function listSopStageDefinitions(db: Database.Database, sopId: string): SopStageDefinition[] {
  const rows = db.prepare("SELECT * FROM stage_definition WHERE sop_id = ? ORDER BY sequence ASC").all(sopId) as Record<string, unknown>[];
  return rows.map(mapSopStageDefinition);
}

// ── Stage Role CRUD ─────────────────────────────────────────────────

export function listStageRoles(db: Database.Database, stageDefinitionId: string): StageRole[] {
  const rows = db.prepare("SELECT * FROM stage_role WHERE stage_definition_id = ? ORDER BY is_primary DESC, rowid ASC").all(stageDefinitionId) as Record<string, unknown>[];
  return rows.map(mapStageRole);
}

// ── Mappers ─────────────────────────────────────────────────────────

function parseJsonArray<T extends string>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapSopRoleDefinition(row: Record<string, unknown>): SopRoleDefinition {
  return {
    id: row.id as string,
    sop_id: row.sop_id as string,
    key: row.key as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    handbook_prompt_ref: row.handbook_prompt_ref as string | null,
    working_rules: parseJsonArray(row.working_rules as string | null),
  };
}

function mapSopStageDefinition(row: Record<string, unknown>): SopStageDefinition {
  return {
    id: row.id as string,
    sop_id: row.sop_id as string,
    key: row.key as string,
    title: row.title as string,
    sequence: row.sequence as number,
    input_description: row.input_description as string | null,
    output_description: row.output_description as string | null,
    acceptance_focus: parseJsonArray(row.acceptance_focus as string | null),
  };
}

function mapStageRole(row: Record<string, unknown>): StageRole {
  return {
    id: row.id as string,
    stage_definition_id: row.stage_definition_id as string,
    role_definition_id: row.role_definition_id as string,
    is_primary: row.is_primary as number,
    working_rules_override: row.working_rules_override ? parseJsonArray(row.working_rules_override as string) : null,
  };
}
