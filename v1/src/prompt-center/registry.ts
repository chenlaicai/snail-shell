import fs from "fs";
import path from "path";
import yaml from "yaml";
import type { AgentRuntime } from "../shared/types";
import type { ConversationKind, ConversationOwnerType, RoleName, StageType } from "../shared/types";

export interface PromptWhen {
  runtimes?: AgentRuntime[];
  stage_types?: StageType[];
  roles?: RoleName[];
  conversation_kinds?: ConversationKind[];
  owner_types?: ConversationOwnerType[];
}

export type PromptLayer = "platform" | "sop" | "workspace";

export interface PromptDocument {
  id: string;
  title: string;
  layer: PromptLayer;
  priority: number;
  when?: PromptWhen;
  stability: "static" | "dynamic";
  content: string;
  filePath: string;
}

export interface PromptMatchContext {
  runtime?: AgentRuntime;
  stageType?: StageType;
  roleName?: RoleName;
  conversationKind?: ConversationKind;
  ownerType?: ConversationOwnerType;
}

const promptsRoot = path.join(__dirname, "..", "..", ".meta", "prompts");
const prompts = buildRegistry();

export function getPrompt(id: string): PromptDocument {
  const prompt = prompts.find((item) => item.id === id);
  if (!prompt) throw new Error(`Prompt not found: ${id}`);
  return prompt;
}

export function listPrompts(): PromptDocument[] {
  return prompts;
}

export function renderPromptTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => variables[key] ?? "");
}

export function renderPromptContent(prompt: PromptDocument, variables: Record<string, string>): string {
  return renderPromptTemplate(prompt.content, variables);
}

const MATCH_CHECKS: Array<{
  values: (w: PromptWhen) => string[] | undefined;
  contextVal: (c: PromptMatchContext) => string | undefined;
}> = [
  { values: (w) => w.runtimes, contextVal: (c) => c.runtime },
  { values: (w) => w.stage_types, contextVal: (c) => c.stageType },
  { values: (w) => w.roles, contextVal: (c) => c.roleName },
  { values: (w) => w.conversation_kinds, contextVal: (c) => c.conversationKind },
  { values: (w) => w.owner_types, contextVal: (c) => c.ownerType },
];

export function matchesWhen(when: PromptWhen | undefined, context: PromptMatchContext): boolean {
  if (!when) return true;
  return MATCH_CHECKS.every((check) => {
    const allowed = check.values(when);
    if (!allowed?.length) return true;
    const actual = check.contextVal(context);
    return !!actual && allowed.includes(actual);
  });
}

const LAYER_ORDER: Record<PromptLayer, number> = { sop: 0, workspace: 1, platform: 2 };

export interface AssemblyOptions {
  prompts: PromptDocument[];
  matchContext: PromptMatchContext;
  variables: Record<string, string>;
}

export function assembleSystemPrompt(options: AssemblyOptions): {
  systemPrompt: string;
  systemReminder: string;
  activePromptIds: string[];
} {
  const active = options.prompts.filter((p) => matchesWhen(p.when, options.matchContext));
  const sorted = [...active].sort((a, b) => {
    const d = (LAYER_ORDER[a.layer] ?? -1) - (LAYER_ORDER[b.layer] ?? -1);
    if (d !== 0) return d;
    return (a.priority ?? 0) - (b.priority ?? 0);
  });

  const renderList = (list: PromptDocument[]): string =>
    list
      .map((p) => renderPromptTemplate(p.content, options.variables).replace(/^## [^\n]*\n+/, ""))
      .filter(Boolean)
      .join("\n\n");

  const activePromptIds = sorted.map((p) => p.id);
  validatePromptCount(activePromptIds, options.prompts);

  return {
    systemPrompt: renderList(sorted.filter((p) => p.stability === "static")),
    systemReminder: renderList(sorted.filter((p) => p.stability === "dynamic")),
    activePromptIds,
  };
}

const MAX_PLATFORM = 6;
const MAX_SOP = 3;
const MAX_TOTAL = 6;

export function validatePromptCount(activePromptIds: string[], allPrompts: PromptDocument[]): void {
  const activeSet = new Set(activePromptIds);
  const activeDocs = allPrompts.filter((p) => activeSet.has(p.id));
  const platform = activeDocs.filter((p) => p.layer === "platform").length;
  const sop = activeDocs.filter((p) => p.layer === "sop").length;
  const total = activePromptIds.length;

  if (platform > MAX_PLATFORM) {
    console.warn(`[prompt-center] 活跃 platform prompt 数 ${platform} 超过上限 ${MAX_PLATFORM}，当前: ${activeDocs.filter((p) => p.layer === "platform").map((p) => p.id).join(", ")}`);
  }
  if (sop > MAX_SOP) {
    console.warn(`[prompt-center] 活跃 sop prompt 数 ${sop} 超过上限 ${MAX_SOP}，当前: ${activeDocs.filter((p) => p.layer === "sop").map((p) => p.id).join(", ")}`);
  }
  if (total > MAX_TOTAL) {
    console.warn(`[prompt-center] 活跃 prompt 总数 ${total} 超过 3+3 架构上限 ${MAX_TOTAL}，当前: ${activePromptIds.join(", ")}。请考虑将多余 prompt 合并或移入 prompt-constraints skill。`);
  }
}

export function mergePrompts(globalPrompts: PromptDocument[], workspacePrompts: PromptDocument[]): PromptDocument[] {
  const map = new Map<string, PromptDocument>();
  for (const p of globalPrompts) map.set(p.id, p);
  for (const p of workspacePrompts) map.set(p.id, p);
  return Array.from(map.values());
}

interface PromptFrontmatter {
  id: string;
  title: string;
  layer?: PromptLayer;
  priority?: number;
  when?: PromptWhen;
  stability?: "static" | "dynamic";
}

export function parsePromptDocument(filePath: string, raw: string): PromptDocument {
  const { head, body } = splitFrontmatter(raw, filePath);
  const parsed = yaml.parse(head) as PromptFrontmatter;
  return {
    ...parsed,
    layer: parsed.layer ?? "platform",
    priority: parsed.priority ?? 0,
    stability: parsed.stability ?? "static",
    filePath,
    content: normalizeText(body).trim(),
  };
}

function buildRegistry(): PromptDocument[] {
  const promptsDir = path.join(promptsRoot, "prompts");
  const allFiles = discoverFiles(promptsDir, (filePath) =>
    filePath.endsWith(".md") && !filePath.endsWith(".template") && !path.basename(filePath).startsWith("_template"));
  const list = allFiles.map((filePath) => parsePromptDocument(filePath, fs.readFileSync(filePath, "utf8")));
  const seen = new Map<string, string>();
  for (const p of list) {
    if (seen.has(p.id)) throw new Error(`Duplicate prompt id: ${p.id} | ${seen.get(p.id)} | ${p.filePath}`);
    seen.set(p.id, p.filePath);
  }
  return list;
}

function splitFrontmatter(raw: string, filePath: string): { head: string; body: string } {
  const n = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (!n.startsWith("---\n")) throw new Error(`Document must start with frontmatter: ${filePath}`);
  const end = n.indexOf("\n---\n", 4);
  if (end !== -1) return { head: n.slice(4, end).trim(), body: n.slice(end + 5).trim() };
  if (n.endsWith("\n---")) return { head: n.slice(4, n.length - 4).trim(), body: "" };
  throw new Error(`Frontmatter is not closed: ${filePath}`);
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

function normalizeText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
