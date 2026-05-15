import type { AgentRuntime } from "../agent/interface";
import type { SnailName } from "../shared/types";
import { loadSnailDefinitions, type SnailRawDefinition } from "../meta";

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

export interface StageRoleBinding {
  projectId: string;
  stageKey: string;
  snailId: SnailName;
  isPrimary: boolean;
  workingRules: string[];
}

export class SnailRegistry {
  private snails = new Map<SnailName, SnailDefinition>();
  private stageSnails = new Map<string, SnailName[]>();

  constructor() {
    for (const snail of Object.values(this.loadSnails())) {
      this.snails.set(snail.name, snail);
    }
  }

  /** 从数据库加载的 Stage 角色绑定注入到 registry 中。按项目隔离。 */
  loadStageRoleBindings(bindings: StageRoleBinding[]): void {
    for (const binding of bindings) {
      const key = `${binding.projectId}:${binding.stageKey}`;
      const existing = this.stageSnails.get(key) ?? [];
      if (!existing.includes(binding.snailId)) {
        existing.push(binding.snailId);
      }
      this.stageSnails.set(key, existing);
    }
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

  listByStageType(projectId: string, stageType: string): SnailDefinition[] {
    const key = `${projectId}:${stageType}`;
    return (this.stageSnails.get(key) ?? []).map((name) => this.snails.get(name)).filter(Boolean) as SnailDefinition[];
  }

  getPrimaryForStageType(projectId: string, stageType: string): SnailDefinition {
    const snails = this.listByStageType(projectId, stageType);
    if (!snails.length) {
      throw new Error(`No snails configured for stage type: ${stageType} in project ${projectId}`);
    }
    return snails[0];
  }

  private loadSnails(): Record<SnailName, SnailDefinition> {
    const parsed = loadSnailDefinitions();
    return Object.fromEntries(
      Object.entries(parsed).map(([name, definition]) => {
        return [name, {
          name: name as SnailName,
          description: (definition as SnailRawDefinition).description,
          runtime: (definition as SnailRawDefinition).runtime as AgentRuntime,
          kind: (definition as SnailRawDefinition).kind ?? "agent",
          template: (definition as SnailRawDefinition).template,
          capability_expectations: (definition as SnailRawDefinition).capability_expectations,
          working_rules: (definition as SnailRawDefinition).working_rules,
          preferred_artifact_types: (definition as SnailRawDefinition).preferred_artifact_types,
        }];
      })
    ) as Record<SnailName, SnailDefinition>;
  }
}
