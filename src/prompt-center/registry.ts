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
  /** 提示词稳定性：static 规则整场对话不变，dynamic 上下文可能随调用变化，用于 systemPrompt/systemReminder 拆分渲染 */
  stability: "static" | "dynamic";
  skill_references?: PromptSkillReference[];
  content: string;
  filePath: string;
}

// ──── 架子文档（模板） ────

export interface FrameDocument {
  id: string;
  title: string;
  type: "frame";
  content: string;
  filePath: string;
}

// ──── 匹配上下文（用于模板 {{#when:...}} 条件段落） ────

export interface FrameMatchContext {
  runtime?: AgentRuntime;
  stageType?: StageType;
  roleName?: RoleName;
  conversationKind?: ConversationKind;
  ownerType?: ConversationOwnerType;
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

// ──── 模板渲染管线 ────

/**
 * 渲染架子模板为最终系统提示词文本。
 *
 * 渲染顺序：
 * 1. 展开 {{prompt:ID}} 引用为提示词内容（含 skill_references）
 * 2. 评估 {{#when:...}}...{{/when}} 条件块，移除不满足条件的段落
 * 3. 评估 {{#if:var}}...{{/if}} 变量条件块，移除变量为空的段落
 * 4. 替换所有 {{variable}} 占位符
 * 5. 清理多余空行
 */
export function renderFrame(frame: FrameDocument, context: FrameMatchContext, variables: Record<string, string>): string {
  let content = frame.content;

  // Step 1: 展开 prompt 引用
  content = expandPromptReferences(content);

  // Step 2: 条件段落过滤
  content = evaluateWhenBlocks(content, context);

  // Step 3: 变量条件过滤
  content = evaluateIfBlocks(content, variables);

  // Step 4: 变量替换
  content = renderPromptTemplate(content, variables);

  // Step 5: 清理多余空行
  content = cleanupBlankLines(content);

  return content;
}

/**
 * 拆分渲染 frame：分别输出 systemPrompt（静态规则）和 systemReminder（动态上下文）。
 *
 * 两路独立走渲染管线，各自只展开对应 stability 的 prompt 引用。
 * 条件块（{{#when}}/{{#if}}）在两边都做评估以保持一致的段落可见性；
 * 变量替换也两边都做，因为静态 prompt 也可能引用动态变量（如 role name）。
 */
export function renderFrameSplit(
  frame: FrameDocument,
  context: FrameMatchContext,
  variables: Record<string, string>,
): { systemPrompt: string; systemReminder: string } {
  const stabilityMap = new Map(prompts.map((p) => [p.id, p.stability]));

  const systemPrompt = renderStabilityPass(frame.content, { stabilityMap, target: "static" }, context, variables);
  const systemReminder = renderStabilityPass(frame.content, { stabilityMap, target: "dynamic" }, context, variables);

  return { systemPrompt, systemReminder };
}

function renderStabilityPass(
  frameContent: string,
  filter: { stabilityMap: Map<string, "static" | "dynamic">; target: "static" | "dynamic" },
  context: FrameMatchContext,
  variables: Record<string, string>,
): string {
  let content = frameContent;

  // Step 1: 只展开 target stability 的 prompt；其他替换为空
  content = expandPromptReferencesFiltered(content, filter.stabilityMap, filter.target);

  // Step 2-5: 与 renderFrame 相同的后处理管线
  content = evaluateWhenBlocks(content, context);
  content = evaluateIfBlocks(content, variables);
  content = renderPromptTemplate(content, variables);
  // 先折叠多余空行再清理空段落——防止 prompt 过滤产生的多空行导致 cleanupEmptySections 漏过
  content = cleanupBlankLines(content);
  content = cleanupEmptySections(content);
  content = cleanupBlankLines(content);

  return content;
}

/**
 * 展开 prompt 引用，但只展开匹配 target stability 的 prompt。
 * 不匹配的 prompt 引用替换为空字符串。
 */
function expandPromptReferencesFiltered(
  content: string,
  stabilityMap: Map<string, "static" | "dynamic">,
  target: "static" | "dynamic",
): string {
  return content.replace(/\{\{prompt:([A-Z]-\d+)\}\}/g, (_, promptId: string) => {
    const stability = stabilityMap.get(promptId);
    if (stability !== target) return "";
    const prompt = prompts.find((p) => p.id === promptId);
    if (!prompt) return "";
    const rendered = prompt.content.replace(/^## [^\n]*\n+/, "");
    const skillSection = prompt.skill_references?.length
      ? "\n\n" + buildSkillReferenceSection(prompt.skill_references)
      : "";
    return rendered + skillSection;
  });
}

/**
 * 清理因为 prompt 过滤而变成空的段落。
 * 基于段落拆分而非正则：将内容按 ## heading 切分，仅保留正文非空的段落。
 */
function cleanupEmptySections(content: string): string {
  const sections = content.split(/(?=^## )/gm);
  return sections
    .filter((section) => {
      // 保留不以 ## 开头的非标题块（如前置文本）
      if (!section.startsWith("## ")) {
        return section.trim().length > 0;
      }
      // 标题块：去掉第一行标题后，检查剩余正文是否非空
      const bodyStart = section.indexOf("\n");
      if (bodyStart === -1) return false; // 仅有标题行，无正文
      return section.slice(bodyStart).trim().length > 0;
    })
    .join("");
}

/**
 * 展开 {{prompt:ID}} 引用。
 * 查找 PromptDocument，去掉顶层标题（由架子负责标题），追加 skill_references 段。
 */
function expandPromptReferences(content: string): string {
  return content.replace(/\{\{prompt:([A-Z]-\d+)\}\}/g, (_, promptId: string) => {
    const prompt = prompts.find((p) => p.id === promptId);
    if (!prompt) {
      return "";
    }
    // 去掉 prompt 内容的第一个 ## 标题行（架子负责标题）
    const rendered = prompt.content.replace(/^## [^\n]*\n+/, "");
    const skillSection = prompt.skill_references?.length
      ? "\n\n" + buildSkillReferenceSection(prompt.skill_references)
      : "";
    return rendered + skillSection;
  });
}

/**
 * 评估 {{#when:field=value1,value2;field2=value3}}...{{/when}} 条件块。
 * 条件不满足则移除整段（包括段落内的 prompt 引用和变量）。
 */
function evaluateWhenBlocks(content: string, context: FrameMatchContext): string {
  return content.replace(/\{\{#when:([^}]+)\}\}([\s\S]*?)\{\{\/when\}\}/g, (_, conditionStr: string, body: string) => {
    const conditions = parseWhenConditions(conditionStr);
    if (matchesWhenConditions(conditions, context)) {
      return body;
    }
    return "";
  });
}

/**
 * 评估 {{#if:variable_name}}...{{/if}} 变量条件块。
 * 变量为空字符串或未定义则移除整段。
 */
function evaluateIfBlocks(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{#if:([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName: string, body: string) => {
    const value = variables[varName];
    if (value && value.trim()) {
      return body;
    }
    return "";
  });
}

// ──── 模板渲染工具 ────

export function renderPromptTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => variables[key] ?? "");
}

export function renderPromptContent(prompt: PromptDocument, variables: Record<string, string>): string {
  return renderPromptTemplate(prompt.content, variables);
}

export function renderPromptForInjection(prompt: PromptDocument, variables: Record<string, string>): string {
  let body = renderPromptTemplate(prompt.content, variables).replace(/^## [^\n]*\n+/, "");
  if (prompt.skill_references?.length) {
    body += "\n\n" + buildSkillReferenceSection(prompt.skill_references);
  }
  return body;
}

function buildSkillReferenceSection(skills: PromptSkillReference[]): string {
  const lines = ["## Skill References", "", "- 以下 skill 是独立能力包；系统提示词只负责引用它们，不内嵌其完整正文。"];
  for (const item of skills) {
    const skill = getSkillFromRegistry(item.id);
    lines.push(`- ${item.mode === "required" ? "必须使用" : "按需使用"} skill: \`${skill.name}\``);
    lines.push(`  - 用途: ${skill.description}`);
    lines.push(`  - 路径: ${path.relative(process.cwd(), skill.filePath)}`);
    lines.push(`  - 规则: ${item.reason}`);
  }
  return lines.join("\n");
}

function getSkillFromRegistry(skillId: string): { name: string; description: string; filePath: string } {
  // 使用动态导入避免循环依赖；在模块加载时 skill-center 已初始化
  const { getSkill } = require("../skill-center");
  return getSkill(skillId);
}

function cleanupBlankLines(content: string): string {
  return content
    .split("\n")
    .reduce<string[]>((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        // 保留单个空行作为段落分隔，折叠连续空行
        if (acc.length > 0 && acc[acc.length - 1] !== "") {
          acc.push("");
        }
      } else {
        acc.push(line);
      }
      return acc;
    }, [])
    .join("\n")
    .trim();
}

// ──── 条件解析与匹配 ────

interface WhenCondition {
  field: string;
  values: string[];
}

function parseWhenConditions(conditionStr: string): WhenCondition[] {
  return conditionStr.split(";").map((segment) => {
    const [field, valuesStr] = segment.split("=");
    return {
      field: field.trim(),
      values: valuesStr.split(",").map((v) => v.trim()),
    };
  });
}

const WHEN_FIELD_MAP: Record<string, (ctx: FrameMatchContext) => string | undefined> = {
  runtimes: (ctx) => ctx.runtime,
  stage_types: (ctx) => ctx.stageType,
  roles: (ctx) => ctx.roleName,
  conversation_kinds: (ctx) => ctx.conversationKind,
  owner_types: (ctx) => ctx.ownerType,
};

function matchesWhenConditions(conditions: WhenCondition[], context: FrameMatchContext): boolean {
  return conditions.every((cond) => {
    const getter = WHEN_FIELD_MAP[cond.field];
    if (!getter) return true;
    const value = getter(context);
    return !!value && cond.values.includes(value);
  });
}

// ──── 项目级 overlay ────

export function loadProjectPrompts(projectRoot: string): PromptDocument[] {
  const overlayRoot = path.join(projectRoot, ".snail", "prompts");
  if (!fs.existsSync(overlayRoot)) return [];
  const files = discoverFiles(overlayRoot, (f) => f.endsWith(".md") && !f.endsWith(".template") && !path.basename(f).startsWith("_template"));
  return files.map((filePath) => parsePromptDocument(filePath, fs.readFileSync(filePath, "utf8")));
}

export function mergePrompts(globalPrompts: PromptDocument[], projectPrompts: PromptDocument[]): PromptDocument[] {
  const map = new Map<string, PromptDocument>();
  for (const p of globalPrompts) map.set(p.id, p);
  for (const p of projectPrompts) map.set(p.id, p);
  return Array.from(map.values());
}

// ──── 解析 ────

interface FrameFrontmatter {
  id: string;
  title: string;
  type: "frame";
}

interface PromptFrontmatter {
  id: string;
  title: string;
  stability?: "static" | "dynamic";
  skill_references?: PromptSkillReference[];
}

function parseFrameDocument(filePath: string, raw: string): FrameDocument {
  const { head, body } = splitFrontmatter(raw, filePath);
  const parsed = yaml.parse(head) as FrameFrontmatter;
  if (parsed.type !== "frame") {
    throw new Error(`Expected type "frame" in ${filePath}, got "${parsed.type}"`);
  }
  return { ...parsed, filePath, content: normalizeText(body).trim() };
}

function parsePromptDocument(filePath: string, raw: string): PromptDocument {
  const { head, body } = splitFrontmatter(raw, filePath);
  const parsed = yaml.parse(head) as PromptFrontmatter;
  return { ...parsed, stability: parsed.stability ?? "static", filePath, content: normalizeText(body).trim() };
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
  validateFramePromptReferences(frameList, promptList);

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

function validateFramePromptReferences(frameList: FrameDocument[], promptList: PromptDocument[]): void {
  const promptIds = new Set(promptList.map((p) => p.id));
  for (const frame of frameList) {
    const refs = frame.content.match(/\{\{prompt:([A-Z]-\d+)\}\}/g) ?? [];
    for (const ref of refs) {
      const id = ref.match(/{{prompt:([A-Z]-\d+)}/)?.[1];
      if (id && !promptIds.has(id)) {
        throw new Error(`Frame ${frame.id} references unknown prompt: ${id} | ${frame.filePath}`);
      }
    }
  }
}

// ──── 工具函数 ────

function splitFrontmatter(raw: string, filePath: string): { head: string; body: string } {
  const normalized = normalizeText(raw).trim();
  if (!normalized.startsWith("---\n")) {
    throw new Error(`Document must start with frontmatter: ${filePath}`);
  }
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
