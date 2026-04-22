import fs from "fs";
import path from "path";
import type { ConversationKind, SnailName, StageType } from "../persistence/store";

export interface RegulationMatchRule {
  snails?: SnailName[];
  stage_types?: StageType[];
  conversation_kinds?: ConversationKind[];
  requires_repo?: boolean;
}

export interface RegulationManifestEntry {
  id: string;
  title: string;
  path: string;
  summary: string;
  match?: RegulationMatchRule;
}

export interface RegulationIndexEntry extends RegulationManifestEntry {
  policy: string[];
}

export interface RegulationContext {
  activeSnailName?: SnailName;
  stageType: StageType;
  conversationKind: ConversationKind;
  repoRelated: boolean;
}

interface RegulationMachineHead {
  id: string;
  title: string;
  match?: RegulationMatchRule;
}

const regulationsDir = path.join(process.cwd(), ".meta", "regulations");
const regulationExpandScriptPath = path.join(process.cwd(), ".meta", "scripts", "regulation-expand");
const regulationFiles = discoverRegulationFiles(regulationsDir);
const parsedRegulationDocuments = regulationFiles.map((filePath) => ({
  filePath,
  parsed: parseRegulationDocument(fs.readFileSync(filePath, "utf8"), filePath),
}));
validateRegulationIds(parsedRegulationDocuments);
const regulationIndex = parsedRegulationDocuments.map(({ filePath, parsed }) => buildRegulationIndexEntry(filePath, parsed));

export function listRegulations(): RegulationIndexEntry[] {
  return regulationIndex;
}

export function getRegulationExpandScriptPath(): string {
  return regulationExpandScriptPath;
}

export function matchRegulations(context: RegulationContext, regulations: RegulationIndexEntry[]): RegulationIndexEntry[] {
  return regulations.filter((regulation) => matchesRule(context, regulation.match));
}

export function expandRegulationById(id: string): { filePath: string; content: string } {
  const document = parsedRegulationDocuments.find((candidate) => candidate.parsed.machineHead.id === id);

  if (!document) {
    throw new Error(`Regulation not found: ${id}`);
  }

  return {
    filePath: document.filePath,
    content: normalizeRegulationText(fs.readFileSync(document.filePath, "utf8")).trim(),
  };
}

function discoverRegulationFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  return walk(rootDir)
    .filter((filePath) => filePath.endsWith(".md"))
    .filter((filePath) => !filePath.endsWith(".template"))
    .sort();
}

function walk(rootDir: string): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function buildRegulationIndexEntry(
  filePath: string,
  parsed: { machineHead: RegulationMachineHead; sections: Map<string, string[]> }
): RegulationIndexEntry {
  const policy = pickBulletSection(parsed.sections, "Policy");
  return {
    id: parsed.machineHead.id,
    title: parsed.machineHead.title,
    summary: summarizePolicy(policy),
    match: parsed.machineHead.match,
    path: path.relative(regulationsDir, filePath),
    policy,
  };
}

function summarizePolicy(policy: string[]): string {
  return policy[0] ?? "当前 regulation 未提供 policy 摘要";
}

function validateRegulationIds(documents: Array<{
  filePath: string;
  parsed: { machineHead: RegulationMachineHead };
}>): void {
  const seen = new Map<string, string>();

  for (const document of documents) {
    const id = document.parsed.machineHead.id;
    if (!/^RG\d{3}$/.test(id)) {
      throw new Error(`Regulation id must use RG + three digits format: ${id} | ${document.filePath}`);
    }

    const existingPath = seen.get(id);
    if (existingPath) {
      throw new Error(`Duplicate regulation id detected: ${id} | ${existingPath} | ${document.filePath}`);
    }

    seen.set(id, document.filePath);
  }
}

function matchesRule(context: RegulationContext, rule?: RegulationMatchRule): boolean {
  if (!rule) {
    return true;
  }

  return [
    matchesRepoRule(context, rule),
    matchesSnailRule(context, rule),
    matchesStageRule(context, rule),
    matchesConversationRule(context, rule),
  ].every(Boolean);
}

function parseRegulationDocument(raw: string, filePath: string): { machineHead: RegulationMachineHead; sections: Map<string, string[]> } {
  const trimmed = normalizeRegulationText(raw).trim();
  if (!trimmed.startsWith("---\n")) {
    throw new Error(`Regulation document must start with machine head frontmatter: ${filePath}`);
  }

  const secondDelimiter = trimmed.indexOf("\n---\n", 4);
  if (secondDelimiter === -1) {
    throw new Error(`Regulation document frontmatter is not closed: ${filePath}`);
  }

  const machineHeadRaw = trimmed.slice(4, secondDelimiter).trim();
  const body = trimmed.slice(secondDelimiter + 5).trim();
  let machineHead: RegulationMachineHead;
  try {
    machineHead = JSON.parse(machineHeadRaw) as RegulationMachineHead;
  } catch (error) {
    throw new Error(`Failed to parse regulation machine head JSON: ${filePath} | ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  return {
    machineHead,
    sections: parseSections(body),
  };
}

function normalizeRegulationText(raw: string): string {
  const withoutBom = raw.replace(/^\uFEFF/, "");
  return withoutBom.replace(/\r\n/g, "\n");
}

function parseSections(body: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const line of body.split("\n")) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1]?.trim() ?? "";
      sections.set(current, []);
      continue;
    }

    if (!current) {
      continue;
    }

    sections.get(current)?.push(line);
  }
  return sections;
}

function pickBulletSection(sections: Map<string, string[]>, name: string): string[] {
  return (sections.get(name) ?? [])
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function matchesRepoRule(context: RegulationContext, rule: RegulationMatchRule): boolean {
  return !rule.requires_repo || context.repoRelated;
}

function matchesSnailRule(context: RegulationContext, rule: RegulationMatchRule): boolean {
  return !rule.snails?.length || (!!context.activeSnailName && rule.snails.includes(context.activeSnailName));
}

function matchesStageRule(context: RegulationContext, rule: RegulationMatchRule): boolean {
  return !rule.stage_types?.length || rule.stage_types.includes(context.stageType);
}

function matchesConversationRule(context: RegulationContext, rule: RegulationMatchRule): boolean {
  return !rule.conversation_kinds?.length || rule.conversation_kinds.includes(context.conversationKind);
}
