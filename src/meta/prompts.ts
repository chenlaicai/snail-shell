import fs from "fs";
import path from "path";
import type { AgentRuntime } from "../agent/interface";
import type { SnailName, StageType } from "../persistence/store";

export interface PromptAssetWhen {
  runtimes?: AgentRuntime[];
  stage_types?: StageType[];
  snails?: SnailName[];
}

export interface SystemPromptAsset {
  id: string;
  title: string;
  kind: "section" | "assembly" | "snail-profile" | "task-prompt";
  target?: string;
  section?: string;
  snail?: SnailName;
  when?: PromptAssetWhen;
  includes?: string[];
  include_matched_regulations?: boolean;
  skills?: Array<{ id: string; mode: "required" | "conditional"; reason: string }>;
  filePath: string;
  content: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  filePath: string;
  content: string;
  title: string;
}

const promptsRoot = path.join(process.cwd(), ".meta", "prompts");
const systemRoot = path.join(promptsRoot, "system");
const skillsRoot = path.join(promptsRoot, "skills");

export function listSystemPromptAssets(): SystemPromptAsset[] {
  return discoverFiles(systemRoot, (filePath) => filePath.endsWith(".md") && !filePath.endsWith(".template"))
    .map((filePath) => parseSystemPromptAsset(filePath, fs.readFileSync(filePath, "utf8")));
}

export function getSystemPromptAsset(id: string): SystemPromptAsset {
  const asset = listSystemPromptAssets().find((item) => item.id === id);
  if (!asset) {
    throw new Error(`System prompt asset not found: ${id}`);
  }
  return asset;
}

export function getAssembly(target: string): SystemPromptAsset {
  const asset = listSystemPromptAssets().find((item) => item.kind === "assembly" && item.target === target);
  if (!asset) {
    throw new Error(`Assembly not found for target: ${target}`);
  }
  return asset;
}

export function getTaskPrompt(target: string): string {
  const asset = listSystemPromptAssets().find((item) => item.kind === "task-prompt" && item.target === target);
  if (!asset) {
    throw new Error(`Task prompt not found for target: ${target}`);
  }
  return asset.content.trim();
}

export function listSkills(): SkillDefinition[] {
  if (!fs.existsSync(skillsRoot)) {
    return [];
  }

  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsRoot, entry.name, "SKILL.md"))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => parseSkillDefinition(filePath, fs.readFileSync(filePath, "utf8")));
}

export function getSkill(name: string): SkillDefinition {
  const skill = listSkills().find((item) => item.name === name);
  if (!skill) {
    throw new Error(`Skill not found: ${name}`);
  }
  return skill;
}

export function renderTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => variables[key] ?? "");
}

function parseSystemPromptAsset(filePath: string, raw: string): SystemPromptAsset {
  const { head, body } = splitFrontmatter(raw, filePath);
  const parsed = JSON.parse(head) as Omit<SystemPromptAsset, "filePath" | "content">;
  return { ...parsed, filePath, content: normalizeText(body).trim() };
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
    throw new Error(`Prompt document must start with frontmatter: ${filePath}`);
  }
  const secondDelimiter = normalized.indexOf("\n---\n", 4);
  if (secondDelimiter === -1) {
    throw new Error(`Prompt document frontmatter is not closed: ${filePath}`);
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

function discoverFiles(rootDir: string, include: (filePath: string) => boolean): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...discoverFiles(fullPath, include));
      continue;
    }
    if (entry.isFile() && include(fullPath)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function normalizeText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
