/**
 * File-backed configuration store.
 *
 * Replaces DB tables (workspace, workspace_sop, sop, stage_definition, stage_role_definition)
 * with file-based storage. Files are the sole truth source.
 *
 * SOP data is read from YAML files on every access (no in-memory cache).
 * Workspace data is cached in memory for performance (workspace operations are more frequent).
 *
 * Why: eliminates the "file + DB dual truth" problem. Config data naturally lives in files;
 * the persistence layer provides a unified interface regardless of backing store.
 */
import fs from "fs";
import path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { logger } from "../logger";
import type { Workspace, EvolutionConfig, SnailWorkspaceConfig, Sop, SopStageDefinition, SopTransition, StageRoleDefinition, WorkspaceStageDefinition } from "../shared/types";
import { type SopYamlFile, countSopDir, listSopDir, parseSopById, findWorkspaceSopIdByKey } from "./sop-file-utils";

// ── Cache entry ───────────────────────────────────────────────────────

/** 内部缓存条目 = 派生字段 + init.json 内容。 */
interface WorkspaceCacheEntry extends SnailWorkspaceConfig {
  id: string;
  workspace_root: string;
  original_path: string;
}

// ── FileConfigStore ──────────────────────────────────────────────────

export class FileConfigStore {
  private workspacesFilePath: string;
  private evolutionConfigPath: string;
  private repoRoot: string;
  private configDir: string;

  /** In-memory workspace cache. Keyed by workspace ID. */
  private workspaceCache = new Map<string, WorkspaceCacheEntry>();

  /** Evolution governance config (config/evolution.json). null if file missing. */
  private evolutionConfig: EvolutionConfig | null = null;

  /**
   * @param repoRoot - Repository root for SOP file discovery (config/sop, .snail/config/sop).
   * @param configDir - Override directory for config files. Defaults to <repoRoot>/config.
   *
   * Why: tests need a separate config directory to avoid polluting production config files.
   * Production code uses the default (<repoRoot>/config); tests pass a temp directory.
   */
  constructor(repoRoot: string, configDir?: string) {
    this.repoRoot = repoRoot;
    this.configDir = configDir ?? path.join(repoRoot, "config");
    this.workspacesFilePath = path.join(this.configDir, "workspaces.json");
    this.evolutionConfigPath = path.join(this.configDir, "evolution.json");
  }

  /** Wrapper for imported parseSopById with store's configDir and workspace resolution. */
  private _parseSopById(id: string) { return parseSopById(id, this.configDir, (r) => this.resolveWorkspaceRoot(r), (wsId) => this.workspaceCache.get(wsId)); }
  private _findWorkspaceSopIdByKey(key: string) { return findWorkspaceSopIdByKey(key, [...this.workspaceCache.values()], (r) => this.resolveWorkspaceRoot(r)); }

  // ── Initialization ──────────────────────────────────────────────────

  /**
   * Load workspace definitions into memory cache.
   *
   * SOP data is NOT cached — it is read from YAML files on every access.
   */
  loadAll(): { platformSopCount: number; workspaceSopCount: number; workspaceCount: number } {
    const platformSopCount = countSopDir(path.join(this.configDir, "sop"));
    this.loadWorkspaces();
    this.loadEvolutionConfig();
    let workspaceSopCount = 0;
    for (const ws of this.workspaceCache.values()) {
      const resolvedRoot = this.resolveWorkspaceRoot(ws.workspace_root);
      workspaceSopCount += countSopDir(path.join(resolvedRoot, ".snail", "config", "sop"));
    }
    return { platformSopCount, workspaceSopCount, workspaceCount: this.workspaceCache.size };
  }

  // ── Workspace reads ─────────────────────────────────────────────────

  getWorkspace(id: string): Workspace | undefined {
    const entry = this.workspaceCache.get(id);
    return entry ? this.mapWorkspaceEntry(entry) : undefined;
  }

  findWorkspaceByName(name: string): Workspace | undefined {
    for (const entry of this.workspaceCache.values()) {
      if (entry.name === name) return this.mapWorkspaceEntry(entry);
    }
    return undefined;
  }

  listWorkspaces(limit = 50, offset = 0): Workspace[] {
    const all = [...this.workspaceCache.values()].slice(offset, offset + limit);
    return all.map((e) => this.mapWorkspaceEntry(e));
  }

  // ── Evolution config reads ──────────────────────────────────────────

  getEvolutionConfig(): EvolutionConfig | null {
    return this.evolutionConfig;
  }

  // ── Workspace writes ────────────────────────────────────────────────

  createWorkspace(input: { id: string; name: string; workspaceRoot: string; summary?: string; guardProfile?: Record<string, unknown> | null }): Workspace {
    const entry: WorkspaceCacheEntry = {
      id: input.id,
      name: input.name,
      summary: input.summary ?? "",
      workspace_root: input.workspaceRoot,
      original_path: input.workspaceRoot,
      guard_profile: input.guardProfile ?? null,
    };
    this.workspaceCache.set(input.id, entry);
    this.saveInitConfig(input.workspaceRoot, entry);
    this.saveWorkspacesFile();
    return this.mapWorkspaceEntry(entry);
  }

  updateWorkspace(id: string, updates: { name?: string; summary?: string; guard_profile?: Record<string, unknown> | null }): void {
    const entry = this.workspaceCache.get(id);
    if (!entry) throw new Error(`Workspace not found: ${id}`);
    if (updates.name !== undefined) entry.name = updates.name;
    if (updates.summary !== undefined) entry.summary = updates.summary ?? "";
    if (updates.guard_profile !== undefined) entry.guard_profile = updates.guard_profile;
    this.saveInitConfig(entry.workspace_root, entry);
  }

  /** Bump workspace updated_at (equivalent to DB side-effect in addMessage). */
  touchWorkspace(_workspaceId: string): void {
    /** No-op for file-backed store: updated_at is derived from file mtime. */
  }

  /**
   * Programmatically seed a workspace into the in-memory cache (no file I/O).
   *
   * Why: tests need to create workspace without touching the filesystem.
   */
  seedWorkspace(input: {
    id: string; name: string; summary?: string; workspaceRoot?: string;
  }): void {
    const root = input.workspaceRoot ?? this.repoRoot;
    this.workspaceCache.set(input.id, {
      id: input.id,
      name: input.name,
      summary: input.summary ?? "",
      workspace_root: root,
      original_path: root,
    });
  }

  // ── SOP reads (file-based, no cache) ────────────────────────────────

  getSop(id: string): Sop | undefined {
    return this._parseSopById(id)?.sop;
  }

  getSopByKey(source: "platform" | "workspace", key: string): Sop | undefined {
    const id = source === "platform" ? key : this._findWorkspaceSopIdByKey(key);
    if (!id) return undefined;
    return this._parseSopById(id)?.sop;
  }

  listSops(source?: "platform" | "workspace"): Sop[] {
    const result: Sop[] = [];
    if (!source || source === "platform") {
      result.push(...listSopDir(path.join(this.configDir, "sop"), "platform", null));
    }
    if (!source || source === "workspace") {
      for (const ws of this.workspaceCache.values()) {
        const resolvedRoot = this.resolveWorkspaceRoot(ws.workspace_root);
        result.push(...listSopDir(path.join(resolvedRoot, ".snail", "config", "sop"), "workspace", ws.id));
      }
    }
    return result.sort((a, b) => {
      if (a.source !== b.source) return a.source === "platform" ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
  }

  listSopsByWorkspace(workspaceId: string): Sop[] {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) return [];
    const resolvedRoot = this.resolveWorkspaceRoot(entry.workspace_root);
    return listSopDir(path.join(resolvedRoot, ".snail", "config", "sop"), "workspace", workspaceId);
  }

  // ── SOP writes ───────────────────────────────────────────────────────

  /**
   * Create a new platform-level SOP by writing YAML file to config/sop/<key>/.
   *
   * @throws if a SOP with the same key already exists.
   */
  createPlatformSop(input: {
    key: string;
    name: string;
    description?: string;
    first_stage?: string;
    shared_handbook?: string;
    stage_definitions: SopYamlFile["stage_definitions"];
    transitions?: Array<{ from: string; to: string; guard?: { type: string; config?: Record<string, unknown> } }>;
  }): Sop {
    if (this.getSopByKey("platform", input.key)) {
      throw new Error(`SOP already exists: ${input.key}`);
    }
    for (const sd of input.stage_definitions) {
      if (!sd.key) throw new Error("stage_definition key is required");
      if (!sd.title) throw new Error(`stage_definition "${sd.key}" title is required`);
    }
    const sopDir = path.join(this.configDir, "sop", input.key);
    fs.mkdirSync(sopDir, { recursive: true });

    const yamlContent: SopYamlFile = {
      name: input.name,
      description: input.description,
      first_stage: input.first_stage,
      shared_handbook: input.shared_handbook,
      stage_definitions: input.stage_definitions,
      transitions: input.transitions,
    };
    this.atomicWrite(path.join(sopDir, `${input.key}.yaml`), stringifyYaml(yamlContent));

    return this.getSop(input.key)!;
  }

  /**
   * Update an existing platform-level SOP by rewriting its YAML file.
   *
   * @throws if the SOP does not exist.
   */
  updatePlatformSop(sopId: string, input: {
    name?: string;
    description?: string;
    first_stage?: string;
    shared_handbook?: string;
    stage_definitions?: SopYamlFile["stage_definitions"];
    transitions?: Array<{ from: string; to: string; guard?: { type: string; config?: Record<string, unknown> } }>;
  }): Sop {
    // Single YAML read for both existence check and merge
    if (sopId.includes("#")) throw new Error(`Only platform SOPs can be updated via API: ${sopId}`);
    const sopDir = path.join(this.configDir, "sop", sopId);
    const yamlPath = path.join(sopDir, `${sopId}.yaml`);
    if (!fs.existsSync(yamlPath)) throw new Error(`SOP not found: ${sopId}`);

    const existingYaml = parseYaml(fs.readFileSync(yamlPath, "utf8")) as SopYamlFile;
    if (!existingYaml.name) throw new Error(`SOP YAML missing required field "name": ${yamlPath}`);

    const merged: SopYamlFile = {
      name: input.name ?? existingYaml.name,
      description: input.description ?? existingYaml.description,
      first_stage: input.first_stage ?? existingYaml.first_stage,
      shared_handbook: input.shared_handbook ?? existingYaml.shared_handbook,
      stage_definitions: input.stage_definitions ?? existingYaml.stage_definitions,
      transitions: input.transitions ?? existingYaml.transitions,
    };

    this.atomicWrite(yamlPath, stringifyYaml(merged));
    return this.getSop(sopId)!;
  }

  /**
   * Delete a platform-level SOP: remove YAML + handbook files.
   *
   * @throws if the SOP does not exist.
   */
  deletePlatformSop(sopId: string): string[] {
    const existing = this._parseSopById(sopId);
    if (!existing) throw new Error(`SOP not found: ${sopId}`);
    if (existing.sop.source !== "platform") throw new Error(`Only platform SOPs can be deleted via API: ${sopId}`);

    const sopDir = path.join(this.configDir, "sop", existing.sop.key);
    if (fs.existsSync(sopDir)) {
      fs.rmSync(sopDir, { recursive: true, force: true });
    }

    return [];
  }

  // ── SOP Transition reads ────────────────────────────────────────────

  getSopTransitions(sopId: string): SopTransition[] {
    return this._parseSopById(sopId)?.transitions ?? [];
  }

  getForwardTransitions(sopId: string, fromStageKey: string): SopTransition[] {
    return (this._parseSopById(sopId)?.transitions ?? []).filter((t) => t.from_stage_key === fromStageKey);
  }

  /**
   * 校验转移是否合法：from → to 存在于 SOP 转移图中。
   * 返回转移边，不合法时抛出 Error。
   */
  validateTransition(sopId: string, fromStageKey: string, toStageKey: string): SopTransition {
    const transitions = this._parseSopById(sopId)?.transitions ?? [];
    const found = transitions.find((t) => t.from_stage_key === fromStageKey && t.to_stage_key === toStageKey);
    if (!found) {
      const available = transitions.filter((t) => t.from_stage_key === fromStageKey);
      const targets = available.map((t) => t.to_stage_key).join(", ") || "(none)";
      throw new Error(`Invalid transition: ${fromStageKey} → ${toStageKey} not in SOP ${sopId} transitions. Available targets from ${fromStageKey}: ${targets}`);
    }
    return found;
  }

  // ── Stage Definition reads ──────────────────────────────────────────

  getSopStageDefinition(key: string, sopId?: string): SopStageDefinition | undefined {
    if (sopId) return this.getSopStageDefinitionByKey(sopId, key);
    for (const sop of this.listSops()) {
      const sd = this.getSopStageDefinitionByKey(sop.id, key);
      if (sd) return sd;
    }
    return undefined;
  }

  getSopStageDefinitionByKey(sopId: string, key: string): SopStageDefinition | undefined {
    return this._parseSopById(sopId)?.stageDefinitions.find((sd) => sd.key === key);
  }

  listSopStageDefinitions(sopId: string): SopStageDefinition[] {
    const parsed = this._parseSopById(sopId);
    return parsed ? [...parsed.stageDefinitions].sort((a, b) => a.sequence - b.sequence) : [];
  }

  // ── Stage Role Definition reads ─────────────────────────────────────

  listSopStageRoleDefinitions(stageKey: string, sopId?: string): StageRoleDefinition[] {
    if (sopId) {
      const parsed = this._parseSopById(sopId);
      if (!parsed) return [];
      return parsed.stageRoleDefinitions
        .filter((r) => r.stage_definition_id === stageKey)
        .sort((a, b) => (a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1));
    }
    for (const sop of this.listSops()) {
      const parsed = this._parseSopById(sop.id);
      if (!parsed) continue;
      const roles = parsed.stageRoleDefinitions.filter((r) => r.stage_definition_id === stageKey);
      if (roles.length > 0) return roles.sort((a, b) => (a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1));
    }
    return [];
  }

  listSopStageDefinitionsWithRoles(sopId: string): Array<SopStageDefinition & { roles: StageRoleDefinition[] }> {
    const parsed = this._parseSopById(sopId);
    if (!parsed) return [];
    return [...parsed.stageDefinitions]
      .sort((a, b) => a.sequence - b.sequence)
      .map((stage) => ({
        ...stage,
        roles: parsed.stageRoleDefinitions
          .filter((r) => r.stage_definition_id === stage.id)
          .sort((a, b) => (a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1)),
      }));
  }

  collectSopRoleKeys(sopId: string): Set<string> {
    const parsed = this._parseSopById(sopId);
    if (!parsed) return new Set();
    return new Set(parsed.stageRoleDefinitions.map((r) => r.key));
  }

  // ── Workspace-scoped stage/role queries ─────────────────────────────

  getStageDefinitionByWorkspace(key: string, sopId?: string): WorkspaceStageDefinition | undefined {
    const sd = this.getSopStageDefinition(key, sopId);
    if (!sd) return undefined;
    for (const ws of this.workspaceCache.values()) {
      // Check if this workspace has any SOP with this stage definition
      const resolvedRoot = this.resolveWorkspaceRoot(ws.workspace_root);
      const wsSops = listSopDir(path.join(resolvedRoot, ".snail", "config", "sop"), "workspace", ws.id);
      if (wsSops.some((s) => s.id === sd.sop_id)) {
        return this.toWorkspaceStageDefinition(sd, ws.id);
      }
    }
    return undefined;
  }

  getStageDefinitionByKey(workspaceId: string, key: string): WorkspaceStageDefinition | undefined {
    // Search all SOPs (platform + workspace) for the stage definition
    for (const sop of this.listSops()) {
      const sd = this.getSopStageDefinitionByKey(sop.id, key);
      if (sd) return this.toWorkspaceStageDefinition(sd, workspaceId);
    }
    return undefined;
  }

  listStageDefinitions(workspaceId: string): WorkspaceStageDefinition[] {
    const result: WorkspaceStageDefinition[] = [];
    const seen = new Set<string>();
    for (const sop of this.listSops()) {
      const parsed = this._parseSopById(sop.id);
      if (!parsed) continue;
      for (const sd of parsed.stageDefinitions) {
        if (!seen.has(sd.key)) {
          seen.add(sd.key);
          result.push(this.toWorkspaceStageDefinition(sd, workspaceId));
        }
      }
    }
    return result.sort((a, b) => a.sequence - b.sequence);
  }

  private toWorkspaceStageDefinition(sd: SopStageDefinition, workspaceId: string): WorkspaceStageDefinition {
    const now = new Date().toISOString();
    return { ...sd, workspace_id: workspaceId, created_at: now, updated_at: now };
  }

  getRoleDefinitionByWorkspace(id: string): StageRoleDefinition | undefined {
    for (const sop of this.listSops()) {
      const parsed = this._parseSopById(sop.id);
      if (!parsed) continue;
      const role = parsed.stageRoleDefinitions.find((r) => r.id === id);
      if (role) return role;
    }
    return undefined;
  }

  listRoleDefinitionsByStage(stageKey: string, sopId?: string): StageRoleDefinition[] {
    if (sopId) {
      const parsed = this._parseSopById(sopId);
      if (!parsed) return [];
      return parsed.stageRoleDefinitions
        .filter((r) => r.stage_definition_id === stageKey);
    }
    for (const sop of this.listSops()) {
      const parsed = this._parseSopById(sop.id);
      if (!parsed) continue;
      const roles = parsed.stageRoleDefinitions.filter((r) => r.stage_definition_id === stageKey);
      if (roles.length > 0) return roles;
    }
    return [];
  }

  listRoleDefinitionsByStageAndWorkspace(stageKey: string, _workspaceId: string): StageRoleDefinition[] {
    // Search all SOPs for the stage definition
    for (const sop of this.listSops()) {
      const parsed = this._parseSopById(sop.id);
      if (!parsed) continue;
      const roles = parsed.stageRoleDefinitions.filter((r) => r.stage_definition_id === stageKey);
      if (roles.length > 0) return roles;
    }
    return [];
  }

  listRoleDefinitionsByWorkspace(_workspaceId: string): StageRoleDefinition[] {
    const result: StageRoleDefinition[] = [];
    for (const sop of this.listSops()) {
      const parsed = this._parseSopById(sop.id);
      if (!parsed) continue;
      for (const role of parsed.stageRoleDefinitions) {
        result.push(role);
      }
    }
    return result;
  }

  // ── Full workspace config replacement (load-snail) ──────────────────

  replaceWorkspaceConfigs(
    workspaceId: string,
    input: {
      workspaceUpdate: { name: string; summary?: string };
      sopSeeds: Array<{
        sop: { id: string; source: "platform" | "workspace"; sourceRef: string | null; key: string; name: string; description?: string | null };
        stage_definitions: SopYamlFile["stage_definitions"];
      }>;
    },
  ): void {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) throw new Error(`Workspace not found: ${workspaceId}`);

    /** Update workspace metadata. */
    entry.name = input.workspaceUpdate.name;
    if (input.workspaceUpdate.summary !== undefined) entry.summary = input.workspaceUpdate.summary ?? "";

    /** Write SOP definitions to files. */
    for (const seed of input.sopSeeds) {
      const yamlContent: SopYamlFile = {
        name: seed.sop.name,
        description: seed.sop.description ?? undefined,
        stage_definitions: seed.stage_definitions,
      };
      const sopDir = path.join(this.configDir, "sop", seed.sop.key);
      fs.mkdirSync(sopDir, { recursive: true });
      this.atomicWrite(path.join(sopDir, `${seed.sop.key}.yaml`), stringifyYaml(yamlContent));
    }

    this.saveInitConfig(entry.workspace_root, entry);
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private resolveWorkspaceRoot(templateRoot: string): string {
    return templateRoot.replace(/\{\{process\.cwd\(\)\}\}/g, this.repoRoot);
  }

  private loadWorkspaces(): void {
    this.workspaceCache.clear();
    if (!fs.existsSync(this.workspacesFilePath)) return;
    const raw = fs.readFileSync(this.workspacesFilePath, "utf8");
    const paths: string[] = JSON.parse(raw);
    for (const originalPath of paths) {
      const resolvedPath = this.resolveWorkspaceRoot(originalPath);
      const id = path.basename(resolvedPath);
      if (this.workspaceCache.has(id)) {
        throw new Error(`Duplicate workspace ID derived from path: ${id} (${originalPath})`);
      }
      const initJsonPath = path.join(resolvedPath, ".snail", "init.json");
      if (!fs.existsSync(initJsonPath)) {
        logger.warn("init.json not found for workspace path, skipping", { originalPath, id });
        continue;
      }
      try {
        const initRaw = fs.readFileSync(initJsonPath, "utf8");
        const initConfig: SnailWorkspaceConfig = JSON.parse(initRaw);
        this.workspaceCache.set(id, {
          ...initConfig,
          id,
          workspace_root: resolvedPath,
          original_path: originalPath,
        });
      } catch (err) {
        logger.warn("Failed to parse init.json", { originalPath, id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private loadEvolutionConfig(): void {
    this.evolutionConfig = null;
    if (!fs.existsSync(this.evolutionConfigPath)) return;
    try {
      const raw = fs.readFileSync(this.evolutionConfigPath, "utf8");
      this.evolutionConfig = JSON.parse(raw);
    } catch (err) {
      logger.warn("Failed to parse evolution.json", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private saveWorkspacesFile(): void {
    const paths: string[] = [];
    for (const entry of this.workspaceCache.values()) {
      paths.push(entry.original_path);
    }
    this.atomicWrite(this.workspacesFilePath, JSON.stringify(paths, null, 2) + "\n");
  }

  private saveInitConfig(workspaceRoot: string, config: SnailWorkspaceConfig): void {
    const initJsonPath = path.join(workspaceRoot, ".snail", "init.json");
    const dir = path.dirname(initJsonPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 只写入 SnailWorkspaceConfig 的字段，不写入 WorkspaceCacheEntry 的派生字段（id/workspace_root/original_path）
    const clean: SnailWorkspaceConfig = { name: config.name };
    if (config.summary !== undefined) clean.summary = config.summary;
    if (config.guard_profile !== undefined) clean.guard_profile = config.guard_profile;
    this.atomicWrite(initJsonPath, JSON.stringify(clean, null, 2) + "\n");
  }

  /**
   * Atomic file write: write to temp file, then rename.
   *
   * Why: prevents partial writes if the process crashes mid-write.
   * rename() is atomic on POSIX filesystems.
   */
  private atomicWrite(filePath: string, content: string): void {
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, filePath);
  }

  // ── SOP file parsing ────────────────────────────────────────────────

  private mapWorkspaceEntry(entry: WorkspaceCacheEntry): Workspace {
    const now = new Date().toISOString();
    return {
      id: entry.id,
      name: entry.name,
      summary: entry.summary || null,
      workspace_root: this.resolveWorkspaceRoot(entry.workspace_root),
      created_at: now,
      updated_at: now,
      guard_profile: entry.guard_profile ?? null,
    };
  }
}
