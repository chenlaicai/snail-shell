import fs from "fs";
import path from "path";

export interface SkillDefinition {
  name: string;
  description: string;
  filePath: string;
  content: string;
  title: string;
  /** skill 来源：platform 为平台级（.meta/skills/），workspace 为工作区级（<projectRoot>/.snail/skills/） */
  source: "platform" | "workspace";
}

const globalSkillsRoot = path.join(process.cwd(), ".meta", "skills");
const globalSkillRegistry = buildSkillRegistryFromDir(globalSkillsRoot, "platform");

/** 返回全局已注册的 skill 列表。 */
export function listSkills(): SkillDefinition[] {
  return globalSkillRegistry;
}

/**
 * 返回合并后的 skill 列表：全局 + 工作区级。
 *
 * 工作区级 skill 从 `<workspaceRoot>/.snail/skills/` 加载，与 prompt 系统的
 * `loadWorkspacePrompts()` 对齐。同名 skill 必须报错——skill name 全局唯一。
 */
export function listSkillsWithWorkspace(workspaceRoot: string): SkillDefinition[] {
  const workspaceSkillsRoot = path.join(workspaceRoot, ".snail", "skills");
  const workspaceSkills = buildSkillRegistryFromDir(workspaceSkillsRoot, "workspace");
  if (workspaceSkills.length === 0) return globalSkillRegistry;
  return mergeSkills(globalSkillRegistry, workspaceSkills);
}

/**
 * 合并全局和工作区级 skill 列表。同名 skill 必须报错——skill name 全局唯一。
 * 返回新数组，不修改输入。
 */
function mergeSkills(global: SkillDefinition[], workspace: SkillDefinition[]): SkillDefinition[] {
  const map = new Map<string, SkillDefinition>();
  for (const s of global) map.set(s.name, s);
  for (const s of workspace) {
    const existing = map.get(s.name);
    if (existing) {
      throw new Error(
        `Duplicate skill name detected across sources: ${s.name} | ` +
        `${existing.source}: ${existing.filePath} | ${s.source}: ${s.filePath}`
      );
    }
    map.set(s.name, s);
  }
  return Array.from(map.values());
}

export function getSkill(name: string): SkillDefinition {
  const skill = globalSkillRegistry.find((item) => item.name === name);
  if (!skill) {
    throw new Error(`Skill not found: ${name}`);
  }
  return skill;
}

function buildSkillRegistryFromDir(skillsRoot: string, source: "platform" | "workspace"): SkillDefinition[] {
  if (!fs.existsSync(skillsRoot)) {
    return [];
  }

  const skills = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsRoot, entry.name, "SKILL.md"))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => parseSkillDefinition(filePath, fs.readFileSync(filePath, "utf8"), source));
  validateSkillNames(skills);
  return skills;
}

function validateSkillNames(skills: SkillDefinition[]): void {
  const seen = new Map<string, string>();
  for (const skill of skills) {
    const existing = seen.get(skill.name);
    if (existing) {
      throw new Error(`Duplicate skill name detected: ${skill.name} | ${existing} | ${skill.filePath}`);
    }
    seen.set(skill.name, skill.filePath);
  }
}

function parseSkillDefinition(filePath: string, raw: string, source: "platform" | "workspace"): SkillDefinition {
  const { head, body } = splitFrontmatter(raw, filePath);
  const frontmatter = parseSimpleYaml(head);
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? frontmatter.name ?? path.basename(path.dirname(filePath));
  return {
    name: String(frontmatter.name ?? path.basename(path.dirname(filePath))),
    description: String(frontmatter.description ?? ""),
    filePath,
    content: normalizeText(body).trim(),
    title,
    source,
  };
}

function splitFrontmatter(raw: string, filePath: string): { head: string; body: string } {
  const normalized = normalizeText(raw).trim();
  if (!normalized.startsWith("---\n")) {
    throw new Error(`Skill document must start with frontmatter: ${filePath}`);
  }
  const secondDelimiter = normalized.indexOf("\n---\n", 4);
  if (secondDelimiter === -1) {
    throw new Error(`Skill document frontmatter is not closed: ${filePath}`);
  }
  return {
    head: normalized.slice(4, secondDelimiter).trim(),
    body: normalized.slice(secondDelimiter + 5).trim(),
  };
}

function parseSimpleYaml(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    result[match[1] ?? ""] = (match[2] ?? "").trim();
  }
  return result;
}

function normalizeText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
