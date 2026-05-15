import type Database from "better-sqlite3";
import type { SnailName } from "../shared/types";
import { getAllSnailDefinitions } from "../persistence/snail-definition-model";

export interface SnailDefinition {
  name: SnailName;
  description: string;
  kind: "human" | "agent";
  /** 关联的 Snail Den template ID；有此字段时，调用 agent 会使用 template 配置的 model。 */
  template?: string;
  capability_expectations: string[];
}

export type AgentSnailDefinition = SnailDefinition & { kind: "agent" };

/**
 * SnailRegistry 从数据库 snail_definition 表读取 snail 定义。
 * 仅管理 snail 身份信息，不含 role 级职责（working_rules、preferred_artifact_types 等）。
 *
 * 启动时由 main.ts 在 SnailDen.seedSnailDefinitions() 之后构造。
 */
export class SnailRegistry {
  private snails = new Map<SnailName, SnailDefinition>();

  constructor(db: Database.Database) {
    const rows = getAllSnailDefinitions(db);
    for (const row of rows) {
      const snail: SnailDefinition = {
        name: row.name as SnailName,
        description: row.description,
        kind: (row.kind as "human" | "agent") ?? "agent",
        template: row.template ?? undefined,
        capability_expectations: JSON.parse(row.capability_expectations),
      };
      this.snails.set(snail.name, snail);
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
}
