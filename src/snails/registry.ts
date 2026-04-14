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
  kind?: "human" | "agent";
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
    this.snails.set("boss", this.createBossSnail());
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
      Object.entries(parsed).map(([name, definition]) => [name, { name: name as SnailName, kind: "agent", ...definition }])
    ) as Record<SnailName, SnailDefinition>;
  }

  private createBossSnail(): SnailDefinition {
    return {
      name: "boss",
      title: "老大",
      description: "工作室中的用户本人，可被其他 snail 直接 @ 以请求确认、补充或决策。",
      runtime: "claude-code-cli",
      kind: "human",
      capability_expectations: ["目标确认", "约束补充", "最终拍板"],
      working_rules: ["作为人工参与方，不由系统自动代答", "可被其他 snail @ 以请求确认"],
      preferred_artifact_types: [],
      system_prompt: {
        identity: "你代表工作室中的用户本人。",
        principles: ["提供目标和边界", "给出确认或修正", "在关键节点拍板"],
        output_expectations: ["给出明确反馈", "补充缺失信息", "必要时确认最终决定"],
      },
    };
  }
}
