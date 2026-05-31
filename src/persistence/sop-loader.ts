import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type Database from "better-sqlite3";
import { upsertSopFromYaml, type SopUpsertInput } from "./sop-model";

/**
 * SOP YAML 文件的解析结构。
 * 与 .meta/sop/*.yaml 文件格式一一对应。
 */
interface SopYamlFile {
  name: string;
  description?: string;
  role_definitions: Array<{
    key: string;
    name: string;
    description?: string;
    handbook_prompt_ref?: string | null;
    working_rules?: string[];
  }>;
  stage_definitions: Array<{
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

/**
 * 加载单个 SOP YAML 文件并 upsert 到数据库。
 * 文件名（不含扩展名）即 SOP key。
 *
 * @returns SOP ID，如果文件无效则返回 null
 */
function loadSingleSopFile(
  db: Database.Database,
  filePath: string,
  source: "platform" | "workspace",
  sourceRef: string | null,
): string | null {
  const key = path.basename(filePath, path.extname(filePath));
  if (!key) return null;

  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: SopYamlFile;
  try {
    parsed = parseYaml(raw) as SopYamlFile;
  } catch (err) {
    throw new Error(`Failed to parse SOP YAML file ${filePath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  if (!parsed.name) {
    throw new Error(`SOP YAML file ${filePath} is missing required field "name"`);
  }

  const sopId = source === "platform" ? `sop-${key}` : `sop-${sourceRef}-${key}`;

  const sopInput: SopUpsertInput = {
    id: sopId,
    source,
    sourceRef,
    key,
    name: parsed.name,
    description: parsed.description ?? null,
  };

  upsertSopFromYaml(db, sopInput, parsed.role_definitions ?? [], parsed.stage_definitions ?? []);
  return sopId;
}

/**
 * 扫描目录下的所有 .yaml/.yml 文件并加载 SOP。
 * 跳过非 YAML 文件和空目录。
 */
function scanAndLoadSopDir(
  db: Database.Database,
  dir: string,
  source: "platform" | "workspace",
  sourceRef: string | null,
): number {
  if (!fs.existsSync(dir)) return 0;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  let loaded = 0;
  for (const file of files) {
    const filePath = path.join(dir, file);
    const sopId = loadSingleSopFile(db, filePath, source, sourceRef);
    if (sopId) loaded++;
  }
  return loaded;
}

/**
 * 启动时加载所有 SOP YAML 文件到数据库。
 * 以 YAML 为准：已存在的 SOP 会被覆盖更新。
 *
 * 加载顺序：
 * 1. 平台级：.meta/sop/*.yaml（source='platform'）
 * 2. Workspace 级：各 workspace 的 <workspace_root>/.snail/sop/*.yaml（source='workspace'）
 *
 * Why: 必须先加载平台级 SOP，因为 workspace-config-seed.json
 * 中的 workspace 绑定引用的是平台级 SOP ID。
 */
export function loadAllSopFiles(
  db: Database.Database,
  repoRoot: string,
  workspaces: Array<{ id: string; workspace_root: string }>,
): { platformLoaded: number; workspaceLoaded: number } {
  /* 1. 平台级 SOP */
  const platformDir = path.join(repoRoot, ".meta", "sop");
  const platformLoaded = scanAndLoadSopDir(db, platformDir, "platform", null);

  /* 2. Workspace 级 SOP */
  let workspaceLoaded = 0;
  for (const ws of workspaces) {
    const wsSopDir = path.join(ws.workspace_root, ".snail", "sop");
    workspaceLoaded += scanAndLoadSopDir(db, wsSopDir, "workspace", ws.id);
  }

  return { platformLoaded, workspaceLoaded };
}
