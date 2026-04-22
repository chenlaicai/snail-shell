import fs from "fs";
import path from "path";
import type { ArtifactStorageType, ArtifactType, SnailName, StageType } from "../persistence/store";

export interface StageDefinition {
  order: number;
  title: string;
  formal_artifact_types: ArtifactType[];
  snails: SnailName[];
  input: ArtifactType[];
  output: {
    summary: string;
    required_artifacts: ArtifactType[];
    artifact_requirements: string[];
  };
  acceptance_focus: string[];
}

const stagesPath = path.join(process.cwd(), ".meta", "stages.json");
const artifactsPath = path.join(process.cwd(), ".meta", "artifacts.json");

export interface ArtifactDefinition {
  title: string;
  description: string;
  storage_type: ArtifactStorageType;
  formal: boolean;
}

export { listRegulations, matchRegulations, getRegulationExpandScriptPath, expandRegulationById } from "./regulations";
export type { RegulationContext, RegulationIndexEntry, RegulationManifestEntry, RegulationMatchRule } from "./regulations";

export function loadStageDefinitions(): Record<StageType, StageDefinition> {
  const raw = fs.readFileSync(stagesPath, "utf8");
  return JSON.parse(raw) as Record<StageType, StageDefinition>;
}

export function loadArtifactDefinitions(): Record<ArtifactType, ArtifactDefinition> {
  const raw = fs.readFileSync(artifactsPath, "utf8");
  return JSON.parse(raw) as Record<ArtifactType, ArtifactDefinition>;
}
