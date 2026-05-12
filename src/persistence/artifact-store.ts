import type Database from "better-sqlite3";
import type { Artifact, CreateArtifactInput } from "./types";

export function createArtifact(db: Database.Database, input: CreateArtifactInput): Artifact {
  db.prepare(
    "INSERT INTO artifact (id, project_id, feature_id, stage_id, conversation_id, artifact_type, title, status, storage_type, file_path, inline_content, external_ref, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(input.id, input.projectId, input.featureId, input.stageId, input.conversationId, input.artifactType, input.title, input.status, input.storageType, input.options?.filePath ?? null, input.options?.inlineContent ?? null, input.options?.externalRef ?? null, input.options?.metadata ?? null);
  return getArtifact(db, input.id)!;
}

export function getArtifact(db: Database.Database, id: string): Artifact | undefined {
  return db.prepare("SELECT * FROM artifact WHERE id = ?").get(id) as Artifact | undefined;
}

export function listArtifactsByStage(db: Database.Database, stageId: string): Artifact[] {
  return db.prepare("SELECT * FROM artifact WHERE stage_id = ? ORDER BY updated_at DESC").all(stageId) as Artifact[];
}

export function listArtifactsByFeature(db: Database.Database, featureId: string): Artifact[] {
  return db.prepare("SELECT * FROM artifact WHERE feature_id = ? ORDER BY updated_at DESC").all(featureId) as Artifact[];
}

export function listArtifactsByConversation(db: Database.Database, conversationId: string): Artifact[] {
  return db.prepare("SELECT * FROM artifact WHERE conversation_id = ? ORDER BY updated_at DESC").all(conversationId) as Artifact[];
}

export function updateArtifact(db: Database.Database, id: string, updates: Partial<Omit<Artifact, "id" | "project_id" | "stage_id" | "conversation_id" | "created_at">>): Artifact {
  const artifact = getArtifact(db, id);
  if (!artifact) throw new Error(`Artifact not found: ${id}`);
  db.prepare(
    "UPDATE artifact SET artifact_type = ?, title = ?, status = ?, storage_type = ?, file_path = ?, inline_content = ?, external_ref = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(updates.artifact_type ?? artifact.artifact_type, updates.title ?? artifact.title, updates.status ?? artifact.status, updates.storage_type ?? artifact.storage_type, updates.file_path ?? artifact.file_path, updates.inline_content ?? artifact.inline_content, updates.external_ref ?? artifact.external_ref, updates.metadata ?? artifact.metadata, id);
  return getArtifact(db, id)!;
}
