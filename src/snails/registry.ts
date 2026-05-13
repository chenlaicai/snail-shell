import fs from "fs";
import path from "path";
import type { AgentRuntime } from "../agent/interface";
import type { SnailName, StageType } from "../shared/types";
import { loadStageDefinitions } from "../meta";

export interface SnailDefinition {
  name: SnailName;
  description: string;
  runtime?: AgentRuntime;
  kind?: "human" | "agent";
  /** 关联的 Snail Den template ID；有此字段时，调用 agent 会使用 template 配置的 model。 */
  template?: string;
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
}

export type AgentSnailDefinition = SnailDefinition & { runtime: AgentRuntime; kind?: "agent" };

interface RawSnailDefinition {
  description: string;
  runtime: AgentRuntime;
  kind?: "human" | "agent";
  template?: string;
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
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
    const parsed = JSON.parse(raw) as Record<SnailName, RawSnailDefinition>;
    return Object.fromEntries(
      Object.entries(parsed).map(([name, definition]) => {
        return [name, {
          name: name as SnailName,
          description: definition.description,
          runtime: definition.runtime,
          kind: definition.kind ?? "agent",
          template: definition.template,
          capability_expectations: definition.capability_expectations,
          working_rules: definition.working_rules,
          preferred_artifact_types: definition.preferred_artifact_types,
        }];
      })
    ) as Record<SnailName, SnailDefinition>;
  }
}
