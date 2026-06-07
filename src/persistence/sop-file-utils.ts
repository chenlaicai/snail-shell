import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type { Sop, SopStageDefinition, SopTransition, TransitionGuard, StageRoleDefinition, StageChecklistItem } from "../shared/types";

// ── Types ────────────────────────────────────────────────────────────

export interface SopYamlFile {
  name: string;
  description?: string;
  first_stage?: string;
  shared_handbook?: string;
  stage_definitions: Array<{
    key: string; title: string; sequence: number;
    input_description?: string | null; output_description?: string | null;
    acceptance_focus?: string[];
    acceptance_checklist?: Array<{ id: string; description: string; required: boolean }>;
    roles: Array<{ key: string; name: string; description?: string; handbook?: string | null; is_primary?: boolean; count?: number }>;
  }>;
  transitions?: Array<{ from: string; to: string; guard?: { type: string; config?: Record<string, unknown> } }>;
}

export interface ParsedSop {
  sop: Sop;
  stageDefinitions: SopStageDefinition[];
  stageRoleDefinitions: StageRoleDefinition[];
  transitions: SopTransition[];
}

interface SopIdentity {
  sopId: string;
  source: "platform" | "workspace";
  source_ref: string | null;
  key: string;
}

// ── Directory scanning ───────────────────────────────────────────────

export function findSopYamlInDir(dirPath: string, dirName: string): string | null {
  for (const ext of [".yaml", ".yml"]) {
    const p = path.join(dirPath, dirName + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function countSopDir(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml"))) count++;
    if (e.isDirectory() && findSopYamlInDir(path.join(dir, e.name), e.name)) count++;
  }
  return count;
}

export function listSopDir(dir: string, source: "platform" | "workspace", source_ref: string | null): Sop[] {
  if (!fs.existsSync(dir)) return [];
  const result: Sop[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml"))) {
      const key = path.basename(e.name, path.extname(e.name));
      const p = parseSopFile(path.join(dir, e.name), source, source_ref, key);
      if (p) result.push(p.sop);
    }
    if (e.isDirectory()) {
      const yamlPath = findSopYamlInDir(path.join(dir, e.name), e.name);
      if (yamlPath) {
        const p = parseSopFile(yamlPath, source, source_ref, e.name);
        if (p) result.push(p.sop);
      }
    }
  }
  return result;
}

// ── SOP lookup ───────────────────────────────────────────────────────

export function parseSopById(
  id: string, configDir: string,
  resolveRoot: (r: string) => string,
  getWs: (id: string) => { workspace_root: string } | undefined,
): ParsedSop | undefined {
  if (id.includes("#")) {
    const [wsId, key] = id.split("#", 2);
    const ws = getWs(wsId);
    if (!ws) return undefined;
    const yamlPath = path.join(resolveRoot(ws.workspace_root), ".snail", "config", "sop", key, `${key}.yaml`);
    return parseSopFile(yamlPath, "workspace", wsId, key);
  }
  return parseSopFile(path.join(configDir, "sop", id, `${id}.yaml`), "platform", null, id);
}

export function findWorkspaceSopIdByKey(
  key: string,
  workspaces: Array<{ id: string; workspace_root: string }>,
  resolveRoot: (r: string) => string,
): string | undefined {
  for (const ws of workspaces) {
    const yamlPath = path.join(resolveRoot(ws.workspace_root), ".snail", "config", "sop", key, `${key}.yaml`);
    if (fs.existsSync(yamlPath)) return `${ws.id}#${key}`;
  }
  return undefined;
}

// ── File parsing ─────────────────────────────────────────────────────

export function parseSopFile(
  filePath: string, source: "platform" | "workspace", source_ref: string | null, key: string,
): ParsedSop | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  let parsed: SopYamlFile;
  try {
    parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as SopYamlFile;
  } catch (err) {
    console.warn(`[SOP] Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  if (!parsed.name) {
    console.warn(`[SOP] Missing "name" in ${filePath}`);
    return undefined;
  }
  resolveHandbookFileRefs(parsed, path.dirname(filePath));
  const sopId = source === "workspace" && source_ref ? `${source_ref}#${key}` : key;
  return buildParsedSop({ sopId, source, source_ref, key }, parsed);
}

export function buildParsedSop(identity: SopIdentity, parsed: SopYamlFile): ParsedSop {
  const now = new Date().toISOString();
  const sop: Sop = {
    id: identity.sopId, source: identity.source, source_ref: identity.source_ref,
    key: identity.key, name: parsed.name, description: parsed.description ?? null,
    first_stage: parsed.first_stage ?? null, shared_handbook: parsed.shared_handbook ?? null,
    created_at: now, updated_at: now,
  };
  const { stageDefinitions, stageRoleDefinitions } = buildStageDefinitions(identity.sopId, parsed.stage_definitions ?? []);
  const transitions = buildTransitions(identity.sopId, parsed.transitions ?? []);
  return { sop, stageDefinitions, stageRoleDefinitions, transitions };
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildStageDefinitions(sopId: string, raw: SopYamlFile["stage_definitions"]): {
  stageDefinitions: SopStageDefinition[];
  stageRoleDefinitions: StageRoleDefinition[];
} {
  const stageDefinitions: SopStageDefinition[] = [];
  const stageRoleDefinitions: StageRoleDefinition[] = [];
  for (const sd of raw) {
    stageDefinitions.push({
      id: sd.key, sop_id: sopId, key: sd.key, title: sd.title, sequence: sd.sequence,
      input_description: sd.input_description ?? null, output_description: sd.output_description ?? null,
      acceptance_focus: sd.acceptance_focus ?? [],
      acceptance_checklist: (sd.acceptance_checklist ?? []) as StageChecklistItem[],
    });
    expandStageRoles(sd.roles ?? [], sd.key, stageRoleDefinitions);
  }
  return { stageDefinitions, stageRoleDefinitions };
}

function buildTransitions(sopId: string, raw: NonNullable<SopYamlFile["transitions"]>): SopTransition[] {
  return raw.map((t) => {
    let guard: TransitionGuard | null = null;
    if (t.guard) guard = { type: t.guard.type as TransitionGuard["type"], config: t.guard.config ?? {} };
    return { id: `st-${sopId}-${t.from}-${t.to}`, sop_id: sopId, from_stage_key: t.from, to_stage_key: t.to, guard };
  });
}

export function resolveHandbookFileRefs(parsed: SopYamlFile, sopDir: string): void {
  if (typeof parsed.shared_handbook === "string" && parsed.shared_handbook.startsWith("@")) {
    parsed.shared_handbook = readHandbookFile(sopDir, parsed.shared_handbook.slice(1));
  }
  for (const sd of parsed.stage_definitions ?? []) {
    for (const role of sd.roles ?? []) {
      if (typeof role.handbook === "string" && role.handbook.startsWith("@")) {
        role.handbook = readHandbookFile(sopDir, role.handbook.slice(1));
      }
    }
  }
}

export function readHandbookFile(sopDir: string, fileName: string): string {
  const p = path.join(sopDir, fileName);
  if (!fs.existsSync(p)) throw new Error(`Handbook file not found: ${p}`);
  return fs.readFileSync(p, "utf8");
}

export function expandStageRoles(
  roles: SopYamlFile["stage_definitions"][number]["roles"],
  stageDefId: string,
  srds: StageRoleDefinition[],
): void {
  for (const rd of roles) {
    const count = rd.count ?? 1;
    for (let i = 1; i <= count; i++) {
      const suffix = count > 1 ? `-${i}` : "";
      srds.push({
        id: `srd-${stageDefId}-${rd.key}${suffix}`, stage_definition_id: stageDefId, key: rd.key,
        name: `${rd.name}${suffix}`, snail_template_id: null,
        is_primary: Boolean(rd.is_primary && i === 1), count,
        description: rd.description ?? "", handbook: rd.handbook ?? null,
      });
    }
  }
}
