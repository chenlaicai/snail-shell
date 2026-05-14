import type Database from "better-sqlite3";

export interface SnailDefinitionRow {
  name: string;
  description: string;
  template: string | null;
  kind: string;
  capability_expectations: string;
  working_rules: string;
  preferred_artifact_types: string;
  stage_affinity: string;
}

export interface SnailStageAffinity {
  stage_type: string;
  order: number;
}

export interface SnailDefinitionData {
  name: string;
  description: string;
  template?: string | null;
  kind?: string;
  capability_expectations?: string[];
  working_rules?: string[];
  preferred_artifact_types?: string[];
  stage_affinity?: SnailStageAffinity[];
}

export function getAllSnailDefinitions(db: Database.Database): SnailDefinitionRow[] {
  return db.prepare("SELECT * FROM snail_definition ORDER BY name").all() as SnailDefinitionRow[];
}

export function getSnailDefinition(db: Database.Database, name: string): SnailDefinitionRow | undefined {
  return db.prepare("SELECT * FROM snail_definition WHERE name = ?").get(name) as SnailDefinitionRow | undefined;
}

export function upsertSnailDefinition(db: Database.Database, input: SnailDefinitionData): void {
  db.prepare(`
    INSERT INTO snail_definition (name, description, template, kind, capability_expectations, working_rules, preferred_artifact_types, stage_affinity, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      template = excluded.template,
      kind = excluded.kind,
      capability_expectations = excluded.capability_expectations,
      working_rules = excluded.working_rules,
      preferred_artifact_types = excluded.preferred_artifact_types,
      stage_affinity = excluded.stage_affinity,
      updated_at = datetime('now')
  `).run(
    input.name,
    input.description,
    input.template ?? null,
    input.kind ?? "agent",
    JSON.stringify(input.capability_expectations ?? []),
    JSON.stringify(input.working_rules ?? []),
    JSON.stringify(input.preferred_artifact_types ?? []),
    JSON.stringify(input.stage_affinity ?? []),
  );
}
