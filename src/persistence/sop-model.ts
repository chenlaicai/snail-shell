import type Database from "better-sqlite3";
import type { Sop, SopStageDefinition, WorkspaceStageDefinition, StageRoleDefinition, StageChecklistItem } from "./types";

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

/** YAML 中 stage 定义内嵌的角色定义。 */
export interface YamlStageRoleDefinition {
  key: string;
  name: string;
  description?: string;
  handbook_prompt_ref?: string | null;
  working_rules?: string[];
  is_primary?: boolean;
  /** 该角色在本 Stage 的实例数。默认 1。count=2 展开为 "检视者-1"、"检视者-2"。 */
  count?: number;
}

/** YAML 中 stage 定义，包含内嵌角色。 */
export interface YamlStageDefinition {
  key: string;
  title: string;
  sequence: number;
  input_description?: string | null;
  output_description?: string | null;
  acceptance_focus?: string[];
  acceptance_checklist?: Array<{ id: string; description: string; required: boolean }>;
  roles: YamlStageRoleDefinition[];
}

/**
 * Upsert SOP 定义及其子表（stage_definition, stage_role_definition）。
 * 以 YAML 为准：已存在则覆盖更新，不存在则插入。
 *
 * Why: 启动时从 YAML 文件加载 SOP，文件是唯一真实来源，
 * 数据库只是运行时便捷层，必须与文件保持一致。
 */
export function upsertSopFromYaml(
  db: Database.Database,
  sop: SopUpsertInput,
  stageDefinitions: YamlStageDefinition[],
): void {
  db.transaction(() => {
    /* 删除旧的子表数据，然后重新插入，确保与 YAML 完全一致。 */
    db.prepare("DELETE FROM stage_definition WHERE sop_id = ?").run(sop.id);

    upsertSopRow(db, sop);
    insertStageDefinitions(db, sop.id, stageDefinitions);
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

function insertStageDefinitions(
  db: Database.Database,
  sopId: string,
  stageDefinitions: YamlStageDefinition[],
): void {
  for (const sd of stageDefinitions) {
    const stageDefId = `sd-${sopId}-${sd.key}`;
    db.prepare(
      "INSERT INTO stage_definition (id, sop_id, key, title, sequence, input_description, output_description, acceptance_focus, acceptance_checklist) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(stageDefId, sopId, sd.key, sd.title, sd.sequence, sd.input_description ?? null, sd.output_description ?? null, JSON.stringify(sd.acceptance_focus ?? []), JSON.stringify(sd.acceptance_checklist ?? []));
    insertStageRoleDefinitions(db, stageDefId, sd.roles ?? []);
  }
}

/**
 * 插入 stage 下的角色定义。count > 1 时展开为多个实例。
 *
 * 展开规则：count=1 → name 不变；count=2 → "检视者-1"、"检视者-2"。
 * Why: 系统层面每个角色实例是独立的 DB 行，拥有独立的 snail_template_id 绑定。
 * SOP YAML 中只描述一个 role + count，展开在加载时完成，下游无需关心 count 语义。
 */
function insertStageRoleDefinitions(
  db: Database.Database,
  stageDefinitionId: string,
  roles: YamlStageRoleDefinition[],
): void {
  for (const rd of roles) {
    const count = rd.count ?? 1;
    for (let i = 1; i <= count; i++) {
      const instanceSuffix = count > 1 ? `-${i}` : "";
      const roleDefId = `srd-${stageDefinitionId}-${rd.key}${instanceSuffix}`;
      const instanceName = `${rd.name}${instanceSuffix}`;
      db.prepare(
        "INSERT INTO stage_role_definition (id, stage_definition_id, key, name, description, handbook_prompt_ref, working_rules, is_primary, count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(roleDefId, stageDefinitionId, rd.key, instanceName, rd.description ?? "", rd.handbook_prompt_ref ?? null, JSON.stringify(rd.working_rules ?? []), rd.is_primary ? 1 : 0, count);
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

// ── SOP Stage Role Definition CRUD ──────────────────────────────────

export function listSopStageRoleDefinitions(db: Database.Database, stageDefinitionId: string): StageRoleDefinition[] {
  const rows = db.prepare("SELECT * FROM stage_role_definition WHERE stage_definition_id = ? ORDER BY is_primary DESC, rowid ASC").all(stageDefinitionId) as Record<string, unknown>[];
  return rows.map(mapStageRoleDefinition);
}

/** 返回 SOP 的所有 stage 定义，每个 stage 嵌套其角色定义。 */
export function listSopStageDefinitionsWithRoles(db: Database.Database, sopId: string): Array<SopStageDefinition & { roles: StageRoleDefinition[] }> {
  const stages = listSopStageDefinitions(db, sopId);
  return stages.map((stage) => ({
    ...stage,
    roles: listSopStageRoleDefinitions(db, stage.id),
  }));
}

/**
 * 收集 SOP 下所有 stage 的 role key 集合。
 *
 * Why: assertRoleBindingsCoverSop 需要校验 role_bindings 覆盖 SOP 定义的所有角色。
 * 旧模型通过 sop 级 role_definition 查询，新模型角色在 stage 下，
 * 需要遍历所有 stage 收集去重的 role key。
 */
export function collectSopRoleKeys(db: Database.Database, sopId: string): Set<string> {
  const rows = db.prepare(`
    SELECT DISTINCT srd.key
    FROM stage_role_definition srd
    JOIN stage_definition sd ON srd.stage_definition_id = sd.id
    WHERE sd.sop_id = ?
  `).all(sopId) as Array<{ key: string }>;
  return new Set(rows.map((r) => r.key));
}

// ── Workspace-scoped SOP queries ────────────────────────────────────────
/**
 * 通过 workspace_sop 绑定解析 workspace 上下文的 stage/role 定义查询。
 *
 * Why: 数据模型中 stage_definition 和 stage_role_definition 隶属于 sop，
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
    SELECT srd.id, srd.stage_definition_id, srd.key, srd.name, srd.description,
           srd.handbook_prompt_ref, srd.working_rules, srd.is_primary,
           ps.workspace_id, ps.role_bindings
    FROM stage_role_definition srd
    JOIN stage_definition sd ON srd.stage_definition_id = sd.id
    JOIN sop s ON sd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE srd.id = ?
    LIMIT 1
  `).get(id) as Record<string, unknown> | undefined;
  return row ? mapWorkspaceRoleDefinition(row) : undefined;
}

export function listRoleDefinitionsByStage(db: Database.Database, stageDefinitionId: string): StageRoleDefinition[] {
  const rows = db.prepare(`
    SELECT srd.id, srd.stage_definition_id, srd.key, srd.name, srd.description,
           srd.handbook_prompt_ref, srd.working_rules, srd.is_primary,
           ps.workspace_id, ps.role_bindings
    FROM stage_role_definition srd
    JOIN stage_definition sd ON srd.stage_definition_id = sd.id
    JOIN sop s ON sd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE srd.stage_definition_id = ?
    ORDER BY srd.is_primary DESC, srd.rowid ASC
  `).all(stageDefinitionId) as Record<string, unknown>[];
  return rows.map(mapWorkspaceRoleDefinition);
}

export function listRoleDefinitionsByStageAndWorkspace(db: Database.Database, stageDefinitionId: string, workspaceId: string): StageRoleDefinition[] {
  return (db.prepare(`
    SELECT srd.id, srd.stage_definition_id, srd.key, srd.name, srd.description,
           srd.handbook_prompt_ref, srd.working_rules, srd.is_primary,
           ps.workspace_id, ps.role_bindings
    FROM stage_role_definition srd
    JOIN stage_definition sd ON srd.stage_definition_id = sd.id
    JOIN sop s ON sd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE srd.stage_definition_id = ? AND ps.workspace_id = ?
    ORDER BY srd.is_primary DESC, srd.rowid ASC
  `).all(stageDefinitionId, workspaceId) as Record<string, unknown>[]).map(mapWorkspaceRoleDefinition);
}

export function listRoleDefinitionsByWorkspace(db: Database.Database, workspaceId: string): StageRoleDefinition[] {
  const rows = db.prepare(`
    SELECT srd.id, srd.stage_definition_id, srd.key, srd.name, srd.description,
           srd.handbook_prompt_ref, srd.working_rules, srd.is_primary,
           ps.workspace_id, ps.role_bindings
    FROM stage_role_definition srd
    JOIN stage_definition sd ON srd.stage_definition_id = sd.id
    JOIN sop s ON sd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE ps.workspace_id = ?
    ORDER BY sd.sequence ASC, srd.is_primary DESC, srd.rowid ASC
  `).all(workspaceId) as Record<string, unknown>[];
  return rows.map(mapWorkspaceRoleDefinition);
}

export function listAllRoleDefinitions(db: Database.Database): Array<StageRoleDefinition & { workspace_id: string }> {
  const rows = db.prepare(`
    SELECT srd.id, srd.stage_definition_id, srd.key, srd.name, srd.description,
           srd.handbook_prompt_ref, srd.working_rules, srd.is_primary,
           ps.workspace_id, ps.role_bindings
    FROM stage_role_definition srd
    JOIN stage_definition sd ON srd.stage_definition_id = sd.id
    JOIN sop s ON sd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    ORDER BY ps.workspace_id, srd.is_primary DESC, srd.rowid ASC
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

function parseChecklist(value: string | null): StageChecklistItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item: unknown) =>
      typeof item === "object" && item !== null &&
      typeof (item as Record<string, unknown>).id === "string" &&
      typeof (item as Record<string, unknown>).description === "string" &&
      typeof (item as Record<string, unknown>).required === "boolean"
    ) as StageChecklistItem[];
  } catch {
    return [];
  }
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
    acceptance_checklist: parseChecklist(row.acceptance_checklist as string | null),
  };
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
    acceptance_checklist: parseChecklist(row.acceptance_checklist as string | null),
    created_at: (row.created_at as string) ?? "",
    updated_at: (row.updated_at as string) ?? "",
  };
}

function mapStageRoleDefinition(row: Record<string, unknown>): StageRoleDefinition {
  return {
    id: row.id as string,
    stage_definition_id: row.stage_definition_id as string,
    key: row.key as string,
    name: row.name as string,
    snail_template_id: null,
    is_primary: row.is_primary as number,
    count: (row.count as number) ?? 1,
    description: (row.description as string) ?? "",
    handbook_prompt_ref: (row.handbook_prompt_ref as string) ?? null,
    working_rules: parseJsonArray(row.working_rules as string | null),
  };
}

/**
 * 从 workspace 上下文映射角色定义。snail_template_id 从 role_bindings 解析。
 *
 * role_bindings 支持两种格式：
 * - string: 同一模板用于该角色所有实例（如 count=2 时两个实例用同一模板）
 * - string[]: 逐实例绑定不同模板
 *
 * 实例索引通过 DB id 中的后缀推断：id 末尾的 "-1"/"-2" 对应数组索引 0/1。
 */
function mapWorkspaceRoleDefinition(row: Record<string, unknown>): StageRoleDefinition {
  const roleKey = row.key as string;
  const roleBindings = parseJsonRecordOrArray(row.role_bindings as string | null);
  const bindingValue = roleBindings[roleKey];
  const instanceIndex = extractInstanceIndex(row.id as string);
  const snailTemplateId = resolveSnailTemplateId(bindingValue, instanceIndex);

  return {
    id: row.id as string,
    stage_definition_id: row.stage_definition_id as string,
    key: roleKey,
    name: row.name as string,
    snail_template_id: snailTemplateId,
    is_primary: row.is_primary as number,
    count: (row.count as number) ?? 1,
    description: (row.description as string) ?? "",
    handbook_prompt_ref: (row.handbook_prompt_ref as string) ?? null,
    working_rules: parseJsonArray(row.working_rules as string | null),
  };
}

/** 从展开的实例 ID 中提取实例索引（1-based）。无后缀返回 0。 */
function extractInstanceIndex(id: string): number {
  const match = id.match(/-(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/** 从 role_bindings 值解析 snail_template_id。 */
function resolveSnailTemplateId(bindingValue: string | string[] | undefined, instanceIndex: number): string | null {
  if (!bindingValue) return null;
  if (typeof bindingValue === "string") return bindingValue;
  if (Array.isArray(bindingValue)) {
    /** instanceIndex 1-based，数组 0-based。 */
    return bindingValue[instanceIndex > 0 ? instanceIndex - 1 : 0] ?? null;
  }
  return null;
}

/** 解析可能包含数组值的 JSON record（role_bindings 支持 string | string[]）。 */
function parseJsonRecordOrArray(value: string | null): Record<string, string | string[]> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
