#!/usr/bin/env tsx

import fs from "fs";
import path from "path";

interface SnailDefinition {
  description: string;
  runtime: string;
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
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

function validateConfiguration(
  snails: Record<string, SnailDefinition>,
  stages: Record<string, StageDefinition>,
  artifacts: Record<string, ArtifactDefinition>
): void {
  const errors: string[] = [];

  // Include "Boss Snail" as the persisted user-message sender alias, not as an agent prompt role.
  const validSnailNames = new Set([...Object.keys(snails), "Boss Snail"]);
  const validArtifactTypes = new Set(Object.keys(artifacts));

  // Validate stages.json references
  for (const [stageType, stageDef] of Object.entries(stages)) {
    // Check snails references
    for (const snailName of stageDef.snails) {
      if (!validSnailNames.has(snailName)) {
        errors.push(`stages.json: stage "${stageType}" references unknown snail "${snailName}"`);
      }
    }

    // Check formal_artifact_types references
    for (const artifactType of stageDef.formal_artifact_types) {
      if (!validArtifactTypes.has(artifactType)) {
        errors.push(`stages.json: stage "${stageType}" references unknown artifact type "${artifactType}" in formal_artifact_types`);
      }
    }

    // Check input references
    for (const artifactType of stageDef.input) {
      if (!validArtifactTypes.has(artifactType)) {
        errors.push(`stages.json: stage "${stageType}" references unknown artifact type "${artifactType}" in input`);
      }
    }

    // Check output.required_artifacts references
    for (const artifactType of stageDef.output.required_artifacts) {
      if (!validArtifactTypes.has(artifactType)) {
        errors.push(`stages.json: stage "${stageType}" references unknown artifact type "${artifactType}" in output.required_artifacts`);
      }
    }
  }

  // Validate snails.json references
  for (const [snailName, snailDef] of Object.entries(snails)) {
    // Check preferred_artifact_types references
    for (const artifactType of snailDef.preferred_artifact_types) {
      if (!validArtifactTypes.has(artifactType)) {
        errors.push(`snails.json: snail "${snailName}" references unknown artifact type "${artifactType}" in preferred_artifact_types`);
      }
    }
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

  // Load configuration files
  const snails = loadJson<Record<string, SnailDefinition>>(path.join(metaDir, "snails.json"));
  const stages = loadJson<Record<string, StageDefinition>>(path.join(metaDir, "stages.json"));
  const artifacts = loadJson<Record<string, ArtifactDefinition>>(path.join(metaDir, "artifacts.json"));

  // Validate configuration consistency
  validateConfiguration(snails, stages, artifacts);

  // Generate SnailName type (include "Boss Snail" only as the user-message sender alias)
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
