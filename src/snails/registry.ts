import fs from "fs";
import path from "path";
import type { AgentRuntime } from "../agent/interface";
import type { SnailName, StageType } from "../persistence/store";
import { getPromptDocument, loadStageDefinitions } from "../meta";

export interface SnailPromptDefinition {
  asset_id: string;
}

export interface SnailDefinition {
  id: string;
  name: SnailName;
  description: string;
  runtime?: AgentRuntime;
  kind?: "human" | "agent";
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
  system_prompt: SnailPromptDefinition;
}

export type AgentSnailDefinition = SnailDefinition & { runtime: AgentRuntime; kind?: "agent" };

interface RawSnailDefinition {
  description: string;
  runtime: AgentRuntime;
  kind?: "human" | "agent";
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
  system_prompt_asset: string;
}

export class SnailRegistry {
  private snails = new Map<SnailName, SnailDefinition>();
  private stageSnails = new Map<StageType, SnailName[]>();

  constructor() {
    for (const snail of Object.values(this.loadSnails())) {
      this.snails.set(snail.name, snail);
    }
    this.snails.set("Boss Snail", this.createBossSnail());
    this.loadStageSnails();
  }

  get(name: SnailName): SnailDefinition | undefined {
    return this.snails.get(name);
  }

  getById(id: string): SnailDefinition | undefined {
    return this.list().find((snail) => snail.id === id);
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
        getPromptDocument(definition.system_prompt_asset);
        return [name, {
          id: stableSnailId(name as SnailName),
          name: name as SnailName,
          description: definition.description,
          runtime: definition.runtime,
          kind: definition.kind ?? "agent",
          capability_expectations: definition.capability_expectations,
          working_rules: definition.working_rules,
          preferred_artifact_types: definition.preferred_artifact_types,
          system_prompt: { asset_id: definition.system_prompt_asset },
        }];
      })
    ) as Record<SnailName, SnailDefinition>;
  }

  private createBossSnail(): SnailDefinition {
    return {
      id: stableSnailId("Boss Snail"),
      name: "Boss Snail",
      description: "工作室中的用户本人，可被其他 snail 直接 @ 以请求确认、补充或决策。",
      kind: "human",
      capability_expectations: ["目标确认", "约束补充", "最终拍板"],
      working_rules: ["作为人工参与方，不由系统自动代答", "可被其他 snail @ 以请求确认"],
      preferred_artifact_types: [],
      system_prompt: {
        asset_id: "SYS-SNAIL-BOSS",
      },
    };
  }
}

export function stableSnailId(name: SnailName): string {
  return `builtin:${name.toLowerCase().replace(/\s+/g, "-")}`;
}
