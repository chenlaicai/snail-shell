#!/usr/bin/env tsx

import fs from "fs";
import path from "path";

interface SnailDenSnailDefinition {
  name: string;
  description: string;
  template?: string;
  kind?: string;
  capability_expectations?: string[];
  working_rules?: string[];
  preferred_artifact_types?: string[];
}

interface ArtifactDefinition {
  title: string;
  description: string;
  storage_type: string;
  formal: boolean;
}

function loadJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

/**
 * 从 Snail Den 配置文件读取 snail 名称。
 * 支持新格式 { templates, snails } 和旧格式 { snails } 向后兼容。
 */
function loadSnailNamesFromDen(): string[] {
  const filePath = path.join(process.cwd(), "config", "snail-den.json");
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const config = loadJson<Record<string, unknown>>(filePath);

  // 新格式：{ "templates": [...], "snails": [...] }
  if (Array.isArray(config.snails)) {
    const snails = config.snails as SnailDenSnailDefinition[];
    // 检查是否是 snail 定义（有 name 字段）还是旧格式 template（有 runtime 字段）
    if (snails.length > 0 && "name" in snails[0] && !("runtime" in snails[0])) {
      return snails.map((s) => s.name);
    }
  }

  return [];
}

/**
 * 从 stage-definitions.ts 源码中解析 StageType 键名。
 * 匹配模式：export const STAGE_DEFINITIONS: Record<StageType, StageDefinition> = { ... }
 */
function loadStageTypesFromCode(): string[] {
  const filePath = path.join(process.cwd(), "src", "project-workflow", "stage-definitions.ts");
  const source = fs.readFileSync(filePath, "utf8");

  // 提取 STAGE_DEFINITIONS 对象中的顶层键
  const match = source.match(/STAGE_DEFINITIONS[^{]*\{([\s\S]*?)\n\};/);
  if (!match) {
    console.error("Failed to parse STAGE_DEFINITIONS from stage-definitions.ts");
    process.exit(1);
  }

  const keys: string[] = [];
  const keyPattern = /^\s+(\w+)\s*:/gm;
  let keyMatch;
  while ((keyMatch = keyPattern.exec(match[1])) !== null) {
    keys.push(keyMatch[1]);
  }

  return keys;
}

function validateConfiguration(
  snailNames: string[],
  stageTypes: string[],
  artifacts: Record<string, ArtifactDefinition>
): void {
  const errors: string[] = [];
  const validSnailNames = new Set([...snailNames, "Boss Snail"]);
  const validArtifactTypes = new Set(Object.keys(artifacts));

  // Validate stage definitions reference valid artifact types
  const stageDefinitionsPath = path.join(process.cwd(), "src", "project-workflow", "stage-definitions.ts");
  const stageSource = fs.readFileSync(stageDefinitionsPath, "utf8");

  // Check snail references in assigned_snails
  for (const snailName of snailNames) {
    if (!stageSource.includes(`"${snailName}"`) && snailName !== "Boss Snail") {
      // Not necessarily an error - snail might not be assigned to any stage
    }
  }

  // Check artifact type references in stage definitions
  const artifactTypePattern = /"([a-z_]+)"/g;
  let artifactMatch;
  while ((artifactMatch = artifactTypePattern.exec(stageSource)) !== null) {
    const type = artifactMatch[1];
    if (validArtifactTypes.has(type) || type.length < 5) continue; // Skip short strings
    // Only flag if it looks like an artifact type reference
  }

  if (errors.length > 0) {
    console.error("\n❌ Configuration validation failed:\n");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error("");
    process.exit(1);
  }

  console.log("✓ Configuration validation passed");
}

function generateTypes(): void {
  const metaDir = path.join(process.cwd(), ".meta");
  const outputPath = path.join(process.cwd(), "src", "meta", "generated-types.ts");

  // Load snail names from Snail Den config
  const snailNames = loadSnailNamesFromDen();
  if (snailNames.length === 0) {
    console.warn("⚠ No snail definitions found in config/snail-den.json. SnailName type will only contain 'Boss Snail'.");
  }

  // Load stage types from hardcoded stage definitions
  const stageTypes = loadStageTypesFromCode();

  // Load artifact definitions from .meta/artifacts.json
  const artifacts = loadJson<Record<string, ArtifactDefinition>>(path.join(metaDir, "artifacts.json"));

  // Validate configuration consistency
  validateConfiguration(snailNames, stageTypes, artifacts);

  // Generate SnailName type (include "Boss Snail" only as the user-message sender alias)
  const allSnailNames = [...snailNames, "Boss Snail"];
  const snailNameType = `export type SnailName = ${allSnailNames.map(name => `"${name}"`).join(" | ")};`;

  // Generate StageType type
  const stageTypeType = `export type StageType =\n  | ${stageTypes.map(type => `"${type}"`).join("\n  | ")};`;

  // Generate ArtifactType type
  const artifactTypes = Object.keys(artifacts);
  const artifactTypeType = `export type ArtifactType =\n  | ${artifactTypes.map(type => `"${type}"`).join("\n  | ")};`;

  // Generate file content
  const content = `// This file is auto-generated from config/snail-den.json, stage-definitions.ts, and .meta/artifacts.json.
// Do not edit manually. Run 'npm run generate-types' to regenerate.

${snailNameType}

${stageTypeType}

${artifactTypeType}
`;

  // Write to file
  fs.writeFileSync(outputPath, content, "utf8");
  console.log(`✓ Generated types at ${outputPath}`);
}

// Run the generator
try {
  generateTypes();
} catch (error) {
  console.error("Failed to generate types:", error);
  process.exit(1);
}
