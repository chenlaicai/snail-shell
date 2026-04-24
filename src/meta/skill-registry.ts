import fs from "fs";
import path from "path";

export interface SkillDefinition {
  name: string;
  description: string;
  filePath: string;
  content: string;
  title: string;
}

const skillsRoot = path.join(process.cwd(), ".meta", "skills");
const skillRegistry = buildSkillRegistry();

export function listSkills(): SkillDefinition[] {
  return skillRegistry;
}

export function getSkill(name: string): SkillDefinition {
  const skill = skillRegistry.find((item) => item.name === name);
  if (!skill) {
    throw new Error(`Skill not found: ${name}`);
  }
  return skill;
}

function buildSkillRegistry(): SkillDefinition[] {
  if (!fs.existsSync(skillsRoot)) {
    return [];
  }

  const skills = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsRoot, entry.name, "SKILL.md"))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => parseSkillDefinition(filePath, fs.readFileSync(filePath, "utf8")));
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

function parseSkillDefinition(filePath: string, raw: string): SkillDefinition {
  const { head, body } = splitFrontmatter(raw, filePath);
  const frontmatter = parseSimpleYaml(head);
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? frontmatter.name ?? path.basename(path.dirname(filePath));
  return {
    name: String(frontmatter.name ?? path.basename(path.dirname(filePath))),
    description: String(frontmatter.description ?? ""),
    filePath,
    content: normalizeText(body).trim(),
    title,
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
