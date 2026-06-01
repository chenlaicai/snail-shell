import type Database from "better-sqlite3";
import type { WorkspaceSop } from "./types";
import type { YamlStageDefinition } from "./sop-model";
export { replaceWorkspaceConfigs } from "./workspace-config-replace";

// ── Seed Types ──────────────────────────────────────────────────────

/** SOP 种子项，用于从 JSON 种子或 .snail 目录加载 SOP 到数据库。 */
export interface SopSeedItem {
  sop: { id: string; source: "platform" | "workspace"; sourceRef: string | null; key: string; name: string; description?: string | null };
  stage_definitions: YamlStageDefinition[];
}

export interface WorkspaceSeedItem {
  workspace: { id: string; module: string; name: string; summary: string; workspace_root: string; guard_profile?: Record<string, unknown> | null };
  sops: Array<{
    sop_id: string;
    is_default: boolean;
    role_bindings: Record<string, string | string[]>;
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

export function createWorkspaceSop(db: Database.Database, input: { id: string; workspaceId: string; sopId: string; isDefault: boolean; roleBindings: Record<string, string | string[]> }): WorkspaceSop {
  db.prepare("INSERT INTO workspace_sop (id, workspace_id, sop_id, is_default, role_bindings) VALUES (?, ?, ?, ?, ?)").run(input.id, input.workspaceId, input.sopId, input.isDefault ? 1 : 0, JSON.stringify(input.roleBindings));
  return getWorkspaceSop(db, input.workspaceId, input.sopId)!;
}

export function updateWorkspaceSop(db: Database.Database, workspaceId: string, sopId: string, updates: { isDefault?: boolean; roleBindings?: Record<string, string | string[]> }): WorkspaceSop {
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
  const referencingIssue = db.prepare("SELECT id FROM issue WHERE workspace_id = ? AND adopted_sop_id = ? LIMIT 1").get(workspaceId, sopId) as { id: string } | undefined;
  if (referencingIssue) throw new Error(`Cannot remove SOP binding: issue ${referencingIssue.id} references it`);
  db.prepare("DELETE FROM workspace_sop WHERE workspace_id = ? AND sop_id = ?").run(workspaceId, sopId);
}

// ── Mappers ─────────────────────────────────────────────────────────

function parseJsonRecord(value: string | null): Record<string, string | string[]> {
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
