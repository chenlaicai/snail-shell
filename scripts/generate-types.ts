#!/usr/bin/env tsx

import fs from "fs";
import path from "path";

interface SnailDefinition {
  description: string;
  runtime: string;
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
  system_prompt: {
    identity: string;
    principles: string[];
    output_expectations: string[];
  };
}

interface StageDefinition {
  order: number;
  title: string;
  formal_artifact_types: string[];
  snails: string[];
  input: string[];
  output: {
    summary: string;
    required_artifacts: string[];
    artifact_requirements: string[];
  };
  acceptance_focus: string[];
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

function generateTypes(): void {
  const metaDir = path.join(process.cwd(), ".meta");
  const outputPath = path.join(process.cwd(), "src", "meta", "generated-types.ts");

  // Load configuration files
  const snails = loadJson<Record<string, SnailDefinition>>(path.join(metaDir, "snails.json"));
  const stages = loadJson<Record<string, StageDefinition>>(path.join(metaDir, "stages.json"));
  const artifacts = loadJson<Record<string, ArtifactDefinition>>(path.join(metaDir, "artifacts.json"));

  // Generate SnailName type (include "Boss Snail" which is created dynamically)
  const snailNames = [...Object.keys(snails), "Boss Snail"];
  const snailNameType = `export type SnailName = ${snailNames.map(name => `"${name}"`).join(" | ")};`;

  // Generate StageType type
  const stageTypes = Object.keys(stages);
  const stageTypeType = `export type StageType =\n  | ${stageTypes.map(type => `"${type}"`).join("\n  | ")};`;

  // Generate ArtifactType type
  const artifactTypes = Object.keys(artifacts);
  const artifactTypeType = `export type ArtifactType =\n  | ${artifactTypes.map(type => `"${type}"`).join("\n  | ")};`;

  // Generate file content
  const content = `// This file is auto-generated from .meta configuration files.
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
