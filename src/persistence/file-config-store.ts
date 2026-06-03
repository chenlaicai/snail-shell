/**
 * File-backed configuration store.
 *
 * Replaces DB tables (workspace, workspace_sop, sop, stage_definition, stage_role_definition)
 * with file-based storage. Files are the sole truth source; this module caches parsed data
 * in memory and writes back to files on mutation.
 *
 * Why: eliminates the "file + DB dual truth" problem. Config data naturally lives in files;
 * the persistence layer provides a unified interface regardless of backing store.
 */
import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type {
  Workspace,
  WorkspaceModule,
  Sop,
  SopStageDefinition,
  SopTransition,
  TransitionGuard,
  StageRoleDefinition,
  StageChecklistItem,
  WorkspaceSop,
  WorkspaceStageDefinition,
} from "../shared/types";

// ── File formats ─────────────────────────────────────────────────────

interface WorkspaceFileEntry {
  id: string;
  module: WorkspaceModule;
  name: string;
  summary: string;
  workspace_root: string;
  guard_profile?: Record<string, unknown> | null;
  sop_bindings: Array<{
    sop_id: string;
    is_default: boolean;
    role_bindings: Record<string, string | string[]>;
  }>;
}

interface WorkspacesFile {
  workspaces: WorkspaceFileEntry[];
}

interface SopYamlFile {
  name: string;
  description?: string;
  first_stage?: string;
  stage_definitions: Array<{
    key: string;
    title: string;
    sequence: number;
    input_description?: string | null;
    output_description?: string | null;
    acceptance_focus?: string[];
    acceptance_checklist?: Array<{ id: string; description: string; required: boolean }>;
    roles: Array<{
      key: string;
      name: string;
      description?: string;
      handbook?: string | null;
      is_primary?: boolean;
      count?: number;
    }>;
  }>;
  transitions?: Array<{
    from: string;
    to: string;
    guard?: { type: string; config?: Record<string, unknown> };
  }>;
}

// ── Internal SOP cache entry ─────────────────────────────────────────

interface CachedSop {
  sop: Sop;
  stageDefinitions: SopStageDefinition[];
  stageRoleDefinitions: StageRoleDefinition[];
  transitions: SopTransition[];
}

// ── FileConfigStore ──────────────────────────────────────────────────

export class FileConfigStore {
  private workspacesFilePath: string;
  private repoRoot: string;
  private configDir: string;

  /** In-memory workspace cache. Keyed by workspace ID. */
  private workspaceCache = new Map<string, WorkspaceFileEntry>();
  /** In-memory SOP cache. Keyed by SOP ID. */
  private sopCache = new Map<string, CachedSop>();
  /** Workspace file last-loaded timestamp for change detection. */
  private workspaceFileMtime = 0;

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
  }

  // ── Initialization ──────────────────────────────────────────────────

  /**
   * Load all config files into memory. Must be called before any read/write.
   *
   * Loading order:
   * 1. Platform SOPs from config/sop/*.yaml
   * 2. Workspace SOPs from <workspace_root>/.snail/config/sop/*.yaml
   * 3. Workspace definitions from config/workspaces.json
   *
   * Why: SOPs must be loaded before workspaces, because workspace sop_bindings
   * reference SOP IDs that must already be in the cache.
   */
  loadAll(): { platformSopCount: number; workspaceSopCount: number; workspaceCount: number } {
    const platformSopCount = this.loadSopDir(path.join(this.configDir, "sop"), "platform", null);
    this.loadWorkspaces();
    let workspaceSopCount = 0;
    for (const ws of this.workspaceCache.values()) {
      const resolvedRoot = this.resolveWorkspaceRoot(ws.workspace_root);
      workspaceSopCount += this.loadSopDir(path.join(resolvedRoot, ".snail", "config", "sop"), "workspace", ws.id);
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

  listWorkspaces(limit = 50, offset = 0, module: WorkspaceModule = "workspace_management"): Workspace[] {
    const all = [...this.workspaceCache.values()]
      .filter((e) => e.module === module)
      .slice(offset, offset + limit);
    return all.map((e) => this.mapWorkspaceEntry(e));
  }

  // ── Workspace writes ────────────────────────────────────────────────

  createWorkspace(input: { id: string; module: WorkspaceModule; name: string; workspaceRoot: string; summary?: string; guardProfile?: Record<string, unknown> | null }): Workspace {
    const entry: WorkspaceFileEntry = {
      id: input.id,
      module: input.module,
      name: input.name,
      summary: input.summary ?? "",
      workspace_root: input.workspaceRoot,
      guard_profile: input.guardProfile ?? null,
      sop_bindings: [],
    };
    this.workspaceCache.set(input.id, entry);
    this.saveWorkspacesFile();
    return this.mapWorkspaceEntry(entry);
  }

  updateWorkspace(id: string, updates: { name?: string; summary?: string; guard_profile?: Record<string, unknown> | null }): void {
    const entry = this.workspaceCache.get(id);
    if (!entry) throw new Error(`Workspace not found: ${id}`);
    if (updates.name !== undefined) entry.name = updates.name;
    if (updates.summary !== undefined) entry.summary = updates.summary ?? "";
    if (updates.guard_profile !== undefined) entry.guard_profile = updates.guard_profile;
    this.saveWorkspacesFile();
  }

  /** Bump workspace updated_at (equivalent to DB side-effect in addMessage). */
  touchWorkspace(_workspaceId: string): void {
    /** No-op for file-backed store: updated_at is derived from file mtime. */
  }

  /**
   * Programmatically seed a workspace into the in-memory cache (no file I/O).
   *
   * Why: tests need to create workspace + SOP bindings without touching the filesystem.
   * This method populates the same cache that loadAll() populates from files.
   */
  seedWorkspace(input: {
    id: string; module: WorkspaceModule; name: string; summary?: string; workspaceRoot?: string;
    sopBindings?: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }>;
  }): void {
    this.workspaceCache.set(input.id, {
      id: input.id,
      module: input.module,
      name: input.name,
      summary: input.summary ?? "",
      workspace_root: input.workspaceRoot ?? this.repoRoot,
      sop_bindings: input.sopBindings ?? [],
    });
  }

  /**
   * Programmatically seed a SOP definition into the in-memory cache (no file I/O).
   *
   * Why: tests need to create SOP definitions without parsing YAML files.
   */
  seedSop(
    sopInput: { id: string; source: "platform" | "workspace"; sourceRef: string | null; key: string; name: string; description?: string | null; firstStage?: string | null },
    stageDefinitions: SopYamlFile["stage_definitions"],
    transitions?: Array<{ from: string; to: string; guard?: { type: string; config?: Record<string, unknown> } }>,
  ): void {
    this.upsertSopFromSeed(sopInput, stageDefinitions, transitions);
  }

  // ── Workspace SOP binding reads ─────────────────────────────────────

  getWorkspaceSop(workspaceId: string, sopId: string): WorkspaceSop | undefined {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) return undefined;
    const binding = entry.sop_bindings.find((b) => b.sop_id === sopId);
    if (!binding) return undefined;
    return this.mapBindingToWorkspaceSop(workspaceId, binding);
  }

  listWorkspaceSops(workspaceId: string): WorkspaceSop[] {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) return [];
    return entry.sop_bindings.map((b) => this.mapBindingToWorkspaceSop(workspaceId, b));
  }

  getDefaultWorkspaceSop(workspaceId: string): WorkspaceSop | undefined {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) return undefined;
    const binding = entry.sop_bindings.find((b) => b.is_default);
    return binding ? this.mapBindingToWorkspaceSop(workspaceId, binding) : undefined;
  }

  // ── Workspace SOP binding writes ────────────────────────────────────

  createWorkspaceSop(input: { id: string; workspaceId: string; sopId: string; isDefault: boolean; roleBindings: Record<string, string | string[]> }): WorkspaceSop {
    const entry = this.workspaceCache.get(input.workspaceId);
    if (!entry) throw new Error(`Workspace not found: ${input.workspaceId}`);
    if (entry.sop_bindings.some((b) => b.sop_id === input.sopId)) {
      throw new Error(`SOP binding already exists: workspace=${input.workspaceId} sop=${input.sopId}`);
    }
    if (input.isDefault) {
      for (const b of entry.sop_bindings) b.is_default = false;
    }
    entry.sop_bindings.push({
      sop_id: input.sopId,
      is_default: input.isDefault,
      role_bindings: input.roleBindings,
    });
    this.saveWorkspacesFile();
    return this.getWorkspaceSop(input.workspaceId, input.sopId)!;
  }

  updateWorkspaceSop(workspaceId: string, sopId: string, updates: { isDefault?: boolean; roleBindings?: Record<string, string | string[]> }): WorkspaceSop {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) throw new Error(`Workspace not found: ${workspaceId}`);
    const binding = entry.sop_bindings.find((b) => b.sop_id === sopId);
    if (!binding) throw new Error(`WorkspaceSop not found: workspace=${workspaceId} sop=${sopId}`);
    if (updates.isDefault !== undefined) {
      if (updates.isDefault) {
        for (const b of entry.sop_bindings) b.is_default = false;
      }
      binding.is_default = updates.isDefault;
    }
    if (updates.roleBindings !== undefined) {
      binding.role_bindings = updates.roleBindings;
    }
    this.saveWorkspacesFile();
    return this.getWorkspaceSop(workspaceId, sopId)!;
  }

  deleteWorkspaceSop(workspaceId: string, sopId: string): void {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) throw new Error(`Workspace not found: ${workspaceId}`);
    const idx = entry.sop_bindings.findIndex((b) => b.sop_id === sopId);
    if (idx < 0) throw new Error(`WorkspaceSop not found: workspace=${workspaceId} sop=${sopId}`);
    entry.sop_bindings.splice(idx, 1);
    this.saveWorkspacesFile();
  }

  // ── SOP reads ───────────────────────────────────────────────────────

  getSop(id: string): Sop | undefined {
    return this.sopCache.get(id)?.sop;
  }

  getSopByKey(source: "platform" | "workspace", key: string): Sop | undefined {
    for (const cached of this.sopCache.values()) {
      if (cached.sop.source === source && cached.sop.key === key) return cached.sop;
    }
    return undefined;
  }

  listSops(source?: "platform" | "workspace"): Sop[] {
    const result: Sop[] = [];
    for (const cached of this.sopCache.values()) {
      if (!source || cached.sop.source === source) result.push(cached.sop);
    }
    return result.sort((a, b) => {
      if (a.source !== b.source) return a.source === "platform" ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
  }

  listSopsByWorkspace(workspaceId: string): Sop[] {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) return [];
    const sops: Array<{ sop: Sop; isDefault: boolean }> = [];
    for (const binding of entry.sop_bindings) {
      const cached = this.sopCache.get(binding.sop_id);
      if (cached) sops.push({ sop: cached.sop, isDefault: binding.is_default });
    }
    return sops.sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1)).map((s) => s.sop);
  }

  // ── SOP Transition reads ────────────────────────────────────────────

  getSopTransitions(sopId: string): SopTransition[] {
    return this.sopCache.get(sopId)?.transitions ?? [];
  }

  getForwardTransitions(sopId: string, fromStageKey: string): SopTransition[] {
    return (this.sopCache.get(sopId)?.transitions ?? []).filter((t) => t.from_stage_key === fromStageKey);
  }

  /**
   * 校验转移是否合法：from → to 存在于 SOP 转移图中。
   * 返回转移边，不合法时抛出 Error。
   */
  validateTransition(sopId: string, fromStageKey: string, toStageKey: string): SopTransition {
    const transitions = this.sopCache.get(sopId)?.transitions ?? [];
    const found = transitions.find((t) => t.from_stage_key === fromStageKey && t.to_stage_key === toStageKey);
    if (!found) {
      const available = transitions.filter((t) => t.from_stage_key === fromStageKey);
      const targets = available.map((t) => t.to_stage_key).join(", ") || "(none)";
      throw new Error(`Invalid transition: ${fromStageKey} → ${toStageKey} not in SOP ${sopId} transitions. Available targets from ${fromStageKey}: ${targets}`);
    }
    return found;
  }

  // ── Stage Definition reads ──────────────────────────────────────────

  getSopStageDefinition(id: string): SopStageDefinition | undefined {
    for (const cached of this.sopCache.values()) {
      const found = cached.stageDefinitions.find((sd) => sd.id === id);
      if (found) return found;
    }
    return undefined;
  }

  getSopStageDefinitionByKey(sopId: string, key: string): SopStageDefinition | undefined {
    const cached = this.sopCache.get(sopId);
    return cached?.stageDefinitions.find((sd) => sd.key === key);
  }

  listSopStageDefinitions(sopId: string): SopStageDefinition[] {
    const cached = this.sopCache.get(sopId);
    return cached ? [...cached.stageDefinitions].sort((a, b) => a.sequence - b.sequence) : [];
  }

  // ── Stage Role Definition reads ─────────────────────────────────────

  listSopStageRoleDefinitions(stageDefinitionId: string): StageRoleDefinition[] {
    for (const cached of this.sopCache.values()) {
      const roles = cached.stageRoleDefinitions.filter((r) => r.stage_definition_id === stageDefinitionId);
      if (roles.length > 0) return roles.sort((a, b) => (a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1));
    }
    return [];
  }

  listSopStageDefinitionsWithRoles(sopId: string): Array<SopStageDefinition & { roles: StageRoleDefinition[] }> {
    const stages = this.listSopStageDefinitions(sopId);
    return stages.map((stage) => ({
      ...stage,
      roles: this.listSopStageRoleDefinitions(stage.id),
    }));
  }

  collectSopRoleKeys(sopId: string): Set<string> {
    const cached = this.sopCache.get(sopId);
    if (!cached) return new Set();
    return new Set(cached.stageRoleDefinitions.map((r) => r.key));
  }

  // ── Workspace-scoped stage/role queries ─────────────────────────────
  /**
   * These queries resolve SOP definitions in the context of a workspace binding,
   * attaching snail_template_id from role_bindings.
   *
   * Why: stage_definition and stage_role_definition belong to sop, not workspace.
   * When callers need workspace context (e.g. snail_template_id), we resolve by
   * finding which workspace_sop binding connects the workspace to the SOP.
   */

  getStageDefinitionByWorkspace(id: string): WorkspaceStageDefinition | undefined {
    for (const cached of this.sopCache.values()) {
      const sd = cached.stageDefinitions.find((s) => s.id === id);
      if (!sd) continue;
      /** Find any workspace that has this SOP bound. */
      for (const ws of this.workspaceCache.values()) {
        if (ws.sop_bindings.some((b) => b.sop_id === cached.sop.id)) {
          return this.toWorkspaceStageDefinition(sd, ws.id);
        }
      }
    }
    return undefined;
  }

  getStageDefinitionByKey(workspaceId: string, key: string): WorkspaceStageDefinition | undefined {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) return undefined;
    /** Prefer default binding, then first match. */
    const sortedBindings = [...entry.sop_bindings].sort((a, b) => (a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1));
    for (const binding of sortedBindings) {
      const cached = this.sopCache.get(binding.sop_id);
      if (!cached) continue;
      const sd = cached.stageDefinitions.find((s) => s.key === key);
      if (sd) return this.toWorkspaceStageDefinition(sd, workspaceId);
    }
    return undefined;
  }

  listStageDefinitions(workspaceId: string): WorkspaceStageDefinition[] {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) return [];
    const result: WorkspaceStageDefinition[] = [];
    const sortedBindings = [...entry.sop_bindings].sort((a, b) => (a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1));
    for (const binding of sortedBindings) {
      const cached = this.sopCache.get(binding.sop_id);
      if (!cached) continue;
      for (const sd of cached.stageDefinitions) {
        result.push(this.toWorkspaceStageDefinition(sd, workspaceId));
      }
    }
    return result.sort((a, b) => a.sequence - b.sequence);
  }

  private toWorkspaceStageDefinition(sd: SopStageDefinition, workspaceId: string): WorkspaceStageDefinition {
    /** Why: 文件模式下无持久化时间戳，使用加载时间保持与 mapWorkspaceEntry 行为一致。
     *  这些值代表"配置被加载的时刻"，而非"配置文件最后修改时间"。 */
    const now = new Date().toISOString();
    return { ...sd, workspace_id: workspaceId, created_at: now, updated_at: now };
  }

  getRoleDefinitionByWorkspace(id: string): StageRoleDefinition | undefined {
    for (const cached of this.sopCache.values()) {
      const role = cached.stageRoleDefinitions.find((r) => r.id === id);
      if (role) {
        /** Resolve snail_template_id from workspace binding. */
        return this.resolveRoleTemplate(role, cached.sop.id);
      }
    }
    return undefined;
  }

  listRoleDefinitionsByStage(stageDefinitionId: string): StageRoleDefinition[] {
    for (const cached of this.sopCache.values()) {
      const roles = cached.stageRoleDefinitions.filter((r) => r.stage_definition_id === stageDefinitionId);
      if (roles.length > 0) {
        return roles.map((r) => this.resolveRoleTemplate(r, cached.sop.id));
      }
    }
    return [];
  }

  listRoleDefinitionsByStageAndWorkspace(stageDefinitionId: string, workspaceId: string): StageRoleDefinition[] {
    for (const cached of this.sopCache.values()) {
      const roles = cached.stageRoleDefinitions.filter((r) => r.stage_definition_id === stageDefinitionId);
      if (roles.length > 0) {
        const entry = this.workspaceCache.get(workspaceId);
        const binding = entry?.sop_bindings.find((b) => b.sop_id === cached.sop.id);
        return roles.map((r) => this.applyRoleBinding(r, binding?.role_bindings));
      }
    }
    return [];
  }

  listRoleDefinitionsByWorkspace(workspaceId: string): StageRoleDefinition[] {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) return [];
    const result: StageRoleDefinition[] = [];
    for (const binding of entry.sop_bindings) {
      const cached = this.sopCache.get(binding.sop_id);
      if (!cached) continue;
      for (const sd of cached.stageDefinitions) {
        const roles = cached.stageRoleDefinitions
          .filter((r) => r.stage_definition_id === sd.id)
          .map((r) => this.applyRoleBinding(r, binding.role_bindings));
        result.push(...roles);
      }
    }
    return result;
  }

  listAllRoleDefinitions(): Array<StageRoleDefinition & { workspace_id: string }> {
    const result: Array<StageRoleDefinition & { workspace_id: string }> = [];
    for (const ws of this.workspaceCache.values()) {
      for (const binding of ws.sop_bindings) {
        const cached = this.sopCache.get(binding.sop_id);
        if (!cached) continue;
        for (const role of cached.stageRoleDefinitions) {
          result.push({ ...this.applyRoleBinding(role, binding.role_bindings), workspace_id: ws.id });
        }
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
      workspaceBindings: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }>;
    },
  ): void {
    const entry = this.workspaceCache.get(workspaceId);
    if (!entry) throw new Error(`Workspace not found: ${workspaceId}`);

    /** Track current SOP bindings for stale cleanup. */
    const currentSopIds = new Set(entry.sop_bindings.map((b) => b.sop_id));
    const newSopIds = new Set(input.sopSeeds.map((s) => s.sop.id));

    /** Update workspace metadata. */
    entry.name = input.workspaceUpdate.name;
    if (input.workspaceUpdate.summary !== undefined) entry.summary = input.workspaceUpdate.summary ?? "";

    /** Upsert SOP definitions from seeds. */
    for (const seed of input.sopSeeds) {
      this.upsertSopFromSeed(seed.sop, seed.stage_definitions);
    }

    /** Remove stale workspace-scoped SOPs no longer bound and not referenced by features. */
    for (const sopId of currentSopIds) {
      if (newSopIds.has(sopId)) continue;
      const cached = this.sopCache.get(sopId);
      if (!cached || cached.sop.source !== "workspace") continue;
      this.sopCache.delete(sopId);
    }

    /** Replace workspace SOP bindings. */
    const normalizedBindings = this.normalizeDefaultBindings(input.workspaceBindings);
    entry.sop_bindings = normalizedBindings.map((b) => ({
      sop_id: b.sop_id,
      is_default: b.is_default,
      role_bindings: b.role_bindings,
    }));

    this.saveWorkspacesFile();
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private resolveWorkspaceRoot(templateRoot: string): string {
    return templateRoot.replace(/\{\{process\.cwd\(\)\}\}/g, this.repoRoot);
  }

  private loadWorkspaces(): void {
    if (!fs.existsSync(this.workspacesFilePath)) return;
    const raw = fs.readFileSync(this.workspacesFilePath, "utf8");
    const resolved = raw.replace(/\{\{process\.cwd\(\)\}\}/g, this.repoRoot);
    const parsed: WorkspacesFile = JSON.parse(resolved);
    this.workspaceCache.clear();
    for (const entry of parsed.workspaces) {
      this.workspaceCache.set(entry.id, entry);
    }
    this.workspaceFileMtime = fs.statSync(this.workspacesFilePath).mtimeMs;
  }

  private saveWorkspacesFile(): void {
    /** Reconstruct file content with template variables preserved. */
    const fileEntries: WorkspaceFileEntry[] = [];
    for (const entry of this.workspaceCache.values()) {
      fileEntries.push({
        ...entry,
        /** Restore template variable for portability across machines. */
        workspace_root: entry.workspace_root === this.repoRoot ? "{{process.cwd()}}" : entry.workspace_root,
      });
    }
    const fileContent: WorkspacesFile = { workspaces: fileEntries };
    this.atomicWrite(this.workspacesFilePath, JSON.stringify(fileContent, null, 2) + "\n");
    this.workspaceFileMtime = fs.statSync(this.workspacesFilePath).mtimeMs;
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

  private loadSopDir(dir: string, source: "platform" | "workspace", sourceRef: string | null): number {
    if (!fs.existsSync(dir)) return 0;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    let loaded = 0;
    for (const file of files) {
      this.loadSingleSopFile(path.join(dir, file), source, sourceRef);
      loaded++;
    }
    return loaded;
  }

  private loadSingleSopFile(filePath: string, source: "platform" | "workspace", sourceRef: string | null): void {
    const key = path.basename(filePath, path.extname(filePath));
    if (!key) return;
    const raw = fs.readFileSync(filePath, "utf8");
    let parsed: SopYamlFile;
    try {
      parsed = parseYaml(raw) as SopYamlFile;
    } catch (err) {
      throw new Error(`Failed to parse SOP YAML file ${filePath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (!parsed.name) throw new Error(`SOP YAML file ${filePath} is missing required field "name"`);
    const sopId = source === "platform" ? `sop-${key}` : `sop-${sourceRef}-${key}`;
    this.upsertSopFromSeed(
      { id: sopId, source, sourceRef: sourceRef ?? null, key, name: parsed.name, description: parsed.description ?? null, firstStage: parsed.first_stage ?? null },
      parsed.stage_definitions ?? [],
      parsed.transitions,
    );
  }

  private upsertSopFromSeed(
    sopInput: { id: string; source: "platform" | "workspace"; sourceRef: string | null; key: string; name: string; description?: string | null; firstStage?: string | null },
    stageDefinitions: SopYamlFile["stage_definitions"],
    transitions?: Array<{ from: string; to: string; guard?: { type: string; config?: Record<string, unknown> } }>,
  ): void {
    const now = new Date().toISOString();
    const sop: Sop = {
      id: sopInput.id, source: sopInput.source, source_ref: sopInput.sourceRef,
      key: sopInput.key, name: sopInput.name, description: sopInput.description ?? null,
      first_stage: sopInput.firstStage ?? null,
      created_at: this.sopCache.get(sopInput.id)?.sop.created_at ?? now, updated_at: now,
    };
    const sds: SopStageDefinition[] = [];
    const srds: StageRoleDefinition[] = [];
    for (const sd of stageDefinitions) {
      const stageDefId = `sd-${sopInput.id}-${sd.key}`;
      sds.push({
        id: stageDefId, sop_id: sopInput.id, key: sd.key, title: sd.title, sequence: sd.sequence,
        input_description: sd.input_description ?? null, output_description: sd.output_description ?? null,
        acceptance_focus: sd.acceptance_focus ?? [], acceptance_checklist: (sd.acceptance_checklist ?? []) as StageChecklistItem[],
      });
      this.expandStageRoles(sd.roles ?? [], stageDefId, srds);
    }
    const stageKeys = new Set(sds.map((sd) => sd.key));
    const sTransitions: SopTransition[] = (transitions ?? []).map((t) => {
      if (!stageKeys.has(t.from)) throw new Error(`Transition references unknown from_stage_key "${t.from}" in SOP ${sopInput.id}`);
      if (!stageKeys.has(t.to)) throw new Error(`Transition references unknown to_stage_key "${t.to}" in SOP ${sopInput.id}`);
      let guard: TransitionGuard | null = null;
      if (t.guard) {
        guard = { type: t.guard.type as TransitionGuard["type"], config: t.guard.config ?? {} };
      }
      return { id: `st-${sopInput.id}-${t.from}-${t.to}`, sop_id: sopInput.id, from_stage_key: t.from, to_stage_key: t.to, guard };
    });
    this.sopCache.set(sopInput.id, { sop, stageDefinitions: sds, stageRoleDefinitions: srds, transitions: sTransitions });
  }

  private expandStageRoles(roles: SopYamlFile["stage_definitions"][number]["roles"], stageDefId: string, srds: StageRoleDefinition[]): void {
    for (const rd of roles) {
      const count = rd.count ?? 1;
      for (let i = 1; i <= count; i++) {
        const suffix = count > 1 ? `-${i}` : "";
        srds.push({
          id: `srd-${stageDefId}-${rd.key}${suffix}`, stage_definition_id: stageDefId, key: rd.key,
          name: `${rd.name}${suffix}`, snail_template_id: null, is_primary: rd.is_primary ? 1 : 0, count,
          description: rd.description ?? "", handbook: rd.handbook ?? null,
        });
      }
    }
  }

  private mapWorkspaceEntry(entry: WorkspaceFileEntry): Workspace {
    const now = new Date().toISOString();
    return {
      id: entry.id,
      module: entry.module,
      name: entry.name,
      summary: entry.summary || null,
      workspace_root: this.resolveWorkspaceRoot(entry.workspace_root),
      created_at: now,
      updated_at: now,
      guard_profile: entry.guard_profile ?? null,
    };
  }

  private mapBindingToWorkspaceSop(workspaceId: string, binding: WorkspaceFileEntry["sop_bindings"][number]): WorkspaceSop {
    return {
      id: `ps-${workspaceId}-${binding.sop_id}`,
      workspace_id: workspaceId,
      sop_id: binding.sop_id,
      is_default: binding.is_default ? 1 : 0,
      role_bindings: binding.role_bindings,
    };
  }

  /**
   * Resolve snail_template_id from any workspace binding that references this SOP.
   *
   * Why: stage_role_definition doesn't carry template info; it comes from
   * workspace_sop.role_bindings at runtime. This method finds the first
   * workspace binding for the given SOP and applies it.
   */
  private resolveRoleTemplate(role: StageRoleDefinition, sopId: string): StageRoleDefinition {
    for (const ws of this.workspaceCache.values()) {
      const binding = ws.sop_bindings.find((b) => b.sop_id === sopId);
      if (binding) return this.applyRoleBinding(role, binding.role_bindings);
    }
    return role;
  }

  /**
   * Apply role_bindings to a role definition, resolving snail_template_id.
   *
   * Why: role_bindings supports two formats:
   * - string: same template for all instances of a role key
   * - string[]: per-instance binding (index derived from ID suffix)
   */
  private applyRoleBinding(role: StageRoleDefinition, roleBindings?: Record<string, string | string[]>): StageRoleDefinition {
    if (!roleBindings) return role;
    const bindingValue = roleBindings[role.key];
    if (!bindingValue) return role;
    const instanceIndex = this.extractInstanceIndex(role.id);
    const snailTemplateId = typeof bindingValue === "string"
      ? bindingValue
      : Array.isArray(bindingValue)
        ? bindingValue[instanceIndex > 0 ? instanceIndex - 1 : 0] ?? null
        : null;
    return { ...role, snail_template_id: snailTemplateId };
  }

  /** Extract instance index (1-based) from expanded role ID suffix. Returns 0 if no suffix. */
  private extractInstanceIndex(id: string): number {
    const match = id.match(/-(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private normalizeDefaultBindings(bindings: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }>): typeof bindings {
    let foundDefault = false;
    return bindings.map((b) => {
      if (b.is_default && !foundDefault) { foundDefault = true; return b; }
      return { ...b, is_default: false };
    });
  }
}
