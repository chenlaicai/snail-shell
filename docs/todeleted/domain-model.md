# Snail Shell Domain Model

## Purpose

This document defines the core business objects of Snail Shell.

Snail Shell is not centered on chat messages alone. It is centered on software production artifacts organized under a project, moved through strict workflow stages, and attributed to explicit studio roles.

The domain model must support:

- local single-machine operation
- one human owner
- one or more local agents
- strict stage approvals
- rollback to upstream stages
- durable and organized work records

## Modeling Principles

### 1. Project Is The Top-Level Container

The primary business object is `Project`.

All major work belongs to a project. Sessions, conversations, artifacts, approvals, and delivery records should ultimately be traceable back to a project.

### 2. Artifacts Are First-Class

Artifacts are not attachments to chat. They are the primary outputs of work.

Conversation exists to produce and refine artifacts, but artifacts are the main objects used for review, approval, handoff, and traceability.

### 3. Workflow State Must Be Explicit

The system should always know:

- what stage a project is in
- what has been approved
- what is in progress
- what was rolled back
- what outputs are current versus superseded

### 4. History Must Be Preserved

Revisions and rollback should not destroy prior records. A new baseline should supersede an older one while preserving the chain of work.

## Core Entities

## 1. Project

Represents one software initiative managed by the studio owner.

Purpose:

- top-level container for all work
- workflow anchor
- delivery boundary

Recommended fields:

- `id`
- `name`
- `summary`
- `status`
- `current_stage`
- `owner_id`
- `created_at`
- `updated_at`
- `archived_at`

Recommended statuses:

- `active`
- `paused`
- `completed`
- `cancelled`
- `archived`

Relationships:

- one project has many stages
- one project has many conversations
- one project has many artifacts
- one project has many work items
- one project has many git records
- one project has many delivery records

## 2. Stage Instance

Represents the state of one workflow stage within one project.

This is not just a stage name. It is the project-specific execution record of that stage.

Purpose:

- track progression through the workflow
- track approval state
- support rollback and re-entry

Recommended fields:

- `id`
- `project_id`
- `stage_name`
- `sequence`
- `state`
- `entered_at`
- `submitted_at`
- `approved_at`
- `rolled_back_at`
- `approved_by`
- `notes`
- `baseline_version`

Recommended `stage_name` values for MVP:

- `initiative`
- `requirement_discussion`
- `product_design`
- `software_design`
- `implementation`
- `delivery_acceptance`

Recommended `state` values:

- `not_started`
- `in_progress`
- `in_review`
- `approved`
- `rejected`
- `rolled_back`
- `invalidated`

Relationships:

- belongs to one project
- has many artifacts
- has many approvals
- may have many conversations

## 3. Role

Represents a studio responsibility rather than a specific model runtime.

Purpose:

- attribute work to a responsibility
- make handoffs explicit
- allow multiple roles over the same underlying agent engine

Recommended MVP role values:

- `owner`
- `product_agent`
- `design_agent`
- `implementation_agent`
- `acceptance_agent`

Recommended fields:

- `id`
- `project_id`
- `name`
- `kind`
- `description`
- `agent_binding`
- `created_at`

Notes:

- `owner` is the human authority
- agent roles may map to the same runtime in MVP
- role identity still matters even when runtime identity is shared

## 4. Conversation

Represents a persistent thread of discussion inside a project.

Conversation is useful, but should be scoped and attributable.

Purpose:

- preserve discussions
- support artifact production
- preserve reasoning and decisions around outputs

Recommended fields:

- `id`
- `project_id`
- `stage_instance_id`
- `role_id`
- `title`
- `status`
- `created_at`
- `updated_at`

Relationships:

- belongs to one project
- may belong to one stage instance
- may be associated with one producing role
- has many messages

## 5. Message

Represents a single entry in a conversation.

Purpose:

- preserve durable conversation history
- preserve lifecycle trace for user, assistant, and system messages
- support summaries, search, preview, quoting, and artifact generation

Recommended fields:

- `id`
- `conversation_id`
- `from_snail`
- `to_snails`
- `role`
- `quoted_message_id`
- `context_cutoff_at`
- `created_at`

Important note:

Message is only the anchor entity.

Its body, lifecycle, process trace, and formal conclusion should not be stored directly on the `message` row.
Those belong to `message_part` records.

Recommended `message_part.kind` values:

- `start`
- `delta`
- `result`
- `end`

Key modeling rules:

- `start` represents lifecycle start
- `delta` represents process state only
- `result` represents the formal conclusion only
- `end` represents terminal state only

This means tool calls, tool results, runtime observations, and intermediate text should not become separate top-level message types.
They should be represented inside `delta` payloads under one unified message model.

Note:

The current repo already uses a unified message model based on `message + message_part`.
The canonical specification for this model is `docs/core-message-model.md`.

## 6. Artifact

Represents a durable work output.

This is the most important business object after `Project`.

Purpose:

- hold the actual outputs of software production
- support review, approval, revision, and traceability

Recommended fields:

- `id`
- `project_id`
- `stage_instance_id`
- `role_id`
- `artifact_type`
- `title`
- `status`
- `version`
- `is_current`
- `content_format`
- `content_ref`
- `summary`
- `created_by`
- `approved_by`
- `created_at`
- `updated_at`
- `approved_at`
- `supersedes_artifact_id`

Recommended `status` values:

- `draft`
- `in_review`
- `approved`
- `rejected`
- `superseded`
- `invalidated`

Recommended `content_format` values:

- `markdown`
- `json`
- `structured_record`
- `git_ref`
- `file_bundle`

### Mandatory MVP Artifact Types

The following artifact types should exist in MVP:

1. `project_charter`
2. `initiative_discussion_record`
3. `requirement_document`
4. `product_specification`
5. `technical_design`
6. `implementation_task_breakdown`
7. `code_change_record`
8. `git_record_set`
9. `acceptance_report`
10. `root_cause_record`

### Artifact Storage Strategy

Artifact content may eventually use a hybrid storage model:

- structured metadata in SQLite
- document bodies in filesystem or SQLite
- git-related references as structured records

For MVP, the main requirement is not the exact storage engine. The main requirement is that artifact identity and traceability are explicit.

## 7. Approval Record

Represents an explicit review and decision by the owner.

Purpose:

- prevent ambiguous stage completion
- preserve decision history

Recommended fields:

- `id`
- `project_id`
- `stage_instance_id`
- `artifact_id`
- `decision`
- `decided_by`
- `decision_note`
- `created_at`

Recommended `decision` values:

- `approve`
- `reject`
- `request_revision`
- `invalidate_due_to_rollback`

## 8. Work Item

Represents an executable unit of implementation work derived from approved design.

Purpose:

- connect design to execution
- organize code production into manageable pieces

Recommended fields:

- `id`
- `project_id`
- `stage_instance_id`
- `source_artifact_id`
- `title`
- `description`
- `status`
- `assigned_role_id`
- `created_at`
- `updated_at`

Recommended `status` values:

- `pending`
- `in_progress`
- `blocked`
- `completed`
- `cancelled`

## 9. Git Record

Represents source-control traces attached to project work.

Purpose:

- preserve implementation traceability
- link work items to code history

Recommended fields:

- `id`
- `project_id`
- `work_item_id`
- `artifact_id`
- `branch_name`
- `commit_hash`
- `commit_message`
- `diff_summary`
- `created_at`

Notes:

- a project may have many git records
- a code change artifact may aggregate several git records

## 10. Validation Record

Represents evidence that implementation was checked.

Purpose:

- preserve test and verification results
- support acceptance review

Recommended fields:

- `id`
- `project_id`
- `artifact_id`
- `validation_type`
- `status`
- `summary`
- `details_ref`
- `created_at`

Recommended `validation_type` values:

- `manual_check`
- `test_run`
- `build_run`
- `review`

Recommended `status` values:

- `passed`
- `failed`
- `partial`
- `not_run`

## 11. Delivery Record

Represents the final state of a project delivery decision.

Purpose:

- record the delivery outcome
- anchor acceptance history

Recommended fields:

- `id`
- `project_id`
- `acceptance_artifact_id`
- `decision`
- `summary`
- `accepted_by`
- `created_at`

Recommended `decision` values:

- `accepted`
- `accepted_with_issues`
- `rejected`
- `deferred`

## 12. Root Cause Record

Represents the formal reason for rollback.

Purpose:

- make rollback explicit and inspectable
- preserve why an upstream stage was reopened

Recommended fields:

- `id`
- `project_id`
- `detected_in_stage`
- `root_cause_stage`
- `summary`
- `impact`
- `resolution_direction`
- `created_by`
- `created_at`

This should usually be represented as a specific artifact type in MVP.

## Entity Relationships

At a high level:

1. A `Project` contains many `StageInstance` records.
2. A `Project` contains many `Conversation` records.
3. A `Conversation` contains many `Message` records.
4. A `StageInstance` produces many `Artifact` records.
5. A `Role` produces conversations, artifacts, and work items.
6. A `Technical Design` artifact produces many `WorkItem` records.
7. `WorkItem` records link to `GitRecord` and `ValidationRecord` entries.
8. `Acceptance Report` and `Delivery Record` close the delivery loop.
9. `Root Cause Record` can invalidate downstream artifacts and trigger rollback.

## Revision Model

Artifacts should support revision without destroying history.

Recommended rules:

1. Each revision creates a new artifact version.
2. The previous version becomes `superseded`.
3. Only one current version should be marked `is_current = true`.
4. Rollback does not delete downstream artifacts. It marks them `invalidated` or `superseded` as appropriate.

This model is important because the studio must preserve work trails rather than rewrite history.

## Approval Model

Approval should exist at both stage and artifact level.

Recommended interpretation:

1. Artifacts are produced and reviewed.
2. Required artifacts for a stage must reach approvable state.
3. Owner approval of the stage creates a stage-level decision.
4. That stage approval establishes a project baseline for subsequent work.

## Baseline Concept

Each approved stage establishes a baseline.

Meaning:

- downstream work should reference approved upstream outputs
- if the upstream baseline changes, downstream outputs may become invalid

This is how the system avoids silent drift between requirement, design, implementation, and acceptance.

## Suggested Mapping From Current Repo

The current codebase already contains:

- session-like objects
- message storage
- requirement records
- skill execution
- websocket event flow

Recommended evolution path:

1. map current `session` into `conversation` or temporary project workspace
2. add `project` as the top-level object
3. add `stage_instance` as explicit workflow state
4. evolve `requirements` into one artifact family under the project
5. add general `artifact` records rather than keeping only requirements as structured outputs
6. add git and approval records as first-class objects

## MVP Persistence Priorities

If implementation must stay minimal, persist these first:

1. `project`
2. `stage_instance`
3. `conversation`
4. `message`
5. `artifact`
6. `approval_record`
7. `git_record`

This is enough to support the core production loop while keeping the system compact.

## Non-Goals For The Domain Model

The MVP domain model should not yet expand into:

1. organization hierarchy
2. multi-user identity and permissions
3. distributed execution scheduling
4. external plugin ecosystem models
5. complex economic or resource accounting

The studio remains intentionally small.
