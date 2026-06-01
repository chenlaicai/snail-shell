import type Database from "better-sqlite3";
import type { SopSeedItem } from "./workspace-config-model";
import { upsertSopFromYaml, type SopUpsertInput } from "./sop-model";

/**
 * 全量替换指定 workspace 的配置。
 *
 * 用于从 `.snail` 目录加载配置时，删除旧的 workspace 级 SOP 及其关联数据，
 * 然后插入新配置。平台 SOP（source='platform'）不受影响。
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
    workspaceBindings: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }>;
  }
): void {
  db.transaction(() => {
    updateWorkspaceMetadata(db, workspaceId, input.workspaceUpdate);
    const currentSopIds = getCurrentWorkspaceSopIds(db, workspaceId);
    const newSopIds = new Set(input.sopSeeds.map((s) => s.sop.id));
    removeStaleSopBindings(db, workspaceId, currentSopIds, newSopIds);
    removeStaleSops(db, workspaceId, currentSopIds, newSopIds);
    insertOrUpdateSops(db, input.sopSeeds);
    /** 先确保只有一个 default，再更新绑定——避免 UNIQUE INDEX 冲突 */
    const normalizedBindings = normalizeDefaultBindings(input.workspaceBindings);
    updateWorkspaceSopBindings(db, workspaceId, normalizedBindings);
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

function removeStaleSops(db: Database.Database, workspaceId: string, currentSopIds: Set<string>, newSopIds: Set<string>): void {
  for (const sopId of currentSopIds) {
    if (newSopIds.has(sopId)) continue;
    const sop = db.prepare("SELECT source FROM sop WHERE id = ?").get(sopId) as { source: string } | undefined;
    if (!sop || sop.source !== "workspace") continue;
    /** 限定 workspace：只检查当前 workspace 的 feature 引用，避免误判其他 workspace 的引用导致 SOP 被误删 */
    const referencingFeature = db.prepare("SELECT id FROM feature WHERE workspace_id = ? AND adopted_sop_id = ? LIMIT 1").get(workspaceId, sopId) as { id: string } | undefined;
    if (referencingFeature) continue;
    deleteSopDefinitions(db, sopId, true);
  }
}


function insertOrUpdateSops(db: Database.Database, sopSeeds: SopSeedItem[]): void {
  for (const sopSeed of sopSeeds) {
    const sopInput: SopUpsertInput = {
      id: sopSeed.sop.id,
      source: sopSeed.sop.source,
      sourceRef: sopSeed.sop.sourceRef,
      key: sopSeed.sop.key,
      name: sopSeed.sop.name,
      description: sopSeed.sop.description ?? null,
    };
    upsertSopFromYaml(db, sopInput, sopSeed.stage_definitions);
  }
}

/**
 * 删除 SOP 关联的 definitions（stage_role_definition → stage_definition）。
 *
 * @param cascade 当为 true 时同时删除 sop 行本身，用于全量替换场景移除过期 SOP；
 *                为 false（默认）时只删除 definitions，用于更新 SOP 时先清后插。
 */
function deleteSopDefinitions(db: Database.Database, sopId: string, cascade = false): void {
  db.prepare("DELETE FROM stage_role_definition WHERE stage_definition_id IN (SELECT id FROM stage_definition WHERE sop_id = ?)").run(sopId);
  db.prepare("DELETE FROM stage_definition WHERE sop_id = ?").run(sopId);
  if (cascade) {
    db.prepare("DELETE FROM sop WHERE id = ?").run(sopId);
  }
}

function updateWorkspaceSopBindings(db: Database.Database, workspaceId: string, bindings: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }>): void {
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

/**
 * 确保只有一个 binding 是 default。
 *
 * workspace_sop 表有 UNIQUE INDEX (workspace_id) WHERE is_default = 1，
 * 如果多个 binding 同时标记为 default，INSERT 会失败。
 * 此函数在写入前将多余的 default 标记清除。
 */
function normalizeDefaultBindings(bindings: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }>): Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }> {
  let foundDefault = false;
  return bindings.map((binding) => {
    if (binding.is_default && !foundDefault) {
      foundDefault = true;
      return binding;
    }
    return { ...binding, is_default: false };
  });
}
