import fs from "fs";
import path from "path";
import type { AgentRuntime } from "../agent/interface";
import type { ConversationKind, SnailName, StageType } from "../shared/types";

export interface PromptWhen {
  runtimes?: AgentRuntime[];
  stage_types?: StageType[];
  snails?: SnailName[];
  conversation_kinds?: ConversationKind[];
  requires_repo?: boolean;
}

export interface PromptSkillReference {
  id: string;
  mode: "required" | "conditional";
  reason: string;
}

export interface PromptDocument {
  id: string;
  title: string;
  target?: string;
  order?: number;
  when?: PromptWhen;
  semantic_layer?: "ai_base" | "work_context" | "stage_role_playbook" | "task_runtime";
  inject_matched_prompts?: boolean;
  skill_references?: PromptSkillReference[];
  filePath: string;
  content: string;
}

export interface PromptMatchContext {
  target: string;
  runtime?: AgentRuntime;
  stageType?: StageType;
  snailName?: SnailName;
  conversationKind?: ConversationKind;
  repoRelated?: boolean;
}

const promptsRoot = path.join(process.cwd(), ".meta", "prompts");
const promptRegistry = buildPromptRegistry();

export function listPromptDocuments(): PromptDocument[] {
  return promptRegistry;
}

export function getPromptDocument(id: string): PromptDocument {
  const prompt = promptRegistry.find((item) => item.id === id);
  if (!prompt) {
    throw new Error(`Prompt document not found: ${id}`);
  }
  return prompt;
}

export function listPromptDocumentsForTarget(context: PromptMatchContext): PromptDocument[] {
  return promptRegistry
    .filter((item) => item.target === context.target)
    .filter((item) => matchesPrompt(context, item))
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

export function getTaskPrompt(target: string): string {
  const prompts = promptRegistry.filter((item) => item.target === target);
  if (prompts.length === 0) {
    throw new Error(`Task prompt not found for target: ${target}`);
  }
  if (prompts.length > 1) {
    throw new Error(`Task prompt target must be unique: ${target} | ${prompts.map((item) => item.filePath).join(" | ")}`);
  }
  return prompts[0]?.content.trim() ?? "";
}

export function renderPromptTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => variables[key] ?? "");
}

export function renderPromptContent(prompt: PromptDocument, variables: Record<string, string>): string {
  return renderPromptTemplate(prompt.content, variables);
}

function matchesPrompt(context: PromptMatchContext, prompt: PromptDocument): boolean {
  if (!prompt.when) {
    return true;
  }

  const runtimeMatch = matchesList(prompt.when.runtimes, context.runtime);
  const stageMatch = matchesList(prompt.when.stage_types, context.stageType);
  const snailMatch = matchesList(prompt.when.snails, context.snailName);
  const conversationMatch = matchesList(prompt.when.conversation_kinds, context.conversationKind);
  const repoMatch = !prompt.when.requires_repo || context.repoRelated === true;
  return runtimeMatch && stageMatch && snailMatch && conversationMatch && repoMatch;
}

function matchesList<T>(expected: T[] | undefined, actual: T | undefined): boolean {
  return !expected?.length || (!!actual && expected.includes(actual));
}

function parsePromptDocument(filePath: string, raw: string): PromptDocument {
  const { head, body } = splitFrontmatter(raw, filePath);
  const parsed = JSON.parse(head) as Omit<PromptDocument, "filePath" | "content">;
  return { ...parsed, filePath, content: normalizeText(body).trim() };
}

function buildPromptRegistry(): PromptDocument[] {
  const prompts = discoverFiles(promptsRoot, (filePath) => filePath.endsWith(".md") && !filePath.endsWith(".template"))
    .map((filePath) => parsePromptDocument(filePath, fs.readFileSync(filePath, "utf8")));
  validatePromptIds(prompts);
  validatePromptTargets(prompts);
  validateUniqueTaskTargets(prompts);
  return prompts;
}

function validatePromptIds(prompts: PromptDocument[]): void {
  const seen = new Map<string, string>();
  for (const prompt of prompts) {
    const existing = seen.get(prompt.id);
    if (existing) {
      throw new Error(`Duplicate prompt id detected: ${prompt.id} | ${existing} | ${prompt.filePath}`);
    }
    seen.set(prompt.id, prompt.filePath);
  }
}

function validateUniqueTaskTargets(prompts: PromptDocument[]): void {
  const seen = new Map<string, string>();
  for (const prompt of prompts.filter((item) => item.target?.startsWith("task."))) {
    const target = prompt.target as string;
    const existing = seen.get(target);
    if (existing) {
      throw new Error(`Task prompt target must be unique: ${target} | ${existing} | ${prompt.filePath}`);
    }
    seen.set(target, prompt.filePath);
  }
}

function validatePromptTargets(prompts: PromptDocument[]): void {
  for (const prompt of prompts) {
    /**
     * 本轮提示词重构要求旧的 global 注入桥不再作为兼容层存在。
     * 这里在 registry 层拦截旧 target 和桥接 metadata，避免后续新增 prompt 时
     * 绕过语义 target 装配，重新制造“基础契约、上下文事实、阶段行动”混用的问题。
     */
    if (prompt.target === "conversation.system.global") {
      throw new Error(`Deprecated prompt target conversation.system.global is not allowed: ${prompt.filePath}`);
    }
    if (prompt.inject_matched_prompts) {
      throw new Error(`Prompt injection bridge is deprecated; compose semantic targets in the builder instead: ${prompt.filePath}`);
    }
  }
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
