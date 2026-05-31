import type Database from "better-sqlite3";
import type { WorkspaceStageDefinition, StageRoleDefinition, Sop, SopRoleDefinition, SopStageDefinition, StageRole, WorkspaceSop } from "./types";
export { replaceWorkspaceConfigs } from "./workspace-config-replace";

// ── Seed Types ──────────────────────────────────────────────────────

export interface SopSeedItem {
  sop: { id: string; scope: "global" | "workspace"; key: string; name: string; description?: string | null };
  role_definitions: Array<{
    id: string;
    key: string;
    name: string;
    description?: string;
    handbook_prompt_ref?: string | null;
    working_rules?: string[];
  }>;
  stage_definitions: Array<{
    id: string;
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
  }>;
}

export interface WorkspaceSeedItem {
  workspace: { id: string; module: string; name: string; summary: string; workspace_root: string; guard_profile?: Record<string, unknown> | null };
  sops: Array<{
    sop_id: string;
    is_default: boolean;
    role_bindings: Record<string, string>;
  }>;
}

export interface WorkspaceConfigSeed {
  sops: SopSeedItem[];
  workspaces: WorkspaceSeedItem[];
}

// ── Seed Function ───────────────────────────────────────────────────

export function seedWorkspaceConfigs(db: Database.Database, seed: WorkspaceConfigSeed): { created: boolean } {
  let createdAny = false;
  const transaction = db.transaction(() => {
    for (const sopSeed of seed.sops) {
      if (seedSingleSop(db, sopSeed)) createdAny = true;
    }
    for (const workspaceSeed of seed.workspaces) {
      if (seedSingleWorkspace(db, workspaceSeed)) createdAny = true;
    }
  });
  transaction();
  return { created: createdAny };
}

function seedSingleSop(db: Database.Database, sopSeed: SopSeedItem): boolean {
  if (db.prepare("SELECT id FROM sop WHERE id = ?").get(sopSeed.sop.id)) return false;
  const scopeRef = sopSeed.sop.scope === "workspace" ? (sopSeed.sop as Record<string, unknown>).scope_ref as string ?? null : null;
  db.prepare("INSERT INTO sop (id, scope, scope_ref, key, name, description) VALUES (?, ?, ?, ?, ?, ?)").run(sopSeed.sop.id, sopSeed.sop.scope, scopeRef, sopSeed.sop.key, sopSeed.sop.name, sopSeed.sop.description ?? null);
  const roleIdByKey = insertSopRoleDefinitions(db, sopSeed);
  insertSopStageDefinitions(db, sopSeed, roleIdByKey);
  return true;
}

function insertSopRoleDefinitions(db: Database.Database, sopSeed: SopSeedItem): Map<string, string> {
  const roleIdByKey = new Map<string, string>();
  for (const rd of sopSeed.role_definitions) {
    db.prepare("INSERT INTO role_definition (id, sop_id, key, name, description, handbook_prompt_ref, working_rules) VALUES (?, ?, ?, ?, ?, ?, ?)").run(rd.id, sopSeed.sop.id, rd.key, rd.name, rd.description ?? "", rd.handbook_prompt_ref ?? null, JSON.stringify(rd.working_rules ?? []));
    roleIdByKey.set(rd.key, rd.id);
  }
  return roleIdByKey;
}

function insertSopStageDefinitions(db: Database.Database, sopSeed: SopSeedItem, roleIdByKey: Map<string, string>): void {
  for (const sd of sopSeed.stage_definitions) {
    db.prepare("INSERT INTO stage_definition (id, sop_id, key, title, sequence, input_description, output_description, acceptance_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(sd.id, sopSeed.sop.id, sd.key, sd.title, sd.sequence, sd.input_description ?? null, sd.output_description ?? null, JSON.stringify(sd.acceptance_focus ?? []));
    for (const sr of sd.roles) {
      const roleDefId = roleIdByKey.get(sr.role_key);
      if (!roleDefId) throw new Error(`role_key "${sr.role_key}" not found in SOP "${sopSeed.sop.id}" role_definitions`);
      db.prepare("INSERT INTO stage_role (id, stage_definition_id, role_definition_id, is_primary, working_rules_override) VALUES (?, ?, ?, ?, ?)").run(`sr-${sd.id}-${sr.role_key}`, sd.id, roleDefId, sr.is_primary ? 1 : 0, sr.working_rules_override ? JSON.stringify(sr.working_rules_override) : null);
    }
  }
}

function seedSingleWorkspace(db: Database.Database, workspaceSeed: WorkspaceSeedItem): boolean {
  if (db.prepare("SELECT id FROM workspace WHERE id = ?").get(workspaceSeed.workspace.id)) {
    if (workspaceSeed.workspace.guard_profile != null) {
      db.prepare("UPDATE workspace SET guard_profile = ?, updated_at = datetime('now') WHERE id = ? AND guard_profile IS NULL").run(JSON.stringify(workspaceSeed.workspace.guard_profile), workspaceSeed.workspace.id);
    }
    return false;
  }
  db.prepare("INSERT INTO workspace (id, module, name, workspace_root, summary, status, guard_profile) VALUES (?, ?, ?, ?, ?, 'active', ?)").run(workspaceSeed.workspace.id, workspaceSeed.workspace.module, workspaceSeed.workspace.name, workspaceSeed.workspace.workspace_root, workspaceSeed.workspace.summary, workspaceSeed.workspace.guard_profile ? JSON.stringify(workspaceSeed.workspace.guard_profile) : null);
  for (const sopBinding of workspaceSeed.sops) {
    db.prepare("INSERT INTO workspace_sop (id, workspace_id, sop_id, is_default, role_bindings) VALUES (?, ?, ?, ?, ?)").run(`ps-${workspaceSeed.workspace.id}-${sopBinding.sop_id}`, workspaceSeed.workspace.id, sopBinding.sop_id, sopBinding.is_default ? 1 : 0, JSON.stringify(sopBinding.role_bindings));
  }
  return true;
}

// ── SOP CRUD ────────────────────────────────────────────────────────
export function getSop(db: Database.Database, id: string): Sop | undefined {
  return db.prepare("SELECT * FROM sop WHERE id = ?").get(id) as Sop | undefined;
}
export function getGlobalSopByKey(db: Database.Database, key: string): Sop | undefined {
  return db.prepare("SELECT * FROM sop WHERE scope = 'global' AND key = ?").get(key) as Sop | undefined;
}
export function listSops(db: Database.Database, scope?: "global" | "workspace"): Sop[] {
  if (scope) return db.prepare("SELECT * FROM sop WHERE scope = ? ORDER BY key ASC").all(scope) as Sop[];
  return db.prepare("SELECT * FROM sop ORDER BY scope ASC, key ASC").all() as Sop[];
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

// ── Workspace SOP CRUD ────────────────────────────────────────────────

export function getWorkspaceSop(db: Database.Database, workspaceId: string, sopId: string): WorkspaceSop | undefined {
  const row = db.prepare("SELECT * FROM workspace_sop WHERE workspace_id = ? AND sop_id = ?").get(workspaceId, sopId) as Record<string, unknown> | undefined;
  return row ? mapWorkspaceSop(row) : undefined;
}

export function listWorkspaceSops(db: Database.Database, workspaceId: string): WorkspaceSop[] {
  const rows = db.prepare("SELECT * FROM workspace_sop WHERE workspace_id = ? ORDER BY is_default DESC").all(workspaceId) as Record<string, unknown>[];
  return rows.map(mapWorkspaceSop);
}

export function getDefaultWorkspaceSop(db: Database.Database, workspaceId: string): WorkspaceSop | undefined {
  const row = db.prepare("SELECT * FROM workspace_sop WHERE workspace_id = ? AND is_default = 1").get(workspaceId) as Record<string, unknown> | undefined;
  return row ? mapWorkspaceSop(row) : undefined;
}

export function createWorkspaceSop(db: Database.Database, input: { id: string; workspaceId: string; sopId: string; isDefault: boolean; roleBindings: Record<string, string> }): WorkspaceSop {
  db.prepare("INSERT INTO workspace_sop (id, workspace_id, sop_id, is_default, role_bindings) VALUES (?, ?, ?, ?, ?)").run(input.id, input.workspaceId, input.sopId, input.isDefault ? 1 : 0, JSON.stringify(input.roleBindings));
  return getWorkspaceSop(db, input.workspaceId, input.sopId)!;
}

export function updateWorkspaceSop(db: Database.Database, workspaceId: string, sopId: string, updates: { isDefault?: boolean; roleBindings?: Record<string, string> }): WorkspaceSop {
  const existing = getWorkspaceSop(db, workspaceId, sopId);
  if (!existing) throw new Error(`WorkspaceSop not found: workspace=${workspaceId} sop=${sopId}`);
  const isDefault = updates.isDefault !== undefined ? (updates.isDefault ? 1 : 0) : existing.is_default;
  const roleBindings = updates.roleBindings !== undefined ? JSON.stringify(updates.roleBindings) : JSON.stringify(existing.role_bindings);
  db.prepare("UPDATE workspace_sop SET is_default = ?, role_bindings = ? WHERE workspace_id = ? AND sop_id = ?").run(isDefault, roleBindings, workspaceId, sopId);
  return getWorkspaceSop(db, workspaceId, sopId)!;
}

export function deleteWorkspaceSop(db: Database.Database, workspaceId: string, sopId: string): void {
  const existing = getWorkspaceSop(db, workspaceId, sopId);
  if (!existing) throw new Error(`WorkspaceSop not found: workspace=${workspaceId} sop=${sopId}`);
  const referencingFeature = db.prepare("SELECT id FROM feature WHERE workspace_id = ? AND adopted_sop_id = ? LIMIT 1").get(workspaceId, sopId) as { id: string } | undefined;
  if (referencingFeature) throw new Error(`Cannot remove SOP binding: feature ${referencingFeature.id} references it`);
  db.prepare("DELETE FROM workspace_sop WHERE workspace_id = ? AND sop_id = ?").run(workspaceId, sopId);
}

// ── Bridge: Old Query Functions (return old shapes from new tables) ──

/**
 * Bridge: returns WorkspaceStageDefinition shape from new stage_definition table.
 * Resolves workspace_id via workspace_sop→sop→stage_definition chain.
 */
export function getStageDefinition(db: Database.Database, id: string): WorkspaceStageDefinition | undefined {
  const row = db.prepare(`
    SELECT sd.*, ps.workspace_id
    FROM stage_definition sd
    JOIN sop s ON sd.sop_id = s.id
    JOIN workspace_sop ps ON ps.sop_id = s.id
    WHERE sd.id = ?
    LIMIT 1
  `).get(id) as Record<string, unknown> | undefined;
  return row ? mapBridgeStageDefinition(row) : undefined;
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
  return row ? mapBridgeStageDefinition(row) : undefined;
}

export function listStageDefinitions(db: Database.Database, workspaceId: string): WorkspaceStageDefinition[] {
  const rows = db.prepare(`
    SELECT sd.*, ps.workspace_id
    FROM stage_definition sd
    JOIN workspace_sop ps ON ps.sop_id = sd.sop_id
    WHERE ps.workspace_id = ?
    ORDER BY ps.is_default DESC, sd.sequence ASC
  `).all(workspaceId) as Record<string, unknown>[];
  return rows.map(mapBridgeStageDefinition);
}

/**
 * Bridge: returns StageRoleDefinition shape from new tables.
 * Each stage_role entry becomes one row, with snail_template_id resolved from workspace_sop.role_bindings.
 */
export function getRoleDefinition(db: Database.Database, id: string): StageRoleDefinition | undefined {
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
  return row ? mapBridgeRoleDefinition(row) : undefined;
}

export function listRoleDefinitions(db: Database.Database, stageDefinitionId: string): StageRoleDefinition[] {
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
  return rows.map(mapBridgeRoleDefinition);
}

export function listRoleDefinitionsByStageAndWorkspace(db: Database.Database, stageDefinitionId: string, workspaceId: string): StageRoleDefinition[] {
  return (db.prepare(`SELECT sr.id, sr.stage_definition_id, sr.is_primary, sr.working_rules_override, rd.name, rd.key AS role_key, rd.description, rd.handbook_prompt_ref, rd.working_rules, ps.workspace_id, ps.role_bindings FROM stage_role sr JOIN role_definition rd ON sr.role_definition_id = rd.id JOIN sop s ON rd.sop_id = s.id JOIN workspace_sop ps ON ps.sop_id = s.id WHERE sr.stage_definition_id = ? AND ps.workspace_id = ? ORDER BY sr.is_primary DESC, sr.rowid ASC`).all(stageDefinitionId, workspaceId) as Record<string, unknown>[]).map(mapBridgeRoleDefinition);
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
  return rows.map(mapBridgeRoleDefinition);
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
  return rows.map((row) => ({ ...mapBridgeRoleDefinition(row), workspace_id: row.workspace_id as string }));
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

function parseJsonRecord(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
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

function mapWorkspaceSop(row: Record<string, unknown>): WorkspaceSop {
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    sop_id: row.sop_id as string,
    is_default: row.is_default as number,
    role_bindings: parseJsonRecord(row.role_bindings as string | null),
  };
}

function mapBridgeStageDefinition(row: Record<string, unknown>): WorkspaceStageDefinition {
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

function mapBridgeRoleDefinition(row: Record<string, unknown>): StageRoleDefinition {
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

