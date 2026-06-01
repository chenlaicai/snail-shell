import fs from "node:fs";
import path from "node:path";

/**
 * `.snail` 目录解析结果。
 *
 * 每个字段对应 `.snail/` 下的一类配置文件，加载到数据库时作为唯一真相源。
 */
export interface SnailConfig {
  workspace: SnailWorkspaceConfig;
  sops: SnailSopConfig[];
}

export interface SnailWorkspaceConfig {
  name: string;
  summary?: string;
  default_sop_key?: string;
}

export interface SnailSopConfig {
  key: string;
  name: string;
  description?: string;
  role_definitions: Array<{
    key: string;
    name: string;
    description?: string;
    handbook_prompt_ref?: string;
    working_rules?: string[];
  }>;
  stage_definitions: Array<{
    key: string;
    title: string;
    sequence: number;
    input_description?: string;
    output_description?: string;
    acceptance_focus?: string[];
    roles: Array<{
      role_key: string;
      is_primary?: boolean;
      working_rules_override?: string[];
    }>;
  }>;
}

/**
 * 检测目录下是否存在 `.snail/` 目录。
 */
export function hasSnailDirectory(workspaceRoot: string): boolean {
  const snailDir = path.join(workspaceRoot, ".snail");
  return fs.existsSync(snailDir) && fs.statSync(snailDir).isDirectory();
}

const DEFAULT_WORKSPACE_CONFIG: SnailWorkspaceConfig = {
  name: "New Workspace",
  summary: "",
};

const DEFAULT_SOP_CONFIG: SnailSopConfig = {
  key: "code-delivery",
  name: "Code Delivery",
  description: "Standard code delivery workflow",
  role_definitions: [
    {
      key: "developer",
      name: "Developer",
      description: "Responsible for requirement discussion, design, implementation, self-check, and PR submission",
      working_rules: [
        "Discuss requirements with user before implementation",
        "Self-check and submit PR after development",
      ],
    },
  ],
  stage_definitions: [
    {
      key: "development",
      title: "Development",
      sequence: 1,
      input_description: "Requirements, problem clues, or previous stage output",
      output_description: "Completed requirement convergence, design, implementation, self-check, and submitted PR",
      acceptance_focus: [
        "Requirements boundary converged",
        "Implementation completed necessary verification",
        "PR ready for review",
      ],
      roles: [{ role_key: "developer", is_primary: true }],
    },
    {
      key: "review",
      title: "PR Review",
      sequence: 2,
      input_description: "PR deliverable from previous stage",
      output_description: "Completed PR review, comment handling, and re-check until no pending issues",
      acceptance_focus: [
        "Review comments handled or responded",
        "Verification results traceable",
        "Ready for user to merge",
      ],
      roles: [{ role_key: "developer", is_primary: true }],
    },
  ],
};

/**
 * 初始化 `.snail/` 目录结构。
 *
 * 创建默认的 workspace.json 和 sop/code-delivery.json。
 * 如果文件已存在则跳过写入，从磁盘读取实际内容返回，
 * 确保返回值与磁盘状态一致。
 *
 * @returns 初始化后的 SnailConfig
 */
export function initializeSnailDirectory(
  workspaceRoot: string,
  options?: { name?: string; summary?: string }
): SnailConfig {
  const snailDir = path.join(workspaceRoot, ".snail");
  const sopDir = path.join(snailDir, "sop");

  fs.mkdirSync(snailDir, { recursive: true });
  fs.mkdirSync(sopDir, { recursive: true });

  const workspaceConfig: SnailWorkspaceConfig = {
    name: options?.name || DEFAULT_WORKSPACE_CONFIG.name,
    summary: options?.summary || DEFAULT_WORKSPACE_CONFIG.summary,
    default_sop_key: DEFAULT_SOP_CONFIG.key,
  };

  const workspaceJsonPath = path.join(snailDir, "workspace.json");
  if (!fs.existsSync(workspaceJsonPath)) {
    fs.writeFileSync(workspaceJsonPath, JSON.stringify(workspaceConfig, null, 2), "utf8");
  }

  const sopJsonPath = path.join(sopDir, `${DEFAULT_SOP_CONFIG.key}.json`);
  if (!fs.existsSync(sopJsonPath)) {
    fs.writeFileSync(sopJsonPath, JSON.stringify(DEFAULT_SOP_CONFIG, null, 2), "utf8");
  }

  /** 从磁盘读取实际内容，确保返回值与文件系统一致 */
  return loadSnailConfig(workspaceRoot);
}

/**
 * 从 `.snail/` 目录加载配置。
 *
 * 目录结构：
 * ```
 * .snail/
 *   workspace.json
 *   sop/
 *     <key>.json
 * ```
 *
 * @throws 目录不存在或配置文件格式错误时抛出异常
 */
export function loadSnailConfig(workspaceRoot: string): SnailConfig {
  const snailDir = path.join(workspaceRoot, ".snail");
  if (!fs.existsSync(snailDir) || !fs.statSync(snailDir).isDirectory()) {
    throw new Error(`.snail directory not found: ${snailDir}`);
  }

  const workspace = loadWorkspaceConfig(snailDir);
  const sops = loadSopConfigs(snailDir);

  return { workspace, sops };
}

function loadWorkspaceConfig(snailDir: string): SnailWorkspaceConfig {
  const configPath = path.join(snailDir, "workspace.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`workspace.json not found in ${snailDir}`);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse workspace.json: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  const name = requireTrimmedString(parsed.name, "workspace.json 'name'");

  return {
    name,
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    default_sop_key: typeof parsed.default_sop_key === "string" ? parsed.default_sop_key : undefined,
  };
}

function loadSopConfigs(snailDir: string): SnailSopConfig[] {
  const sopDir = path.join(snailDir, "sop");
  if (!fs.existsSync(sopDir) || !fs.statSync(sopDir).isDirectory()) {
    return [];
  }

  const files = fs.readdirSync(sopDir).filter((f) => f.endsWith(".json"));
  return files.map((file) => loadSingleSopConfig(path.join(sopDir, file)));
}

function loadSingleSopConfig(filePath: string): SnailSopConfig {
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse SOP file ${filePath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  const key = requireTrimmedString(parsed.key, `SOP file ${filePath} 'key'`);
  const name = requireTrimmedString(parsed.name, `SOP file ${filePath} 'name'`);

  const roleDefinitions = parseRoleDefinitions(parsed.role_definitions, filePath);
  const stageDefinitions = parseStageDefinitions(parsed.stage_definitions, filePath, roleDefinitions);

  return {
    key,
    name,
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    role_definitions: roleDefinitions,
    stage_definitions: stageDefinitions,
  };
}

/** 提取非空字符串字段，统一 trim + 校验，降低各解析函数的圈复杂度 */
function requireTrimmedString(value: unknown, label: string): string {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function parseRoleDefinitions(raw: unknown, filePath: string): SnailSopConfig["role_definitions"] {
  if (!Array.isArray(raw)) {
    throw new Error(`role_definitions in ${filePath} must be an array`);
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`role_definitions[${index}] in ${filePath} must be an object`);
    }
    const role = item as Record<string, unknown>;
    return {
      key: requireTrimmedString(role.key, `role_definitions[${index}].key in ${filePath}`),
      name: requireTrimmedString(role.name, `role_definitions[${index}].name in ${filePath}`),
      description: typeof role.description === "string" ? role.description : undefined,
      handbook_prompt_ref: typeof role.handbook_prompt_ref === "string" ? role.handbook_prompt_ref : undefined,
      working_rules: Array.isArray(role.working_rules) ? role.working_rules.filter((r) => typeof r === "string") : undefined,
    };
  });
}

function parseStageDefinitions(
  raw: unknown,
  filePath: string,
  roleDefinitions: SnailSopConfig["role_definitions"]
): SnailSopConfig["stage_definitions"] {
  if (!Array.isArray(raw)) {
    throw new Error(`stage_definitions in ${filePath} must be an array`);
  }

  const roleKeys = new Set(roleDefinitions.map((r) => r.key));

  return raw.map((item, index) => parseSingleStageDefinition(item, filePath, index, roleKeys));
}

function parseSingleStageDefinition(item: unknown, filePath: string, index: number, roleKeys: Set<string>): SnailSopConfig["stage_definitions"][0] {
  const stage = validateStageDefinition(item, filePath, index);
  const roles = parseStageRoles(stage.roles, filePath, index, roleKeys);

  return {
    key: (stage.key as string).trim(),
    title: (stage.title as string).trim(),
    sequence: stage.sequence as number,
    input_description: typeof stage.input_description === "string" ? stage.input_description : undefined,
    output_description: typeof stage.output_description === "string" ? stage.output_description : undefined,
    acceptance_focus: Array.isArray(stage.acceptance_focus) ? stage.acceptance_focus.filter((f) => typeof f === "string") : undefined,
    roles,
  };
}

function validateStageDefinition(item: unknown, filePath: string, index: number): Record<string, unknown> {
  if (!item || typeof item !== "object") {
    throw new Error(`stage_definitions[${index}] in ${filePath} must be an object`);
  }
  const stage = item as Record<string, unknown>;
  requireTrimmedString(stage.key, `stage_definitions[${index}].key in ${filePath}`);
  requireTrimmedString(stage.title, `stage_definitions[${index}].title in ${filePath}`);
  if (typeof stage.sequence !== "number" || !Number.isFinite(stage.sequence)) {
    throw new Error(`stage_definitions[${index}].sequence in ${filePath} must be a finite number`);
  }
  return stage;
}

function parseStageRoles(
  raw: unknown,
  filePath: string,
  stageIndex: number,
  roleKeys: Set<string>
): SnailSopConfig["stage_definitions"][0]["roles"] {
  if (!Array.isArray(raw)) {
    throw new Error(`stage_definitions[${stageIndex}].roles in ${filePath} must be an array`);
  }

  return raw.map((item, roleIndex) => {
    if (!item || typeof item !== "object") {
      throw new Error(`stage_definitions[${stageIndex}].roles[${roleIndex}] in ${filePath} must be an object`);
    }
    const role = item as Record<string, unknown>;
    const trimmedRoleKey = requireTrimmedString(
      role.role_key,
      `stage_definitions[${stageIndex}].roles[${roleIndex}].role_key in ${filePath}`
    );
    if (!roleKeys.has(trimmedRoleKey)) {
      throw new Error(
        `stage_definitions[${stageIndex}].roles[${roleIndex}].role_key "${trimmedRoleKey}" in ${filePath} does not match any role_definitions key`
      );
    }

    return {
      role_key: trimmedRoleKey,
      is_primary: typeof role.is_primary === "boolean" ? role.is_primary : undefined,
      working_rules_override: Array.isArray(role.working_rules_override)
        ? role.working_rules_override.filter((r) => typeof r === "string")
        : undefined,
    };
  });
}

/**
 * 将 `.snail` 配置转换为数据库 seed 格式。
 *
 * 生成的 ID 基于 workspaceId + key 的确定性组合，确保重复加载时 ID 稳定。
 */
export function convertSnailConfigToSeed(
  workspaceId: string,
  config: SnailConfig
): {
  sopSeeds: Array<{
    sop: { id: string; source: "workspace"; sourceRef: string; key: string; name: string; description: string | null };
    stage_definitions: Array<{
      key: string;
      title: string;
      sequence: number;
      input_description: string | null;
      output_description: string | null;
      acceptance_focus: string[];
      roles: Array<{ key: string; name: string; description?: string; handbook_prompt_ref?: string | null; working_rules?: string[]; is_primary?: boolean }>;
    }>;
  }>;
  workspaceBindings: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }>;
} {
  const sopSeeds = config.sops.map((sop) => convertSingleSopToSeed(workspaceId, sop));
  const defaultSopKey = config.workspace.default_sop_key;
  const workspaceBindings = sopSeeds.map((sop) => ({
    sop_id: sop.sop.id,
    is_default: sop.sop.key === defaultSopKey,
    role_bindings: {} as Record<string, string | string[]>,
  }));

  return { sopSeeds, workspaceBindings };
}

function convertSingleSopToSeed(workspaceId: string, sop: SnailSopConfig) {
  const sopId = `sop-${workspaceId}-${sop.key}`;

  /** 构建 role_key → role_definition 的映射，用于在 stage 中嵌入角色信息。 */
  const roleDefByKey = new Map<string, { key: string; name: string; description: string; handbook_prompt_ref: string | null; working_rules: string[] }>();
  for (const rd of sop.role_definitions) {
    roleDefByKey.set(rd.key, {
      key: rd.key,
      name: rd.name,
      description: rd.description ?? "",
      handbook_prompt_ref: rd.handbook_prompt_ref ?? null,
      working_rules: rd.working_rules ?? [],
    });
  }

  const stage_definitions = sop.stage_definitions.map((sd) => ({
    key: sd.key,
    title: sd.title,
    sequence: sd.sequence,
    input_description: sd.input_description ?? null,
    output_description: sd.output_description ?? null,
    acceptance_focus: sd.acceptance_focus ?? [],
    roles: sd.roles.map((sr) => {
      const roleDef = roleDefByKey.get(sr.role_key);
      if (!roleDef) throw new Error(`role_key "${sr.role_key}" not found in SOP "${sop.key}" role_definitions`);
      return {
        key: roleDef.key,
        name: roleDef.name,
        description: roleDef.description,
        handbook_prompt_ref: roleDef.handbook_prompt_ref,
        working_rules: roleDef.working_rules,
        is_primary: sr.is_primary ?? false,
      };
    }),
  }));

  return {
    sop: {
      id: sopId,
      source: "workspace" as const,
      sourceRef: workspaceId,
      key: sop.key,
      name: sop.name,
      description: sop.description ?? null,
    },
    stage_definitions,
  };
}
