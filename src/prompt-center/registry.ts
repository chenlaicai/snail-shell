import fs from "fs";
import path from "path";
import yaml from "yaml";
import type { AgentRuntime } from "../agent/interface";
import type { ConversationKind, ConversationOwnerType, SnailName, StageType } from "../shared/types";

// ──── When 条件（架子 step 和架子级别共用） ────

export interface PromptWhen {
  runtimes?: AgentRuntime[];
  stage_types?: StageType[];
  snails?: SnailName[];
  conversation_kinds?: ConversationKind[];
  owner_types?: ConversationOwnerType[];
  requires_repo?: boolean;
}

// ──── Skill 引用 ────

export interface PromptSkillReference {
  id: string;
  mode: "required" | "conditional";
  reason: string;
}

// ──── Prompt 文档（纯内容） ────

export interface PromptDocument {
  id: string;
  title: string;
  skill_references?: PromptSkillReference[];
  content: string;
  filePath: string;
}

// ──── 架子 Step ────

export interface FrameStep {
  prompts?: string[];
  inline?: string;
  when?: PromptWhen;
}

// ──── 架子文档 ────

export interface FrameDocument {
  id: string;
  title: string;
  type: "frame";
  when?: PromptWhen;
  steps: FrameStep[];
  filePath: string;
}

// ──── 匹配上下文 ────

export interface FrameMatchContext {
  runtime?: AgentRuntime;
  stageType?: StageType;
  snailName?: SnailName;
  conversationKind?: ConversationKind;
  ownerType?: ConversationOwnerType;
  repoRelated?: boolean;
}

// ──── 注册表 ────

const promptsRoot = path.join(process.cwd(), ".meta", "prompts");
const { frames, prompts } = buildRegistries();

// ──── 公共 API ────

export function listFrames(): FrameDocument[] {
  return frames;
}

export function getFrame(id: string): FrameDocument {
  const frame = frames.find((item) => item.id === id);
  if (!frame) {
    throw new Error(`Frame not found: ${id}`);
  }
  return frame;
}

export function getPrompt(id: string): PromptDocument {
  const prompt = prompts.find((item) => item.id === id);
  if (!prompt) {
    throw new Error(`Prompt not found: ${id}`);
  }
  return prompt;
}

export function listPrompts(): PromptDocument[] {
  return prompts;
}

export function selectFrame(context: FrameMatchContext): FrameDocument | undefined {
  /**
   * 按条件具体度降序排列：when 条件越多的架子越靠前，无 when 的架子（默认兜底）排最后。
   * 这样 F-02 (when: owner_types=[knowledge_governance]) 会在 F-01 (无 when) 之前被选中。
   */
  const sorted = [...frames].sort((a, b) => countWhenConditions(b.when) - countWhenConditions(a.when));
  return sorted.find((frame) => matchesWhen(frame.when, context));
}

function countWhenConditions(when: PromptWhen | undefined): number {
  if (!when) return 0;
  return [
    when.runtimes?.length,
    when.stage_types?.length,
    when.snails?.length,
    when.conversation_kinds?.length,
    when.owner_types?.length,
    when.requires_repo,
  ].filter(Boolean).length;
}

export function matchesWhen(when: PromptWhen | undefined, context: FrameMatchContext): boolean {
  if (!when) {
    return true;
  }
  const runtimeMatch = matchesList(when.runtimes, context.runtime);
  const stageMatch = matchesList(when.stage_types, context.stageType);
  const snailMatch = matchesList(when.snails, context.snailName);
  const conversationMatch = matchesList(when.conversation_kinds, context.conversationKind);
  const ownerTypeMatch = matchesList(when.owner_types, context.ownerType);
  const repoMatch = !when.requires_repo || context.repoRelated === true;
  return runtimeMatch && stageMatch && snailMatch && conversationMatch && ownerTypeMatch && repoMatch;
}

export function renderPromptTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => variables[key] ?? "");
}

export function renderPromptContent(prompt: PromptDocument, variables: Record<string, string>): string {
  return renderPromptTemplate(prompt.content, variables);
}

// ──── 解析 ────

interface FrameFrontmatter {
  id: string;
  title: string;
  type: "frame";
  when?: PromptWhen;
  steps: FrameStep[];
}

interface PromptFrontmatter {
  id: string;
  title: string;
  skill_references?: PromptSkillReference[];
}

function parseFrameDocument(filePath: string, raw: string): FrameDocument {
  const { head } = splitFrontmatter(raw, filePath);
  const parsed = yaml.parse(head) as FrameFrontmatter;
  if (parsed.type !== "frame") {
    throw new Error(`Expected type "frame" in ${filePath}, got "${parsed.type}"`);
  }
  return { ...parsed, filePath };
}

function parsePromptDocument(filePath: string, raw: string): PromptDocument {
  const { head, body } = splitFrontmatter(raw, filePath);
  const parsed = yaml.parse(head) as PromptFrontmatter;
  return { ...parsed, filePath, content: normalizeText(body).trim() };
}

// ──── 注册表构建 ────

function buildRegistries(): { frames: FrameDocument[]; prompts: PromptDocument[] } {
  const allFiles = discoverFiles(promptsRoot, (filePath) => filePath.endsWith(".md") && !filePath.endsWith(".template") && !path.basename(filePath).startsWith("_template"));

  const frameFiles = allFiles.filter((f) => f.includes(`${path.sep}frames${path.sep}`));
  const promptFiles = allFiles.filter((f) => !f.includes(`${path.sep}frames${path.sep}`));

  const frameList = frameFiles.map((filePath) => parseFrameDocument(filePath, fs.readFileSync(filePath, "utf8")));
  const promptList = promptFiles.map((filePath) => parsePromptDocument(filePath, fs.readFileSync(filePath, "utf8")));

  validateFrameIds(frameList);
  validatePromptIds(promptList);
  validateFrameStepReferences(frameList, promptList);

  return { frames: frameList, prompts: promptList };
}

function validateFrameIds(frames: FrameDocument[]): void {
  const seen = new Map<string, string>();
  for (const frame of frames) {
    const existing = seen.get(frame.id);
    if (existing) {
      throw new Error(`Duplicate frame id detected: ${frame.id} | ${existing} | ${frame.filePath}`);
    }
    seen.set(frame.id, frame.filePath);
  }
}

function validatePromptIds(promptList: PromptDocument[]): void {
  const seen = new Map<string, string>();
  for (const prompt of promptList) {
    const existing = seen.get(prompt.id);
    if (existing) {
      throw new Error(`Duplicate prompt id detected: ${prompt.id} | ${existing} | ${prompt.filePath}`);
    }
    seen.set(prompt.id, prompt.filePath);
  }
}

function validateFrameStepReferences(frameList: FrameDocument[], promptList: PromptDocument[]): void {
  const promptIds = new Set(promptList.map((p) => p.id));
  for (const frame of frameList) {
    for (const step of frame.steps) {
      if (!step.prompts) continue;
      for (const promptId of step.prompts) {
        if (!promptIds.has(promptId)) {
          throw new Error(`Frame ${frame.id} references unknown prompt: ${promptId} | ${frame.filePath}`);
        }
      }
    }
  }
}

// ──── 工具函数 ────

function matchesList<T>(expected: T[] | undefined, actual: T | undefined): boolean {
  return !expected?.length || (!!actual && expected.includes(actual));
}

function splitFrontmatter(raw: string, filePath: string): { head: string; body: string } {
  const normalized = normalizeText(raw).trim();
  if (!normalized.startsWith("---\n")) {
    throw new Error(`Document must start with frontmatter: ${filePath}`);
  }
  // Look for \n---\n (with body after) or \n--- at end of string (no body)
  const secondDelimiter = normalized.indexOf("\n---\n", 4);
  if (secondDelimiter !== -1) {
    return {
      head: normalized.slice(4, secondDelimiter).trim(),
      body: normalized.slice(secondDelimiter + 5).trim(),
    };
  }
  if (normalized.endsWith("\n---")) {
    const endPos = normalized.length - 4;
    return {
      head: normalized.slice(4, endPos).trim(),
      body: "",
    };
  }
  throw new Error(`Frontmatter is not closed: ${filePath}`);
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
