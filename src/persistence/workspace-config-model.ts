import type Database from "better-sqlite3";
import type { WorkspaceStageDefinition, StageRoleDefinition, WorkspaceSop } from "./types";
export { replaceWorkspaceConfigs } from "./workspace-config-replace";

// ── Seed Types ──────────────────────────────────────────────────────

export interface WorkspaceSeedItem {
  workspace: { id: string; module: string; name: string; summary: string; workspace_root: string; guard_profile?: Record<string, unknown> | null };
  sops: Array<{
    sop_id: string;
    is_default: boolean;
    role_bindings: Record<string, string>;
  }>;
}

export interface WorkspaceConfigSeed {
  workspaces: WorkspaceSeedItem[];
}

// ── Seed Function ───────────────────────────────────────────────────

/**
 * 从 seed JSON 加载 workspace 定义和 workspace_sop 绑定。
 * SOP 定义已由 sop-loader.ts 从 YAML 文件加载，此处只处理 workspace 和绑定关系。
 */
export function seedWorkspaceConfigs(db: Database.Database, seed: WorkspaceConfigSeed): { created: boolean } {
  let createdAny = false;
  const transaction = db.transaction(() => {
    for (const workspaceSeed of seed.workspaces) {
      if (seedSingleWorkspace(db, workspaceSeed)) createdAny = true;
    }
  });
  transaction();
  return { created: createdAny };
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

