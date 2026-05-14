import type Database from "better-sqlite3";
import type { SnailName, StageType } from "../shared/types";
import { getAllSnailDefinitions, type SnailStageAffinity } from "../persistence/snail-definition-model";

export interface SnailDefinition {
  name: SnailName;
  description: string;
  kind: "human" | "agent";
  /** 关联的 Snail Den template ID；有此字段时，调用 agent 会使用 template 配置的 model。 */
  template?: string;
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
  stage_affinity: SnailStageAffinity[];
}

export type AgentSnailDefinition = SnailDefinition & { kind: "agent" };

/**
 * SnailRegistry 从数据库 snail_definition 表读取 snail 定义，
 * 并从 snail 的 stage_affinity 构建 stage → snail 映射。
 *
 * 启动时由 main.ts 在 SnailDen.seedSnailDefinitions() 之后构造。
 */
export class SnailRegistry {
  private snails = new Map<SnailName, SnailDefinition>();
  private stageSnails = new Map<StageType, SnailName[]>();

  constructor(db: Database.Database) {
    const rows = getAllSnailDefinitions(db);
    for (const row of rows) {
      const snail: SnailDefinition = {
        name: row.name as SnailName,
        description: row.description,
        kind: (row.kind as "human" | "agent") ?? "agent",
        template: row.template ?? undefined,
        capability_expectations: JSON.parse(row.capability_expectations),
        working_rules: JSON.parse(row.working_rules),
        preferred_artifact_types: JSON.parse(row.preferred_artifact_types),
        stage_affinity: JSON.parse(row.stage_affinity),
      };
      this.snails.set(snail.name, snail);
    }
    this.buildStageSnailMapping();
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

  /**
   * 从每只 snail 的 stage_affinity 构建 stage → snail 映射。
   * 同一 stage 内按 order 排序，order 越小越优先。
   */
  private buildStageSnailMapping(): void {
    const mapping = new Map<StageType, Array<{ name: SnailName; order: number }>>();
    for (const snail of this.snails.values()) {
      for (const affinity of snail.stage_affinity) {
        const stageType = affinity.stage_type as StageType;
        if (!mapping.has(stageType)) {
          mapping.set(stageType, []);
        }
        mapping.get(stageType)!.push({ name: snail.name, order: affinity.order });
      }
    }
    for (const [stageType, entries] of mapping) {
      entries.sort((a, b) => a.order - b.order);
      this.stageSnails.set(stageType, entries.map((e) => e.name));
    }
  }
}
