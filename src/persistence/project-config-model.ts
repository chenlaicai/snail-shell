import type Database from "better-sqlite3";
import type { ProjectStageDefinition, StageRoleDefinition } from "./types";

export interface ProjectConfigSeed {
  project: { id: string; kind: string; name: string; summary: string };
  stage_definitions: Array<{
    id: string;
    key: string;
    title: string;
    sequence: number;
    input_description: string | null;
    output_description: string | null;
    acceptance_focus: string[];
    roles: Array<{
      id: string;
      name: string;
      snail_template_id: string;
      is_primary: boolean;
      description: string;
      working_rules: string[];
    }>;
  }>;
}

export type StageDefinitionSeed = ProjectConfigSeed["stage_definitions"];

export function seedProjectConfig(db: Database.Database, seed: ProjectConfigSeed): { created: boolean } {
  const existing = db.prepare("SELECT id FROM project WHERE id = ?").get(seed.project.id);
  if (existing) return { created: false };

  const insertProject = db.prepare("INSERT INTO project (id, kind, name, summary, status) VALUES (?, ?, ?, ?, 'active')");
  const insertStageDef = db.prepare("INSERT INTO project_stage_definition (id, project_id, key, title, sequence, input_description, output_description, acceptance_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertRoleDef = db.prepare(
    "INSERT INTO stage_role_definition (id, project_id, stage_definition_id, snail_id, snail_template_id, name, is_primary, description, working_rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const transaction = db.transaction(() => {
    insertProject.run(seed.project.id, seed.project.kind, seed.project.name, seed.project.summary);
    for (const stageDef of seed.stage_definitions) {
      insertStageDef.run(stageDef.id, seed.project.id, stageDef.key, stageDef.title, stageDef.sequence, stageDef.input_description, stageDef.output_description, JSON.stringify(stageDef.acceptance_focus));
      for (const role of stageDef.roles) {
        insertRoleDef.run(
          role.id, seed.project.id, stageDef.id,
          role.name, role.snail_template_id, role.name,
          role.is_primary ? 1 : 0,
          role.description, JSON.stringify(role.working_rules)
        );
      }
    }
  });
  transaction();
  return { created: true };
}

export function seedStageDefinitionsForProject(db: Database.Database, projectId: string, stageDefinitions: StageDefinitionSeed): void {
  const insertStageDef = db.prepare("INSERT OR IGNORE INTO project_stage_definition (id, project_id, key, title, sequence, input_description, output_description, acceptance_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertRoleDef = db.prepare(
    "INSERT OR IGNORE INTO stage_role_definition (id, project_id, stage_definition_id, snail_id, snail_template_id, name, is_primary, description, working_rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const transaction = db.transaction(() => {
    for (const stageDef of stageDefinitions) {
      insertStageDef.run(stageDef.id, projectId, stageDef.key, stageDef.title, stageDef.sequence, stageDef.input_description, stageDef.output_description, JSON.stringify(stageDef.acceptance_focus));
      for (const role of stageDef.roles) {
        insertRoleDef.run(
          role.id, projectId, stageDef.id,
          role.name, role.snail_template_id, role.name,
          role.is_primary ? 1 : 0,
          role.description, JSON.stringify(role.working_rules)
        );
      }
    }
  });
  transaction();
}

export function getStageDefinition(db: Database.Database, id: string): ProjectStageDefinition | undefined {
  const row = db.prepare("SELECT * FROM project_stage_definition WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapStageDefinition(row) : undefined;
}

export function getStageDefinitionByKey(db: Database.Database, projectId: string, key: string): ProjectStageDefinition | undefined {
  const row = db.prepare("SELECT * FROM project_stage_definition WHERE project_id = ? AND key = ?").get(projectId, key) as Record<string, unknown> | undefined;
  return row ? mapStageDefinition(row) : undefined;
}

export function listStageDefinitions(db: Database.Database, projectId: string): ProjectStageDefinition[] {
  const rows = db.prepare("SELECT * FROM project_stage_definition WHERE project_id = ? ORDER BY sequence ASC").all(projectId) as Record<string, unknown>[];
  return rows.map((row) => mapStageDefinition(row));
}

export function getRoleDefinition(db: Database.Database, id: string): StageRoleDefinition | undefined {
  const row = db.prepare("SELECT * FROM stage_role_definition WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapRoleDefinition(row) : undefined;
}

export function listRoleDefinitions(db: Database.Database, stageDefinitionId: string): StageRoleDefinition[] {
  const rows = db.prepare("SELECT * FROM stage_role_definition WHERE stage_definition_id = ? ORDER BY is_primary DESC, rowid ASC").all(stageDefinitionId) as Record<string, unknown>[];
  return rows.map((row) => mapRoleDefinition(row));
}

export function listRoleDefinitionsByProject(db: Database.Database, projectId: string): StageRoleDefinition[] {
  const rows = db.prepare("SELECT * FROM stage_role_definition WHERE project_id = ? ORDER BY is_primary DESC, rowid ASC").all(projectId) as Record<string, unknown>[];
  return rows.map((row) => mapRoleDefinition(row));
}

export function listAllRoleDefinitions(db: Database.Database): Array<StageRoleDefinition & { project_id: string }> {
  const rows = db.prepare("SELECT * FROM stage_role_definition ORDER BY project_id, is_primary DESC, rowid ASC").all() as Record<string, unknown>[];
  return rows.map((row) => ({ ...mapRoleDefinition(row), project_id: row.project_id as string }));
}

function parseJsonArray<T extends string>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapStageDefinition(row: Record<string, unknown>): ProjectStageDefinition {
  return {
    ...(row as Omit<ProjectStageDefinition, "acceptance_focus">),
    acceptance_focus: parseJsonArray<string>(row.acceptance_focus as string | null),
  };
}

function mapRoleDefinition(row: Record<string, unknown>): StageRoleDefinition {
  return {
    ...(row as Omit<StageRoleDefinition, "working_rules">),
    working_rules: parseJsonArray<string>(row.working_rules as string | null),
  };
}
