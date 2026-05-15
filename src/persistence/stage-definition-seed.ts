import type Database from "better-sqlite3";
import { logger } from "../logger";
import { STAGE_DEFINITION_SEEDS } from "./stage-definition-seed-data";
import { upsertStageTypeDefinition, upsertStageRoleDefinition, upsertRoleSnailAssignment } from "./stage-definition-model";

export function seedStageDefinitions(db: Database.Database): void {
  const transaction = db.transaction(() => {
    for (const seed of STAGE_DEFINITION_SEEDS) {
      upsertStageTypeDefinition(db, {
        type: seed.type,
        title: seed.title,
        order_num: seed.order,
        repo_related: seed.repo_related,
        formal_artifact_types: seed.formal_artifact_types,
        input: seed.input,
        output_summary: seed.output.summary,
        output_required_artifacts: seed.output.required_artifacts,
        output_artifact_requirements: seed.output.artifact_requirements,
        acceptance_focus: seed.acceptance_focus,
      });

      for (let i = 0; i < seed.roles.length; i++) {
        const role = seed.roles[i];
        upsertStageRoleDefinition(db, {
          id: role.id,
          stage_type: seed.type,
          name: role.name,
          description: role.description,
          preferred_artifact_types: role.preferred_artifact_types,
          working_rules: role.working_rules,
          sort_order: i,
        });

        for (let j = 0; j < role.assigned_snails.length; j++) {
          upsertRoleSnailAssignment(db, {
            role_id: role.id,
            stage_type: seed.type,
            snail_name: role.assigned_snails[j],
            sort_order: j,
          });
        }
      }
    }
  });
  transaction();
  logger.info("Stage definitions seeded to database", { stageCount: STAGE_DEFINITION_SEEDS.length });
}
