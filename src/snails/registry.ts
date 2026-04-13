import fs from "fs";
import path from "path";
import type { AgentRuntime } from "../agent/interface";
import type { SnailName, StageType } from "../persistence/store";
import { loadStageDefinitions } from "../meta";

export interface SnailPromptDefinition {
  identity: string;
  principles: string[];
  output_expectations: string[];
}

export interface SnailDefinition {
  name: SnailName;
  title: string;
  description: string;
  runtime: AgentRuntime;
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
  system_prompt: SnailPromptDefinition;
}

export class SnailRegistry {
  private snails = new Map<SnailName, SnailDefinition>();
  private stageSnails = new Map<StageType, SnailName[]>();

  constructor() {
    for (const snail of Object.values(this.loadSnails())) {
      this.snails.set(snail.name, snail);
    }
    this.loadStageSnails();
  }

  get(name: SnailName): SnailDefinition | undefined {
    return this.snails.get(name);
  }

  getByTitle(title: string): SnailDefinition | undefined {
    return this.list().find((snail) => snail.title === title);
  }

  has(name: SnailName): boolean {
    return this.snails.has(name);
  }

  list(): SnailDefinition[] {
    return Array.from(this.snails.values());
  }

  listByStageType(stageType: StageType): SnailDefinition[] {
    return (this.stageSnails.get(stageType) ?? []).map((name) => this.snails.get(name)).filter(Boolean) as SnailDefinition[];
  }

  getPrimaryForStageType(stageType: StageType): SnailDefinition {
    const snails = this.listByStageType(stageType);
    if (!snails.length) {
      throw new Error(`No snails configured for stage type: ${stageType}`);
    }
    return snails[0];
  }

  private loadStageSnails(): void {
    const stageDefinitions = loadStageDefinitions();
    for (const [stageType, definition] of Object.entries(stageDefinitions)) {
      this.stageSnails.set(stageType as StageType, definition.snails);
    }
  }

  private loadSnails(): Record<SnailName, SnailDefinition> {
    const filePath = path.join(process.cwd(), ".meta", "snails.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<SnailName, Omit<SnailDefinition, "name">>;
    return Object.fromEntries(
      Object.entries(parsed).map(([name, definition]) => [name, { name: name as SnailName, ...definition }])
    ) as Record<SnailName, SnailDefinition>;
  }
}
