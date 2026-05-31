import type Database from "better-sqlite3";
import type { Sop, SopRoleDefinition, SopStageDefinition, StageRole, WorkspaceStageDefinition, StageRoleDefinition } from "./types";

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
    /* 删除旧的子表数据，然后重新插入，确保与 YAML 完全一致。 */
    db.prepare("DELETE FROM role_definition WHERE sop_id = ?").run(sop.id);
    db.prepare("DELETE FROM stage_definition WHERE sop_id = ?").run(sop.id);

    upsertSopRow(db, sop);
    const roleIdByKey = insertRoleDefinitions(db, sop.id, roleDefinitions);
    insertStageDefinitions(db, sop.id, stageDefinitions, roleIdByKey);
  })();
}

function upsertSopRow(db: Database.Database, sop: SopUpsertInput): void {
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
}

function insertRoleDefinitions(
  db: Database.Database,
  sopId: string,
  roleDefinitions: Array<{ key: string; name: string; description?: string; handbook_prompt_ref?: string | null; working_rules?: string[] }>,
): Map<string, string> {
  const roleIdByKey = new Map<string, string>();
  for (const rd of roleDefinitions) {
    const roleId = `rd-${sopId}-${rd.key}`;
    db.prepare(
      "INSERT INTO role_definition (id, sop_id, key, name, description, handbook_prompt_ref, working_rules) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(roleId, sopId, rd.key, rd.name, rd.description ?? "", rd.handbook_prompt_ref ?? null, JSON.stringify(rd.working_rules ?? []));
    roleIdByKey.set(rd.key, roleId);
  }
  return roleIdByKey;
}

function insertStageDefinitions(
  db: Database.Database,
  sopId: string,
  stageDefinitions: Array<{
    key: string; title: string; sequence: number;
    input_description?: string | null; output_description?: string | null; acceptance_focus?: string[];
    roles: Array<{ role_key: string; is_primary?: boolean; working_rules_override?: string[] | null }>;
  }>,
  roleIdByKey: Map<string, string>,
): void {
  for (const sd of stageDefinitions) {
    const stageDefId = `sd-${sopId}-${sd.key}`;
    db.prepare(
      "INSERT INTO stage_definition (id, sop_id, key, title, sequence, input_description, output_description, acceptance_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(stageDefId, sopId, sd.key, sd.title, sd.sequence, sd.input_description ?? null, sd.output_description ?? null, JSON.stringify(sd.acceptance_focus ?? []));
    for (const sr of sd.roles) {
      const roleDefId = roleIdByKey.get(sr.role_key);
      if (!roleDefId) throw new Error(`role_key "${sr.role_key}" not found in SOP "${sopId}" role_definitions`);
      db.prepare(
        "INSERT INTO stage_role (id, stage_definition_id, role_definition_id, is_primary, working_rules_override) VALUES (?, ?, ?, ?, ?)"
      ).run(`sr-${stageDefId}-${sr.role_key}`, stageDefId, roleDefId, sr.is_primary ? 1 : 0, sr.working_rules_override ? JSON.stringify(sr.working_rules_override) : null);
    }
  }
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

// ── Workspace-scoped SOP queries ────────────────────────────────────────
/**
 * 通过 workspace_sop 绑定解析 workspace 上下文的 stage/role 定义查询。
 *
 * Why: 数据模型中 stage_definition 和 role_definition 隶属于 sop，
 * 不直接关联 workspace。当调用方需要在 workspace 上下文中查询这些定义时
 * （例如需要 snail_template_id 等绑定信息），通过 workspace_sop JOIN 解析。
 * 这些查询本质上是 SOP 定义数据，只是附加了 workspace 绑定上下文。
 */

export function getStageDefinitionByWorkspace(db: Database.Database, id: string): WorkspaceStageDefinition | undefined {
  const row = db.prepare(`
    SELECT sd.*, ps.workspace_id
    FROM stage_definition sd
    JOIN sop s ON sd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE sd.id = ?
    LIMIT 1
  `).get(id) as Record<string, unknown> | undefined;
  return row ? mapWorkspaceStageDefinition(row) : undefined;
}

export function getStageDefinitionByKey(db: Database.Database, workspaceId: string, key: string): WorkspaceStageDefinition | undefined {
  const row = db.prepare(`
    SELECT sd.*, ps.workspace_id
    FROM stage_definition sd
    JOIN workspace_sop ps ON ps.sop_id = sd.sop_id
    WHERE ps.workspace_id = ? AND sd.key = ?
    ORDER BY ps.is_default DESC
    LIMIT 1
  `).get(workspaceId, key) as Record<string, unknown> | undefined;
  return row ? mapWorkspaceStageDefinition(row) : undefined;
}

export function listStageDefinitions(db: Database.Database, workspaceId: string): WorkspaceStageDefinition[] {
  const rows = db.prepare(`
    SELECT sd.*, ps.workspace_id
    FROM stage_definition sd
    JOIN workspace_sop ps ON ps.sop_id = sd.sop_id
    WHERE ps.workspace_id = ?
    ORDER BY ps.is_default DESC, sd.sequence ASC
  `).all(workspaceId) as Record<string, unknown>[];
  return rows.map(mapWorkspaceStageDefinition);
}

export function getRoleDefinitionByWorkspace(db: Database.Database, id: string): StageRoleDefinition | undefined {
  const row = db.prepare(`
    SELECT sr.id, sr.stage_definition_id, sr.is_primary, sr.working_rules_override,
           rd.name, rd.key AS role_key, rd.description, rd.handbook_prompt_ref, rd.working_rules,
           ps.workspace_id, ps.role_bindings
    FROM stage_role sr
    JOIN role_definition rd ON sr.role_definition_id = rd.id
    JOIN sop s ON rd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE sr.id = ?
    LIMIT 1
  `).get(id) as Record<string, unknown> | undefined;
  return row ? mapWorkspaceRoleDefinition(row) : undefined;
}

export function listRoleDefinitionsByStage(db: Database.Database, stageDefinitionId: string): StageRoleDefinition[] {
  const rows = db.prepare(`
    SELECT sr.id, sr.stage_definition_id, sr.is_primary, sr.working_rules_override,
           rd.name, rd.key AS role_key, rd.description, rd.handbook_prompt_ref, rd.working_rules,
           ps.workspace_id, ps.role_bindings
    FROM stage_role sr
    JOIN role_definition rd ON sr.role_definition_id = rd.id
    JOIN sop s ON rd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE sr.stage_definition_id = ?
    ORDER BY sr.is_primary DESC, sr.rowid ASC
  `).all(stageDefinitionId) as Record<string, unknown>[];
  return rows.map(mapWorkspaceRoleDefinition);
}

export function listRoleDefinitionsByStageAndWorkspace(db: Database.Database, stageDefinitionId: string, workspaceId: string): StageRoleDefinition[] {
  return (db.prepare(`
    SELECT sr.id, sr.stage_definition_id, sr.is_primary, sr.working_rules_override,
           rd.name, rd.key AS role_key, rd.description, rd.handbook_prompt_ref, rd.working_rules,
           ps.workspace_id, ps.role_bindings
    FROM stage_role sr
    JOIN role_definition rd ON sr.role_definition_id = rd.id
    JOIN sop s ON rd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE sr.stage_definition_id = ? AND ps.workspace_id = ?
    ORDER BY sr.is_primary DESC, sr.rowid ASC
  `).all(stageDefinitionId, workspaceId) as Record<string, unknown>[]).map(mapWorkspaceRoleDefinition);
}

export function listRoleDefinitionsByWorkspace(db: Database.Database, workspaceId: string): StageRoleDefinition[] {
  const rows = db.prepare(`
    SELECT sr.id, sr.stage_definition_id, sr.is_primary, sr.working_rules_override,
           rd.name, rd.key AS role_key, rd.description, rd.handbook_prompt_ref, rd.working_rules,
           ps.workspace_id, ps.role_bindings
    FROM stage_role sr
    JOIN role_definition rd ON sr.role_definition_id = rd.id
    JOIN stage_definition sd ON sr.stage_definition_id = sd.id
    JOIN sop s ON rd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE ps.workspace_id = ?
    ORDER BY sd.sequence ASC, sr.is_primary DESC, sr.rowid ASC
  `).all(workspaceId) as Record<string, unknown>[];
  return rows.map(mapWorkspaceRoleDefinition);
}

export function listAllRoleDefinitions(db: Database.Database): Array<StageRoleDefinition & { workspace_id: string }> {
  const rows = db.prepare(`
    SELECT sr.id, sr.stage_definition_id, sr.is_primary, sr.working_rules_override,
           rd.name, rd.key AS role_key, rd.description, rd.handbook_prompt_ref, rd.working_rules,
           ps.workspace_id, ps.role_bindings
    FROM stage_role sr
    JOIN role_definition rd ON sr.role_definition_id = rd.id
    JOIN sop s ON rd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    ORDER BY ps.workspace_id, sr.is_primary DESC, sr.rowid ASC
  `).all() as Record<string, unknown>[];
  return rows.map((row) => ({ ...mapWorkspaceRoleDefinition(row), workspace_id: row.workspace_id as string }));
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

function parseJsonRecord(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapWorkspaceStageDefinition(row: Record<string, unknown>): WorkspaceStageDefinition {
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    key: row.key as string,
    title: row.title as string,
    sequence: row.sequence as number,
    input_description: row.input_description as string | null,
    output_description: row.output_description as string | null,
    acceptance_focus: parseJsonArray(row.acceptance_focus as string | null),
    created_at: (row.created_at as string) ?? "",
    updated_at: (row.updated_at as string) ?? "",
  };
}

function mapWorkspaceRoleDefinition(row: Record<string, unknown>): StageRoleDefinition {
  const roleKey = row.role_key as string;
  const roleBindings = parseJsonRecord(row.role_bindings as string | null);
  const baseWorkingRules = parseJsonArray<string>(row.working_rules as string | null);
  const overrideRules = row.working_rules_override ? parseJsonArray<string>(row.working_rules_override as string) : null;

  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    stage_definition_id: row.stage_definition_id as string,
    name: row.name as string,
    snail_template_id: roleBindings[roleKey] ?? null,
    is_primary: row.is_primary as number,
    description: (row.description as string) ?? "",
    handbook_prompt_ref: (row.handbook_prompt_ref as string) ?? null,
    working_rules: overrideRules ?? baseWorkingRules,
    created_at: "",
    updated_at: "",
  };
}
