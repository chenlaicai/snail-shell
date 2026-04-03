# Snail Shell Implementation Plan V1

## Purpose

This document is the first implementation-facing plan for Snail Shell.

Its job is not just to describe what will be built, but to preserve why the first version should be shaped that way. Layout details may evolve later. The underlying intent should remain stable unless explicitly reconsidered.

## The Core Intent

The first implementation must reflect this product truth:

1. conversation is still the primary work surface
2. project is the outer organizational boundary
3. workflow and stage state are important, but they are contextual structure rather than the main working canvas
4. artifacts are the durable outputs that give the work meaning beyond chat

The UI must therefore avoid two opposite mistakes:

1. reducing the system to an unstructured chat app
2. over-correcting into a project board that pushes the real human-agent work out of the center

The correct balance for V1 is:

- project provides the outer container
- conversation remains the main workspace
- workflow, stage, artifacts, and review actions remain visible as persistent context

This is the reason for the page structure chosen below.

## V1 Target Shape

The first implementation should produce a local single-page application with three persistent regions:

1. left navigation: project and conversation hierarchy
2. center workspace: active conversation and message flow
3. right context panel: workflow, artifacts, and review state

This is not just a layout preference. It encodes the operating model of the studio.

## Why This Layout Exists

### Left: Project And Conversation Hierarchy

Reason:

- project is the outermost unit of work
- a project may contain multiple conversations
- the user needs quick switching between project-level context and active discussion threads

Therefore the left side should reflect the real containment structure:

`Project -> Conversations`

This preserves the studio's working hierarchy.

### Center: Conversation As Main Work Surface

Reason:

- the owner's most frequent action is direct collaboration with agents
- real work advances through dialogue, instruction, revision, and clarification
- the conversation is where intent becomes structured output

Therefore the center must remain conversation-first.

The system should never visually imply that workflow cards are more primary than live working dialogue.

### Right: Workflow And Artifact Context

Reason:

- workflow stage and review state are critical constraints
- artifact presence and completeness determine whether a stage is truly done
- however, these are comparatively stable compared with the active conversation stream

Therefore this information should stay visible, but should not dominate the center.

The right panel is the correct place for:

- current stage
- stage states
- required artifacts
- existing artifacts
- approval actions
- rollback actions

## V1 Information Architecture

### Left Navigation

The left navigation should contain two levels.

#### Level 1. Projects

Each project item should show at minimum:

- project name
- current stage
- project status

#### Level 2. Conversations Within The Selected Project

Each conversation item should show at minimum:

- conversation title
- associated stage if present
- associated role if present
- last updated time if practical

Actions:

- create project
- select project
- create conversation within project
- select conversation within project

### Center Workspace

The center workspace should show:

1. active conversation title
2. project and stage breadcrumbs or compact labels
3. message history
4. streaming agent response
5. input area for sending new messages

The center should remain visually dominant.

### Right Context Panel

The right panel should be always visible in V1.

It should contain three sections:

1. Workflow
2. Artifacts
3. Review

These sections may eventually become collapsible, but for V1 they should be stably visible so the user can build the habit of working against explicit project structure.

## V1 Workflow Section

The workflow section should show:

- current stage
- ordered list of all stages
- state of each stage

Required MVP stages:

1. initiative
2. requirement discussion
3. product design
4. software design
5. implementation
6. delivery acceptance

Displayed stage state values:

- not started
- in progress
- in review
- approved
- rejected
- rolled back
- invalidated

The workflow section should answer one question immediately:

`Where is this project now, and what has already been validated?`

## V1 Artifacts Section

The artifacts section should show the current stage's production outputs.

For V1 it should display:

- required artifact types for the active stage
- which required artifacts already exist
- which required artifacts are still missing
- list of current artifacts for the stage

This section should answer:

`What has this stage produced, and is it complete enough to review?`

## V1 Review Section

The review section should expose stage control actions.

For V1 it should support:

- submit stage for review
- approve stage
- reject stage
- rollback project to earlier stage

Rollback must require a recorded reason and root cause stage.

This section should answer:

`Can this project progress, stay in revision, or move backward?`

## Domain Mapping For V1

The implementation should use this model.

### 1. Project

Top-level studio container.

### 2. Conversation

Primary work thread under a project.

V1 mapping decision:

- current `session` becomes the implementation basis for `conversation`
- do not fully remove the current session concept in code immediately
- shift its business meaning toward project-scoped conversation

### 3. Message

Persistent discussion record within a conversation.

### 4. Stage Instance

Explicit workflow state attached to a project.

### 5. Artifact

Durable output produced inside a project stage.

### 6. Approval Record

Explicit owner decision about stage progress.

### 7. Rollback Record

Explicit root-cause-based backward transition record.

## Backend Scope For V1

The backend should be extended, not rewritten.

### Preserve

Keep these existing strengths:

- SQLite persistence layer
- WebSocket streaming path
- agent integration shape
- existing message flow

### Add

Add these new capability layers:

- projects
- stage instances
- generic artifacts
- approval records
- rollback records
- project-scoped conversations

### Defer

Do not attempt in V1:

- complex multi-agent orchestration
- advanced permission systems
- heavy prompt-role engines
- deep git automation
- full UI redesign beyond the required structural shift

## Proposed API Surface For V1

### Project APIs

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`

### Stage APIs

- `GET /api/projects/:projectId/stages`
- `POST /api/projects/:projectId/stages/:stageName/submit`
- `POST /api/projects/:projectId/stages/:stageName/approve`
- `POST /api/projects/:projectId/stages/:stageName/reject`
- `POST /api/projects/:projectId/rollback`

### Conversation APIs

- `GET /api/projects/:projectId/conversations`
- `POST /api/projects/:projectId/conversations`
- `GET /api/conversations/:conversationId/messages`
- `POST /api/conversations/:conversationId/messages`

### Artifact APIs

- `GET /api/projects/:projectId/artifacts`
- `POST /api/projects/:projectId/artifacts`
- `GET /api/artifacts/:artifactId`
- `PATCH /api/artifacts/:artifactId`

### Review Record APIs

- `GET /api/projects/:projectId/approvals`
- `POST /api/projects/:projectId/approvals`

### Optional Early Git APIs

- `GET /api/projects/:projectId/git-records`
- `POST /api/projects/:projectId/git-records`

## Compatibility Strategy

The current codebase is session-centric. V1 should migrate incrementally.

### Compatibility Rule

Do not break the working chat loop while introducing project structure.

### Practical Approach

1. keep existing session/message runtime behavior functioning
2. add project context above it
3. introduce new project APIs first
4. continue supporting old session APIs temporarily if needed
5. shift the frontend to project-aware flows once the new API spine exists

## Storage Implementation Plan

### New Tables To Add First

1. `projects`
2. `project_roles`
3. `stage_instances`
4. `artifacts`
5. `approval_records`
6. `stage_rollbacks`

### Existing Tables To Extend

1. `sessions`
   Add project linkage and optional stage/role linkage.

2. `messages`
   Keep the current table shape as much as possible.

3. `requirements`
   Leave intact for now, but do not treat it as the final artifact model.

### Artifact Body Storage

For V1, store artifact content with the simplest useful rule:

1. short textual content may live directly in SQLite
2. long-form content may live in filesystem-backed markdown files with SQLite references

## Suggested File-Level Refactor Plan

The current repo already has a useful structure. V1 should extend it with minimal disturbance.

### Persistence Layer

Likely files to modify:

- `src/persistence/store.ts`

Likely responsibilities to add:

- project CRUD
- stage instance initialization and updates
- artifact CRUD and versioning
- approval records
- rollback records
- project association for sessions

### Session / Conversation Layer

Likely files to modify:

- `src/session/manager.ts`

Likely responsibilities to add:

- create conversation under project
- list conversations by project
- send message by conversation within project context
- expose stage-aware operations where needed

### API Layer

Likely files to modify:

- `src/api/server.ts`

Likely responsibilities to add:

- project routes
- stage routes
- artifact routes
- review and rollback routes
- project-aware conversation routes

### Frontend Layer

Likely files to modify:

- `src/web/index.html`

Likely responsibilities to add:

- left project + conversation hierarchy
- center conversation-first workspace
- right persistent context panel
- stage actions and artifact display

## Incremental Implementation Order

### Step 1. Add Project And Stage Spine

Implement:

- project entity
- stage instance entity
- project creation with default stages
- project listing and detail APIs

Acceptance signal:

- user can create and view projects
- each project shows a valid current stage

### Step 2. Attach Conversations To Projects

Implement:

- project-aware conversations
- conversation listing under selected project
- compatibility layer for existing session logic

Acceptance signal:

- user can create conversations inside projects
- existing message loop still works

### Step 3. Add Artifact Spine

Implement:

- artifact model
- artifact creation and listing
- required artifact display for current stage

Acceptance signal:

- current stage artifacts can be persisted and shown in the right panel

### Step 4. Add Review And Rollback Actions

Implement:

- submit for review
- approve
- reject
- rollback with root cause

Acceptance signal:

- stage transitions obey approval rules
- rollback records are persisted

### Step 5. Reshape Frontend Around The New Model

Implement:

- left hierarchy
- center conversation workspace
- right context panel

Acceptance signal:

- user experiences the new project-scoped working model without losing conversation fluency

## Engineering Constraints For V1

These constraints are intentional and should not be violated casually.

1. conversation must remain the visually dominant work area
2. project must remain the outermost structural unit
3. workflow state must remain visible at all times
4. artifact presence must be visible at all times
5. rollback must be formal and recorded
6. old history must be preserved rather than overwritten
7. the first implementation should prefer minimal extension over large-scale rewrite

## What Should Be Reviewed Before Coding Starts

Before implementation begins, the following should be explicitly confirmed:

1. V1 page structure
2. V1 API surface
3. initial database migration shape
4. artifact creation approach in UI
5. whether old session routes remain temporarily exposed

## V1 Done Criteria

V1 is done when the following are true:

1. the application opens on a project-oriented left navigation
2. conversations are visibly nested within projects
3. the center remains a usable streaming conversation workspace
4. the right panel always shows current stage, artifacts, and review controls
5. stages cannot progress without explicit owner review
6. rollback is possible and recorded
7. artifact outputs are durable and inspectable
8. the system still feels like a working studio, not a disconnected collection of records

## Final Reminder

This V1 plan should be judged by whether it preserves the studio's working logic:

- human-agent dialogue stays central
- project structure keeps work organized
- workflow keeps work disciplined
- artifacts keep work durable

If a later UI adjustment preserves those truths, it is acceptable.
If a later UI adjustment breaks those truths, it should be rejected even if it looks cleaner.
