import type Database from "better-sqlite3";

export interface StageTypeDefinitionRow {
  type: string;
  title: string;
  order_num: number;
  repo_related: number;
  formal_artifact_types: string;
  input: string;
  output_summary: string;
  output_required_artifacts: string;
  output_artifact_requirements: string;
  acceptance_focus: string;
}

export interface StageRoleDefinitionRow {
  id: string;
  stage_type: string;
  name: string;
  description: string;
  preferred_artifact_types: string;
  working_rules: string;
  sort_order: number;
}

export interface RoleSnailAssignmentRow {
  role_id: string;
  stage_type: string;
  snail_name: string;
  sort_order: number;
}

export function getAllStageTypeDefinitions(db: Database.Database): StageTypeDefinitionRow[] {
  return db.prepare("SELECT * FROM stage_type_definition ORDER BY order_num").all() as StageTypeDefinitionRow[];
}

export function getStageTypeDefinition(db: Database.Database, type: string): StageTypeDefinitionRow | undefined {
  return db.prepare("SELECT * FROM stage_type_definition WHERE type = ?").get(type) as StageTypeDefinitionRow | undefined;
}

export function upsertStageTypeDefinition(db: Database.Database, input: Omit<StageTypeDefinitionRow, "formal_artifact_types" | "input" | "output_required_artifacts" | "output_artifact_requirements" | "acceptance_focus" | "repo_related"> & { repo_related: boolean | number; formal_artifact_types: string[]; input: string[]; output_required_artifacts: string[]; output_artifact_requirements: string[]; acceptance_focus: string[] }): void {
  db.prepare(`
    INSERT INTO stage_type_definition (type, title, order_num, repo_related, formal_artifact_types, input, output_summary, output_required_artifacts, output_artifact_requirements, acceptance_focus, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(type) DO UPDATE SET
      title = excluded.title,
      order_num = excluded.order_num,
      repo_related = excluded.repo_related,
      formal_artifact_types = excluded.formal_artifact_types,
      input = excluded.input,
      output_summary = excluded.output_summary,
      output_required_artifacts = excluded.output_required_artifacts,
      output_artifact_requirements = excluded.output_artifact_requirements,
      acceptance_focus = excluded.acceptance_focus,
      updated_at = datetime('now')
  `).run(
    input.type,
    input.title,
    input.order_num,
    input.repo_related ? 1 : 0,
    JSON.stringify(input.formal_artifact_types),
    JSON.stringify(input.input),
    input.output_summary,
    JSON.stringify(input.output_required_artifacts),
    JSON.stringify(input.output_artifact_requirements),
    JSON.stringify(input.acceptance_focus),
  );
}

export function getAllStageRoleDefinitions(db: Database.Database): StageRoleDefinitionRow[] {
  return db.prepare("SELECT * FROM stage_role_definition ORDER BY stage_type, sort_order").all() as StageRoleDefinitionRow[];
}

export function getStageRoleDefinitionsByStageType(db: Database.Database, stageType: string): StageRoleDefinitionRow[] {
  return db.prepare("SELECT * FROM stage_role_definition WHERE stage_type = ? ORDER BY sort_order").all(stageType) as StageRoleDefinitionRow[];
}

export function upsertStageRoleDefinition(db: Database.Database, input: Omit<StageRoleDefinitionRow, "preferred_artifact_types" | "working_rules"> & { preferred_artifact_types: string[]; working_rules: string[] }): void {
  db.prepare(`
    INSERT INTO stage_role_definition (id, stage_type, name, description, preferred_artifact_types, working_rules, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id, stage_type) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      preferred_artifact_types = excluded.preferred_artifact_types,
      working_rules = excluded.working_rules,
      sort_order = excluded.sort_order,
      updated_at = datetime('now')
  `).run(
    input.id,
    input.stage_type,
    input.name,
    input.description,
    JSON.stringify(input.preferred_artifact_types),
    JSON.stringify(input.working_rules),
    input.sort_order,
  );
}

export function getAllRoleSnailAssignments(db: Database.Database): RoleSnailAssignmentRow[] {
  return db.prepare("SELECT * FROM stage_role_snail_assignment ORDER BY stage_type, role_id, sort_order").all() as RoleSnailAssignmentRow[];
}

export function getRoleSnailAssignmentsByStageType(db: Database.Database, stageType: string): RoleSnailAssignmentRow[] {
  return db.prepare("SELECT * FROM stage_role_snail_assignment WHERE stage_type = ? ORDER BY role_id, sort_order").all(stageType) as RoleSnailAssignmentRow[];
}

export function upsertRoleSnailAssignment(db: Database.Database, input: RoleSnailAssignmentRow): void {
  db.prepare(`
    INSERT INTO stage_role_snail_assignment (role_id, stage_type, snail_name, sort_order, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(role_id, stage_type, snail_name) DO UPDATE SET
      sort_order = excluded.sort_order
  `).run(
    input.role_id,
    input.stage_type,
    input.snail_name,
    input.sort_order,
  );
}
