import type Database from "better-sqlite3";

export interface SnailDefinitionRow {
  name: string;
  description: string;
  template: string | null;
  kind: string;
  capability_expectations: string;
}

export interface SnailDefinitionData {
  name: string;
  description: string;
  template?: string | null;
  kind?: string;
  capability_expectations?: string[];
}

export function getAllSnailDefinitions(db: Database.Database): SnailDefinitionRow[] {
  return db.prepare("SELECT * FROM snail_definition ORDER BY name").all() as SnailDefinitionRow[];
}

export function getSnailDefinition(db: Database.Database, name: string): SnailDefinitionRow | undefined {
  return db.prepare("SELECT * FROM snail_definition WHERE name = ?").get(name) as SnailDefinitionRow | undefined;
}

export function upsertSnailDefinition(db: Database.Database, input: SnailDefinitionData): void {
  db.prepare(`
    INSERT INTO snail_definition (name, description, template, kind, capability_expectations, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      template = excluded.template,
      kind = excluded.kind,
      capability_expectations = excluded.capability_expectations,
      updated_at = datetime('now')
  `).run(
    input.name,
    input.description,
    input.template ?? null,
    input.kind ?? "agent",
    JSON.stringify(input.capability_expectations ?? []),
  );
}
