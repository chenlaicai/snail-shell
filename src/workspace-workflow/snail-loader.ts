import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { parsePromptDocument, type PromptDocument } from "../prompt-center/registry";
import { parseSkillDefinition, type SkillDefinition } from "../skill-center/registry";

/** YAML 中 stage 定义内嵌的角色定义。 */
export interface YamlStageRoleDefinition {
  key: string;
  name: string;
  description?: string;
  handbook_prompt_ref?: string | null;
  working_rules?: string[];
  is_primary?: boolean;
  /** 该角色在本 Stage 的实例数。默认 1。count=2 展开为 "检视者-1"、"检视者-2"。 */
  count?: number;
}

/** YAML 中 stage 定义，包含内嵌角色。 */
export interface YamlStageDefinition {
  key: string;
  title: string;
  sequence: number;
  description?: string;
  input_description?: string | null;
  output_description?: string | null;
  acceptance_focus?: string[];
  acceptance_checklist?: Array<{ id: string; description: string; required: boolean }>;
  roles: YamlStageRoleDefinition[];
}

/**
 * `.snail/` 目录下的共享路径常量。
 *
 * 所有模块通过此处获取 `.snail/` 子目录路径，避免各处自行拼接导致约定散落。
 */
export const SNAIL_DIR_NAME = ".snail";
export const snailPaths = {
  root: (workspaceRoot: string) => path.join(workspaceRoot, SNAIL_DIR_NAME),
  workspaceJson: (workspaceRoot: string) => path.join(workspaceRoot, SNAIL_DIR_NAME, "workspace.json"),
  sopDir: (workspaceRoot: string) => path.join(workspaceRoot, SNAIL_DIR_NAME, "config", "sop"),
  promptsDir: (workspaceRoot: string) => path.join(workspaceRoot, SNAIL_DIR_NAME, "prompts"),
  skillsDir: (workspaceRoot: string) => path.join(workspaceRoot, SNAIL_DIR_NAME, "skills"),
};

/**
 * `.snail/` 目录加载结果——workspace 级配置的统一上下文。
 *
 * 所有 `.snail/` 资源通过 `loadWorkspaceContext` 一次性加载，
 * 消费者从 context 读取，不再各自扫描 `.snail/` 子目录。
 */
export interface WorkspaceContext {
  workspaceRoot: string;
  config: SnailWorkspaceConfig;
  sopDefinitions: SopYamlDefinition[];
  prompts: PromptDocument[];
  skills: SkillDefinition[];
}

/**
 * SOP YAML 文件的解析结构。
 * 与 config/sop/*.yaml 和 .snail/config/sop/*.yaml 格式对齐。
 * stage_definitions 使用本地定义的 YamlStageDefinition，
 * 确保与 replaceWorkspaceConfigs 的类型直接兼容。
 */
export interface SopYamlDefinition {
  /** SOP key，从文件名派生（不含扩展名） */
  key: string;
  filePath: string;
  name: string;
  description?: string;
  stage_definitions: YamlStageDefinition[];
}

export interface SnailWorkspaceConfig {
  name: string;
  summary?: string;
  default_sop_key?: string;
}

/**
 * 检测目录下是否存在 `.snail/` 目录。
 */
export function hasSnailDirectory(workspaceRoot: string): boolean {
  const snailDir = snailPaths.root(workspaceRoot);
  return fs.existsSync(snailDir) && fs.statSync(snailDir).isDirectory();
}

/**
 * Load all resources from `.snail/` directory into a unified WorkspaceContext.
 *
 * Reads workspace.json, sop YAML, prompt documents, and skill definitions in one pass.
 * Consumers read from the context instead of scanning `.snail/` subdirectories independently.
 *
 * @param workspaceRoot workspace root directory (parent of `.snail/`)
 * @param options.loadSopDefinitions whether to load SOP definitions (default true)
 */
export function loadWorkspaceContext(
  workspaceRoot: string,
  options?: { loadSopDefinitions?: boolean },
): WorkspaceContext {
  const snailDir = snailPaths.root(workspaceRoot);
  if (!fs.existsSync(snailDir) || !fs.statSync(snailDir).isDirectory()) {
    throw new Error(`.snail directory not found: ${snailDir}`);
  }

  const config = loadWorkspaceConfig(snailDir);
  const loadSop = options?.loadSopDefinitions !== false;
  const sopDefinitions = loadSop ? loadSopYamlDefinitions(snailPaths.sopDir(workspaceRoot)) : [];
  const prompts = loadPrompts(snailPaths.promptsDir(workspaceRoot));
  const skills = loadSkills(snailPaths.skillsDir(workspaceRoot));

  return { workspaceRoot, config, sopDefinitions, prompts, skills };
}

/**
 * 仅加载 workspace 配置（workspace.json），不加载其他资源。
 *
 * 用于只需要 workspace 元数据的场景（如 detect-snail API）。
 */
export function loadWorkspaceConfigOnly(workspaceRoot: string): SnailWorkspaceConfig {
  const snailDir = snailPaths.root(workspaceRoot);
  if (!fs.existsSync(snailDir) || !fs.statSync(snailDir).isDirectory()) {
    throw new Error(`.snail directory not found: ${snailDir}`);
  }
  return loadWorkspaceConfig(snailDir);
}

const DEFAULT_WORKSPACE_CONFIG: SnailWorkspaceConfig = {
  name: "New Workspace",
  summary: "",
};

const DEFAULT_SOP_YAML = `name: Code Delivery
description: Standard code delivery workflow
stage_definitions:
  - key: development
    title: Development
    sequence: 1
    description: Requirements, problem clues, or previous stage output
    input_description: "输入: 需求、问题线索或上一阶段产出物"
    output_description: "输出: 完成需求收敛、设计、实现、自检并提交 PR"
    acceptance_focus:
      - 需求边界已收敛
      - 实现完成必要验证
      - PR 可供检视
    roles:
      - key: developer
        name: Developer
        description: Responsible for requirement discussion, implementation, self-check, and PR submission
        is_primary: true
        working_rules:
          - 实现前先和用户讨论需求
          - 完成开发后必须自检并提交 PR
  - key: review
    title: PR Review
    sequence: 2
    description: PR deliverable from previous stage
    input_description: "输入: 上一阶段的 PR 交付物"
    output_description: "输出: 完成 PR 检视、意见处理和复检直到无待处理问题"
    acceptance_focus:
      - 检视意见已处理或回复
      - 验证结果可追溯
      - 等待用户合入
    roles:
      - key: developer
        name: Developer
        description: Responsible for requirement discussion, implementation, self-check, and PR submission
        is_primary: true
        working_rules:
          - 逐条处理或理性回应检视意见
`;

/**
 * 初始化 `.snail/` 目录结构。
 *
 * 创建默认的 workspace.json 和 sop/code-delivery.yaml。
 * 如果文件已存在则跳过写入。
 *
 * @returns 初始化后的 WorkspaceContext
 */
export function initializeSnailDirectory(
  workspaceRoot: string,
  options?: { name?: string; summary?: string },
): WorkspaceContext {
  const snailDir = snailPaths.root(workspaceRoot);
  const sopDir = snailPaths.sopDir(workspaceRoot);

  fs.mkdirSync(snailDir, { recursive: true });
  fs.mkdirSync(sopDir, { recursive: true });

  const workspaceConfig: SnailWorkspaceConfig = {
    name: options?.name || DEFAULT_WORKSPACE_CONFIG.name,
    summary: options?.summary || DEFAULT_WORKSPACE_CONFIG.summary,
    default_sop_key: "code-delivery",
  };

  const workspaceJsonPath = snailPaths.workspaceJson(workspaceRoot);
  if (!fs.existsSync(workspaceJsonPath)) {
    fs.writeFileSync(workspaceJsonPath, JSON.stringify(workspaceConfig, null, 2), "utf8");
  }

  const sopYamlPath = path.join(sopDir, "code-delivery.yaml");
  if (!fs.existsSync(sopYamlPath)) {
    fs.writeFileSync(sopYamlPath, DEFAULT_SOP_YAML, "utf8");
  }

  /** 从磁盘读取实际内容，确保返回值与文件系统一致 */
  return loadWorkspaceContext(workspaceRoot);
}

// ─── 内部实现 ────────────────────────────────────────────────────────────────

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

/**
 * 从目录加载 SOP YAML 定义。
 *
 * 扫描目录下的 .yaml/.yml 文件，解析为 SopYamlDefinition 数组。
 * SOP key 从文件名派生（不含扩展名）。
 * 目录不存在时返回空数组。
 */
export function loadSopYamlDefinitions(dir: string): SopYamlDefinition[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return files.map((file) => {
    const filePath = path.join(dir, file);
    const key = path.basename(file, path.extname(file));
    const raw = fs.readFileSync(filePath, "utf8");
    let parsed: Record<string, unknown>;
    try {
      parsed = yaml.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Failed to parse SOP YAML ${filePath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }

    const name = requireTrimmedString(parsed.name, `SOP YAML ${filePath} 'name'`);
    const stage_definitions = parseStageDefinitionsYaml(parsed.stage_definitions, filePath);

    return {
      key,
      filePath,
      name,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      stage_definitions,
    };
  });
}

function parseStageDefinitionsYaml(raw: unknown, filePath: string): YamlStageDefinition[] {
  if (!Array.isArray(raw)) {
    throw new Error(`stage_definitions in ${filePath} must be an array`);
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`stage_definitions[${index}] in ${filePath} must be an object`);
    }
    const stage = item as Record<string, unknown>;
    const key = requireTrimmedString(stage.key, `stage_definitions[${index}].key in ${filePath}`);
    const title = requireTrimmedString(stage.title, `stage_definitions[${index}].title in ${filePath}`);
    const sequence = stage.sequence as number;
    if (typeof sequence !== "number" || !Number.isFinite(sequence)) {
      throw new Error(`stage_definitions[${index}].sequence in ${filePath} must be a finite number`);
    }

    const roles = parseStageRolesYaml(stage.roles, filePath, index);
    const acceptance_checklist = parseAcceptanceChecklist(stage.acceptance_checklist, filePath, index);

    return {
      key,
      title,
      sequence,
      description: typeof stage.description === "string" ? stage.description : undefined,
      input_description: typeof stage.input_description === "string" ? stage.input_description : undefined,
      output_description: typeof stage.output_description === "string" ? stage.output_description : undefined,
      acceptance_focus: Array.isArray(stage.acceptance_focus) ? stage.acceptance_focus.filter((f) => typeof f === "string") : undefined,
      acceptance_checklist,
      roles,
    };
  });
}

function parseAcceptanceChecklist(raw: unknown, filePath: string, stageIndex: number): YamlStageDefinition["acceptance_checklist"] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`stage_definitions[${stageIndex}].acceptance_checklist[${index}] in ${filePath} must be an object`);
    }
    const entry = item as Record<string, unknown>;
    return {
      id: requireTrimmedString(entry.id, `stage_definitions[${stageIndex}].acceptance_checklist[${index}].id in ${filePath}`),
      description: requireTrimmedString(entry.description, `stage_definitions[${stageIndex}].acceptance_checklist[${index}].description in ${filePath}`),
      required: Boolean(entry.required),
    };
  });
}

function parseStageRolesYaml(raw: unknown, filePath: string, stageIndex: number): YamlStageRoleDefinition[] {
  if (!Array.isArray(raw)) {
    throw new Error(`stage_definitions[${stageIndex}].roles in ${filePath} must be an array`);
  }

  return raw.map((item, roleIndex) => {
    if (!item || typeof item !== "object") {
      throw new Error(`stage_definitions[${stageIndex}].roles[${roleIndex}] in ${filePath} must be an object`);
    }
    const role = item as Record<string, unknown>;
    const roleKey = requireTrimmedString(role.key, `stage_definitions[${stageIndex}].roles[${roleIndex}].key in ${filePath}`);
    const name = requireTrimmedString(role.name, `stage_definitions[${stageIndex}].roles[${roleIndex}].name in ${filePath}`);

    return {
      key: roleKey,
      name,
      description: typeof role.description === "string" ? role.description : undefined,
      handbook_prompt_ref: typeof role.handbook_prompt_ref === "string" ? role.handbook_prompt_ref : undefined,
      working_rules: Array.isArray(role.working_rules) ? role.working_rules.filter((r) => typeof r === "string") : undefined,
      is_primary: typeof role.is_primary === "boolean" ? role.is_primary : undefined,
      count: typeof role.count === "number" ? role.count : undefined,
    };
  });
}

function loadPrompts(promptsDir: string): PromptDocument[] {
  if (!fs.existsSync(promptsDir) || !fs.statSync(promptsDir).isDirectory()) {
    return [];
  }

  const files = discoverFiles(promptsDir, (f) => f.endsWith(".md") && !f.endsWith(".template") && !path.basename(f).startsWith("_template"));
  return files.map((filePath) => parsePromptDocument(filePath, fs.readFileSync(filePath, "utf8")));
}

function loadSkills(skillsDir: string): SkillDefinition[] {
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    return [];
  }

  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsDir, entry.name, "SKILL.md"))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => parseSkillDefinition(filePath, fs.readFileSync(filePath, "utf8"), "workspace"));
}

// ─── 共享工具函数 ────────────────────────────────────────────────────────────

/** 提取非空字符串字段，统一 trim + 校验 */
function requireTrimmedString(value: unknown, label: string): string {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function discoverFiles(rootDir: string, include: (filePath: string) => boolean): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fp = path.join(rootDir, entry.name);
    if (entry.isDirectory()) { files.push(...discoverFiles(fp, include)); continue; }
    if (entry.isFile() && include(fp)) files.push(fp);
  }
  return files.sort();
}
