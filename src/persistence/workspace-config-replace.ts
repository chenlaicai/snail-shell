import type Database from "better-sqlite3";
import type { SopSeedItem } from "./workspace-config-model";

/**
 * 全量替换指定 workspace 的配置。
 *
 * 用于从 `.snail` 目录加载配置时，删除旧的 workspace 级 SOP 及其关联数据，
 * 然后插入新配置。全局 SOP（scope='global'）不受影响。
 *
 * 注意：如果有 feature 引用了即将删除的 SOP，该 SOP 不会被删除，而是保留。
 * 这是为了避免破坏运行中的 feature 实例。
 */
export function replaceWorkspaceConfigs(
  db: Database.Database,
  workspaceId: string,
  input: {
    workspaceUpdate: { name: string; summary?: string };
    sopSeeds: SopSeedItem[];
    workspaceBindings: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string> }>;
  }
): void {
  db.transaction(() => {
    updateWorkspaceMetadata(db, workspaceId, input.workspaceUpdate);
    const currentSopIds = getCurrentWorkspaceSopIds(db, workspaceId);
    const newSopIds = new Set(input.sopSeeds.map((s) => s.sop.id));
    removeStaleSopBindings(db, workspaceId, currentSopIds, newSopIds);
    removeStaleSops(db, currentSopIds, newSopIds);
    insertOrUpdateSops(db, input.sopSeeds);
    updateWorkspaceSopBindings(db, workspaceId, input.workspaceBindings);
    ensureSingleDefaultSop(db, workspaceId, input.workspaceBindings);
  })();
}

function updateWorkspaceMetadata(db: Database.Database, workspaceId: string, update: { name: string; summary?: string }): void {
  db.prepare("UPDATE workspace SET name = ?, summary = ?, updated_at = datetime('now') WHERE id = ?").run(
    update.name,
    update.summary ?? null,
    workspaceId
  );
}

function getCurrentWorkspaceSopIds(db: Database.Database, workspaceId: string): Set<string> {
  const bindings = db.prepare("SELECT sop_id FROM workspace_sop WHERE workspace_id = ?").all(workspaceId) as Array<{ sop_id: string }>;
  return new Set(bindings.map((b) => b.sop_id));
}

function removeStaleSopBindings(db: Database.Database, workspaceId: string, currentSopIds: Set<string>, newSopIds: Set<string>): void {
  for (const sopId of currentSopIds) {
    if (newSopIds.has(sopId)) continue;
    const referencingFeature = db.prepare("SELECT id FROM feature WHERE workspace_id = ? AND adopted_sop_id = ? LIMIT 1").get(workspaceId, sopId) as { id: string } | undefined;
    if (!referencingFeature) {
      db.prepare("DELETE FROM workspace_sop WHERE workspace_id = ? AND sop_id = ?").run(workspaceId, sopId);
    }
  }
}

function removeStaleSops(db: Database.Database, currentSopIds: Set<string>, newSopIds: Set<string>): void {
  for (const sopId of currentSopIds) {
    if (newSopIds.has(sopId)) continue;
    const sop = db.prepare("SELECT scope FROM sop WHERE id = ?").get(sopId) as { scope: string } | undefined;
    if (!sop || sop.scope !== "workspace") continue;
    const referencingFeature = db.prepare("SELECT id FROM feature WHERE adopted_sop_id = ? LIMIT 1").get(sopId) as { id: string } | undefined;
    if (referencingFeature) continue;
    deleteSopCascade(db, sopId);
  }
}

function deleteSopCascade(db: Database.Database, sopId: string): void {
  const stageDefs = db.prepare("SELECT id FROM stage_definition WHERE sop_id = ?").all(sopId) as Array<{ id: string }>;
  for (const sd of stageDefs) {
    db.prepare("DELETE FROM stage_role WHERE stage_definition_id = ?").run(sd.id);
  }
  db.prepare("DELETE FROM stage_definition WHERE sop_id = ?").run(sopId);
  db.prepare("DELETE FROM role_definition WHERE sop_id = ?").run(sopId);
  db.prepare("DELETE FROM sop WHERE id = ?").run(sopId);
}

function insertOrUpdateSops(db: Database.Database, sopSeeds: SopSeedItem[]): void {
  for (const sopSeed of sopSeeds) {
    const existing = db.prepare("SELECT id FROM sop WHERE id = ?").get(sopSeed.sop.id);
    if (existing) {
      db.prepare("UPDATE sop SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(
        sopSeed.sop.name,
        sopSeed.sop.description ?? null,
        sopSeed.sop.id
      );
      deleteSopDefinitions(db, sopSeed.sop.id);
    } else {
      const scopeRef = sopSeed.sop.scope === "workspace" ? (sopSeed.sop as Record<string, unknown>).scope_ref as string ?? null : null;
      db.prepare("INSERT INTO sop (id, scope, scope_ref, key, name, description) VALUES (?, ?, ?, ?, ?, ?)").run(
        sopSeed.sop.id,
        sopSeed.sop.scope,
        scopeRef,
        sopSeed.sop.key,
        sopSeed.sop.name,
        sopSeed.sop.description ?? null
      );
    }
    insertSopDefinitions(db, sopSeed);
  }
}

function deleteSopDefinitions(db: Database.Database, sopId: string): void {
  const stageDefs = db.prepare("SELECT id FROM stage_definition WHERE sop_id = ?").all(sopId) as Array<{ id: string }>;
  for (const sd of stageDefs) {
    db.prepare("DELETE FROM stage_role WHERE stage_definition_id = ?").run(sd.id);
  }
  db.prepare("DELETE FROM stage_definition WHERE sop_id = ?").run(sopId);
  db.prepare("DELETE FROM role_definition WHERE sop_id = ?").run(sopId);
}

function insertSopDefinitions(db: Database.Database, sopSeed: SopSeedItem): void {
  const roleIdByKey = insertRoleDefinitions(db, sopSeed);
  insertStageDefinitions(db, sopSeed, roleIdByKey);
}

function insertRoleDefinitions(db: Database.Database, sopSeed: SopSeedItem): Map<string, string> {
  const roleIdByKey = new Map<string, string>();
  for (const rd of sopSeed.role_definitions) {
    db.prepare("INSERT INTO role_definition (id, sop_id, key, name, description, handbook_prompt_ref, working_rules) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      rd.id,
      sopSeed.sop.id,
      rd.key,
      rd.name,
      rd.description ?? "",
      rd.handbook_prompt_ref ?? null,
      JSON.stringify(rd.working_rules ?? [])
    );
    roleIdByKey.set(rd.key, rd.id);
  }
  return roleIdByKey;
}

function insertStageDefinitions(db: Database.Database, sopSeed: SopSeedItem, roleIdByKey: Map<string, string>): void {
  for (const sd of sopSeed.stage_definitions) {
    db.prepare("INSERT INTO stage_definition (id, sop_id, key, title, sequence, input_description, output_description, acceptance_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      sd.id,
      sopSeed.sop.id,
      sd.key,
      sd.title,
      sd.sequence,
      sd.input_description ?? null,
      sd.output_description ?? null,
      JSON.stringify(sd.acceptance_focus ?? [])
    );
    insertStageRoles(db, sd, roleIdByKey, sopSeed.sop.id);
  }
}

function insertStageRoles(db: Database.Database, sd: SopSeedItem["stage_definitions"][0], roleIdByKey: Map<string, string>, sopId: string): void {
  for (const sr of sd.roles) {
    const roleDefId = roleIdByKey.get(sr.role_key);
    if (!roleDefId) throw new Error(`role_key "${sr.role_key}" not found in SOP "${sopId}" role_definitions`);
    db.prepare("INSERT INTO stage_role (id, stage_definition_id, role_definition_id, is_primary, working_rules_override) VALUES (?, ?, ?, ?, ?)").run(
      `sr-${sd.id}-${sr.role_key}`,
      sd.id,
      roleDefId,
      sr.is_primary ? 1 : 0,
      sr.working_rules_override ? JSON.stringify(sr.working_rules_override) : null
    );
  }
}

function updateWorkspaceSopBindings(db: Database.Database, workspaceId: string, bindings: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string> }>): void {
  for (const binding of bindings) {
    const existing = db.prepare("SELECT id FROM workspace_sop WHERE workspace_id = ? AND sop_id = ?").get(workspaceId, binding.sop_id);
    if (existing) {
      db.prepare("UPDATE workspace_sop SET is_default = ?, role_bindings = ?, updated_at = datetime('now') WHERE workspace_id = ? AND sop_id = ?").run(
        binding.is_default ? 1 : 0,
        JSON.stringify(binding.role_bindings),
        workspaceId,
        binding.sop_id
      );
    } else {
      db.prepare("INSERT INTO workspace_sop (id, workspace_id, sop_id, is_default, role_bindings) VALUES (?, ?, ?, ?, ?)").run(
        `ps-${workspaceId}-${binding.sop_id}`,
        workspaceId,
        binding.sop_id,
        binding.is_default ? 1 : 0,
        JSON.stringify(binding.role_bindings)
      );
    }
  }
}

function ensureSingleDefaultSop(db: Database.Database, workspaceId: string, bindings: Array<{ sop_id: string; is_default: boolean }>): void {
  const defaultBindings = bindings.filter((b) => b.is_default);
  if (defaultBindings.length <= 1) return;
  for (let i = 1; i < defaultBindings.length; i++) {
    db.prepare("UPDATE workspace_sop SET is_default = 0 WHERE workspace_id = ? AND sop_id = ?").run(workspaceId, defaultBindings[i].sop_id);
  }
}
