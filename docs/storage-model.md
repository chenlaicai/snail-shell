# Snail Shell Storage Model

## Purpose

This document defines how the MVP domain model should be persisted.

The storage strategy must satisfy the core studio requirements:

- local-first
- durable
- organized
- traceable
- revision-friendly
- compact enough for MVP

The current repository already uses SQLite through `better-sqlite3`. That is a strong fit for the MVP and should remain the primary structured storage mechanism.

## Storage Principles

### 1. SQLite Is The Primary System Of Record

All core business objects should have durable identity in SQLite.

This includes:

- projects
- stages
- conversations
- messages
- artifacts
- approvals
- git records
- delivery records

SQLite should hold the canonical metadata and relationships.

### 2. Artifact Bodies May Use Hybrid Storage

Artifact identity and metadata should live in SQLite.

Artifact body content can be stored in one of two ways:

1. directly in SQLite for smaller textual artifacts
2. in the filesystem with a stable path referenced from SQLite

For MVP, a hybrid strategy is the most practical because some artifacts are naturally document-like while others are better represented as structured references.

### 3. Never Store Work As Unstructured Debris

Even when content lives in the filesystem, it should still be registered as an artifact with:

- type
- stage
- role
- version
- status
- project link

The filesystem should not become an unmanaged dumping ground.

## Recommended MVP Persistence Split

### SQLite Stores

Store in SQLite:

- identifiers
- relationships
- stage state
- role attribution
- artifact metadata
- artifact status and versions
- approvals
- git record metadata
- delivery outcomes
- rollback and root cause records
- short textual summaries

### Filesystem Stores

Store in filesystem when appropriate:

- long-form markdown documents
- exported reports
- artifact snapshots if needed

Recommended format:

- markdown for human-authored or agent-authored docs
- JSON for structured snapshots if needed

## Recommended Directory Layout

The existing repo already uses `data/` for runtime persistence. Continue with that pattern.

Recommended layout:

```text
data/
  snail-shell.db
  snail-shell.log
  projects/
    <project-id>/
      artifacts/
        <artifact-id>/
          v1.md
          v2.md
      exports/
      attachments/
```

Meaning:

1. SQLite remains at `data/snail-shell.db`
2. file-backed artifact bodies live under `data/projects/<project-id>/artifacts/...`
3. project-local exports or bundled outputs can live beside artifacts later if needed

## Core Tables

Below is the recommended MVP table set.

## 1. `projects`

Purpose:
Top-level project container.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `summary TEXT`
- `status TEXT NOT NULL`
- `current_stage_name TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `archived_at TEXT`

## 2. `project_roles`

Purpose:
Track role identities inside a project.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `name TEXT NOT NULL`
- `kind TEXT NOT NULL`
- `description TEXT`
- `agent_binding TEXT`
- `created_at TEXT NOT NULL`

Notes:

- `kind` can be values like `owner`, `product_agent`, `design_agent`
- `agent_binding` can be simple in MVP, such as `claude-code`

## 3. `stage_instances`

Purpose:
Track project-specific stage progress and approval state.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `stage_name TEXT NOT NULL`
- `sequence INTEGER NOT NULL`
- `state TEXT NOT NULL`
- `baseline_version INTEGER NOT NULL DEFAULT 1`
- `entered_at TEXT NOT NULL`
- `submitted_at TEXT`
- `approved_at TEXT`
- `rolled_back_at TEXT`
- `approved_by_role_id TEXT`
- `notes TEXT`

Recommended unique constraint:

- `UNIQUE(project_id, stage_name, baseline_version)`

## 4. `conversations`

Purpose:
Persistent threads associated with a project, stage, and role.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `stage_instance_id TEXT`
- `role_id TEXT`
- `title TEXT`
- `status TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

## 5. `messages`

Purpose:
Conversation contents and event logs.

Suggested columns:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `conversation_id TEXT NOT NULL`
- `project_id TEXT NOT NULL`
- `role TEXT NOT NULL`
- `content TEXT NOT NULL`
- `message_type TEXT NOT NULL DEFAULT 'text'`
- `metadata TEXT`
- `created_at TEXT NOT NULL`

Migration note:

The current repo already has a `messages` table. MVP migration can evolve it rather than replace it immediately.

## 6. `artifacts`

Purpose:
Canonical metadata for all work outputs.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `stage_instance_id TEXT NOT NULL`
- `role_id TEXT`
- `artifact_type TEXT NOT NULL`
- `title TEXT NOT NULL`
- `status TEXT NOT NULL`
- `version INTEGER NOT NULL DEFAULT 1`
- `is_current INTEGER NOT NULL DEFAULT 1`
- `content_format TEXT NOT NULL`
- `content_body TEXT`
- `content_path TEXT`
- `summary TEXT`
- `created_by_role_id TEXT`
- `approved_by_role_id TEXT`
- `supersedes_artifact_id TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `approved_at TEXT`

Key storage rule:

- use `content_body` for short markdown or structured JSON text
- use `content_path` for filesystem-backed artifacts
- an artifact may use one or the other, but not neither

## 7. `artifact_links`

Purpose:
Express dependency or traceability links between artifacts.

Suggested columns:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `project_id TEXT NOT NULL`
- `source_artifact_id TEXT NOT NULL`
- `target_artifact_id TEXT NOT NULL`
- `link_type TEXT NOT NULL`
- `created_at TEXT NOT NULL`

Useful `link_type` values:

- `derived_from`
- `implements`
- `supersedes`
- `validated_by`
- `referenced_by`

This table is not strictly mandatory on day one, but it is highly valuable for traceability and still compact.

## 8. `approval_records`

Purpose:
Explicit owner review decisions.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `stage_instance_id TEXT NOT NULL`
- `artifact_id TEXT`
- `decision TEXT NOT NULL`
- `decided_by_role_id TEXT NOT NULL`
- `decision_note TEXT`
- `created_at TEXT NOT NULL`

## 9. `work_items`

Purpose:
Track implementation tasks derived from design.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `stage_instance_id TEXT NOT NULL`
- `source_artifact_id TEXT`
- `title TEXT NOT NULL`
- `description TEXT`
- `status TEXT NOT NULL`
- `assigned_role_id TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

## 10. `git_records`

Purpose:
Link implementation work to git history.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `work_item_id TEXT`
- `artifact_id TEXT`
- `branch_name TEXT`
- `commit_hash TEXT`
- `commit_message TEXT`
- `diff_summary TEXT`
- `created_at TEXT NOT NULL`

## 11. `validation_records`

Purpose:
Store validation evidence for implementation and acceptance.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `artifact_id TEXT`
- `validation_type TEXT NOT NULL`
- `status TEXT NOT NULL`
- `summary TEXT`
- `details_ref TEXT`
- `created_at TEXT NOT NULL`

## 12. `delivery_records`

Purpose:
Store final delivery decisions.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `acceptance_artifact_id TEXT`
- `decision TEXT NOT NULL`
- `summary TEXT`
- `accepted_by_role_id TEXT`
- `created_at TEXT NOT NULL`

## 13. `stage_rollbacks`

Purpose:
Preserve rollback events and their rationale.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `detected_in_stage_name TEXT NOT NULL`
- `root_cause_stage_name TEXT NOT NULL`
- `root_cause_artifact_id TEXT`
- `summary TEXT NOT NULL`
- `impact TEXT`
- `created_by_role_id TEXT`
- `created_at TEXT NOT NULL`

## Current Repo Mapping

The current repo contains these persisted concepts:

1. `sessions`
2. `messages`
3. `requirements`

These map roughly to the future model as follows:

### Current `sessions`

Current meaning:

- a chat thread with title and timestamps

Recommended MVP transition:

- evolve `sessions` into `conversations`
- add `project_id`, `stage_instance_id`, and `role_id`
- keep the existing message relationship

Short-term compatibility strategy:

- preserve session behavior in application code
- rename internally later only when UI/API are ready

### Current `messages`

Current meaning:

- chat history with minimal event typing

Recommended MVP transition:

- add `conversation_id` semantics if current `session_id` remains temporarily
- add `project_id`
- keep `message_type` and `metadata`
- support stage and artifact generation workflows through references

### Current `requirements`

Current meaning:

- one special structured output type

Recommended MVP transition:

- treat requirements as either:
  - a dedicated convenience table plus artifact records, or
  - migrate fully into general artifacts

Preferred direction:

- keep the existing table only if it reduces migration cost temporarily
- but treat `requirement_document` as a first-class artifact in the new model

## Recommended MVP Migration Strategy

To keep implementation compact, migrate in four steps.

### Step 1. Add New Top-Level Tables

Add:

- `projects`
- `project_roles`
- `stage_instances`
- `artifacts`
- `approval_records`
- `git_records`
- `delivery_records`
- `stage_rollbacks`

Keep current tables in place.

### Step 2. Attach Sessions To Projects

Extend the current session model so each session belongs to a project and optionally a stage and role.

This allows the UI and runtime behavior to keep working while the project model is introduced.

### Step 3. Introduce Artifact-First Stage Outputs

When a requirement doc, product spec, or technical design is created, save it into the new artifact model even if the UI still feels session-centric.

### Step 4. Gradually Reduce Special Cases

After artifacts and stages are in normal use:

- reduce direct dependence on the special `requirements` table
- make workflow state drive the UI instead of bare sessions

## Content Storage Recommendation For MVP

Use the following simple rule:

1. if artifact content is small and text-based, store it in `artifacts.content_body`
2. if artifact content is longer or intended to exist as a file, store it in `data/projects/...` and save its path in `artifacts.content_path`

This lets the MVP move quickly without prematurely over-engineering document storage.

## Required Indices

At minimum, add indices for:

- `projects(status)`
- `stage_instances(project_id, state)`
- `conversations(project_id, updated_at)`
- `messages(conversation_id, created_at)`
- `artifacts(project_id, stage_instance_id, artifact_type, is_current)`
- `approval_records(project_id, stage_instance_id, created_at)`
- `git_records(project_id, work_item_id)`
- `delivery_records(project_id, created_at)`

## Integrity Rules

The storage model should support these invariants:

1. every conversation belongs to exactly one project
2. every artifact belongs to exactly one project and one stage instance
3. only one project stage is the current active stage at a time
4. only one current version exists per logical artifact lineage
5. rollback records never delete prior artifacts
6. delivery records always point back to an acceptance artifact or equivalent summary artifact

## Logging And Runtime Data

The current repo already writes logs to `data/snail-shell.log`.

This is acceptable for runtime logging, but runtime logs should not replace structured records.

Keep these concepts separate:

1. runtime logs
   Useful for debugging and operations.

2. project records
   Useful for studio production traceability.

They serve different purposes and should not be conflated.

## Recommended First Implementation Focus

If only a minimal subset is implemented first, prioritize:

1. `projects`
2. `stage_instances`
3. `artifacts`
4. attaching existing sessions/messages to projects
5. `approval_records`

This gives Snail Shell a true project-and-artifact spine while preserving most of the current repo's working behavior.
