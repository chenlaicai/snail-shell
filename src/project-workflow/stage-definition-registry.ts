import type Database from "better-sqlite3";
import type { ArtifactType, SnailName, StageType } from "../shared/types";
import { getAllStageTypeDefinitions, getAllStageRoleDefinitions, getAllRoleSnailAssignments } from "../persistence/stage-definition-model";
import type { StageDefinition, StageRoleDefinition } from "../shared/domain-types";

export class StageDefinitionRegistry {
  private definitions = new Map<StageType, StageDefinition>();

  constructor(db: Database.Database) {
    const typeRows = getAllStageTypeDefinitions(db);
    const roleRows = getAllStageRoleDefinitions(db);
    const assignmentRows = getAllRoleSnailAssignments(db);

    const rolesByStageType = new Map<string, typeof roleRows>();
    for (const row of roleRows) {
      if (!rolesByStageType.has(row.stage_type)) rolesByStageType.set(row.stage_type, []);
      rolesByStageType.get(row.stage_type)!.push(row);
    }

    const assignmentsByRoleKey = new Map<string, typeof assignmentRows>();
    for (const row of assignmentRows) {
      const key = `${row.stage_type}:${row.role_id}`;
      if (!assignmentsByRoleKey.has(key)) assignmentsByRoleKey.set(key, []);
      assignmentsByRoleKey.get(key)!.push(row);
    }

    for (const typeRow of typeRows) {
      const roles: StageRoleDefinition[] = (rolesByStageType.get(typeRow.type) ?? []).map((roleRow) => {
        const key = `${typeRow.type}:${roleRow.id}`;
        const assignments = assignmentsByRoleKey.get(key) ?? [];
        return {
          id: roleRow.id,
          name: roleRow.name,
          description: roleRow.description,
          assigned_snails: assignments.map((a) => a.snail_name as SnailName),
          preferred_artifact_types: JSON.parse(roleRow.preferred_artifact_types) as ArtifactType[],
          working_rules: JSON.parse(roleRow.working_rules) as string[],
        };
      });

      this.definitions.set(typeRow.type as StageType, {
        order: typeRow.order_num,
        title: typeRow.title,
        repo_related: typeRow.repo_related === 1,
        formal_artifact_types: JSON.parse(typeRow.formal_artifact_types) as ArtifactType[],
        roles,
        input: JSON.parse(typeRow.input) as ArtifactType[],
        output: {
          summary: typeRow.output_summary,
          required_artifacts: JSON.parse(typeRow.output_required_artifacts) as ArtifactType[],
          artifact_requirements: JSON.parse(typeRow.output_artifact_requirements) as string[],
        },
        acceptance_focus: JSON.parse(typeRow.acceptance_focus) as string[],
      });
    }
  }

  get(type: StageType): StageDefinition | undefined {
    return this.definitions.get(type);
  }

  getAll(): Record<StageType, StageDefinition> {
    return Object.fromEntries(this.definitions) as Record<StageType, StageDefinition>;
  }

  getStageTypes(): StageType[] {
    return Array.from(this.definitions.keys());
  }

  getFormalArtifactTypes(): Record<StageType, ArtifactType[]> {
    const result: Record<string, ArtifactType[]> = {};
    for (const [type, def] of this.definitions) {
      result[type] = def.formal_artifact_types;
    }
    return result as Record<StageType, ArtifactType[]>;
  }
}
