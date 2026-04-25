# Snail Shell Coding Checklist V1

## Purpose

This checklist translates the V1 implementation plan into an execution sequence for coding.

The checklist is intentionally explicit so implementation does not drift away from the agreed product shape.

## Guardrails Before Coding

These guardrails must remain true throughout implementation:

1. conversation remains the main work surface
2. project remains the outermost organizational unit
3. workflow, artifacts, and review stay visible as context
4. V1 extends the current codebase rather than replacing it wholesale
5. old chat behavior should remain functional during migration

## Round 1 Goal

At the end of the first coding round, the system should support:

1. project list in the left navigation
2. project-scoped conversations under each project
3. current conversation in the center workspace
4. current stage and stage list in the right panel
5. current stage artifacts in the right panel
6. basic submit / approve / reject / rollback actions in the right panel

This round does not need to fully polish every artifact workflow. It must establish the spine.

## Step 1. Persistence Foundation

### Objective

Add the minimum new persistence structures needed for projects, stages, artifacts, approvals, and rollbacks.

### Files Likely To Change

- `src/persistence/store.ts`

### Tasks

1. add `Project` type
2. add `StageInstance` type
3. add `Artifact` type
4. add `ApprovalRecord` type
5. add `RollbackRecord` type
6. add SQL schema creation for:
   - `projects`
   - `stage_instances`
   - `artifacts`
   - `approval_records`
   - `stage_rollbacks`
7. extend current session storage with project linkage
8. add store methods for:
   - create project
   - list projects
   - get project
   - initialize default project stages
   - list project stages
   - create artifact
   - list artifacts by project and stage
   - create approval record
   - create rollback record

### Notes

Use the smallest schema that supports the agreed V1 model.

Do not overbuild generalized workflow engines yet.

### Acceptance Check

1. project records persist
2. each new project creates default stages
3. artifacts can be inserted and listed
4. approvals and rollbacks can be inserted and listed

## Step 2. Session To Conversation Bridging

### Objective

Keep current chat behavior, but bind it to project context.

### Files Likely To Change

- `src/session/manager.ts`
- possibly `src/index.ts` exports

### Tasks

1. define project-aware conversation semantics in the manager layer
2. add methods to:
   - create conversation inside a project
   - list conversations by project
   - get conversation detail if needed
3. preserve existing send-message behavior for a selected conversation
4. ensure messages remain attached to the right project-linked conversation
5. keep WebSocket streaming behavior intact

### Notes

Internally, it is acceptable if code still uses some `session` naming during V1, as long as the product behavior is project -> conversation.

### Acceptance Check

1. a conversation can be created under a project
2. existing chat still streams correctly
3. project navigation can resolve its conversation list

## Step 3. Project APIs

### Objective

Expose the project spine through stable APIs.

### Files Likely To Change

- `src/api/server.ts`

### Tasks

1. add `GET /api/projects`
2. add `POST /api/projects`
3. add `GET /api/projects/:projectId`
4. add `GET /api/projects/:projectId/stages`
5. add `GET /api/projects/:projectId/conversations`
6. add `POST /api/projects/:projectId/conversations`
7. keep old session routes temporarily if useful

### Notes

Do not remove legacy routes in the first round unless there is a strong reason.

### Acceptance Check

1. frontend can load projects
2. frontend can load stages for selected project
3. frontend can create and load project conversations

## Step 4. Artifact And Review APIs

### Objective

Expose the right-panel workflow context through backend APIs.

### Files Likely To Change

- `src/api/server.ts`
- `src/session/manager.ts`

### Tasks

1. add `GET /api/projects/:projectId/artifacts`
2. add `POST /api/projects/:projectId/artifacts`
3. add `POST /api/projects/:projectId/stages/:stageName/submit`
4. add `POST /api/projects/:projectId/stages/:stageName/approve`
5. add `POST /api/projects/:projectId/stages/:stageName/reject`
6. add `POST /api/projects/:projectId/rollback`
7. ensure rollback requires reason and root cause stage
8. make stage progression obey the agreed workflow order

### Notes

For V1, artifact creation can stay simple. It is enough to create structured records with text content.

### Acceptance Check

1. right panel can load artifacts for current stage
2. stage can be submitted and approved
3. rejection returns stage to a working state
4. rollback is recorded and reflected in stage state

## Step 5. Frontend Navigation Reshape

### Objective

Turn the current session-first UI into a project-first hierarchy while preserving conversation centrality.

### Files Likely To Change

- `src/web/index.html`

### Tasks

1. replace session-only left navigation with:
   - project list
   - conversation list under selected project
2. add create project action
3. add create conversation action inside current project
4. keep center area as the largest region for the active conversation
5. show compact project and stage context near the conversation header

### Notes

This step must preserve the design intent:

- the UI is not becoming a project board
- it is becoming a conversation-centered workspace with project structure

### Acceptance Check

1. user can switch projects from the left side
2. user can switch conversations under a project
3. message area remains central and usable

## Step 6. Right Context Panel

### Objective

Add the persistent context panel for workflow, artifacts, and review.

### Files Likely To Change

- `src/web/index.html`

### Tasks

1. add `Workflow` section
2. add `Artifacts` section
3. add `Review` section
4. load current stage and all stage states
5. show required artifacts for current stage
6. show existing artifacts for current stage
7. add submit / approve / reject / rollback controls

### Notes

The panel should be visually secondary to the center, but always present.

### Acceptance Check

1. workflow state is always visible
2. current stage artifacts are visible
3. review controls are usable without leaving the conversation workspace

## Step 7. Stage Rules And Artifact Minimums

### Objective

Enforce the minimum agreed workflow discipline.

### Files Likely To Change

- `src/session/manager.ts`
- `src/persistence/store.ts`
- possibly small shared constants/modules if needed

### Tasks

1. define the fixed stage order in code
2. define minimum artifact requirements by stage
3. prevent advancing to the next stage without approval
4. prevent rollback without recorded reason
5. mark downstream stages invalidated when rollback occurs

### Notes

Keep the rules explicit and small. Do not build a generic rules engine.

### Acceptance Check

1. invalid transitions are rejected
2. rollback updates downstream stage states
3. required artifact checks are applied consistently

## Step 8. Basic Verification

### Objective

Make sure the new project spine works without breaking the current runtime.

### Files Likely To Change

- `src/integration-test.ts`
- possibly add one or more small test files

### Tasks

1. extend integration coverage for:
   - project creation
   - default stage creation
   - conversation creation under project
   - artifact creation
   - stage approval
   - rollback recording
2. verify existing message flow still works

### Acceptance Check

1. project flow is testable end-to-end
2. old chat behavior remains working

## Suggested Execution Order Summary

Implement in this order:

1. persistence foundation
2. project-aware conversation manager
3. project APIs
4. artifact and review APIs
5. left navigation reshape
6. right context panel
7. workflow rules
8. verification and cleanup

## Things To Avoid During This Round

Do not add these unless explicitly re-approved:

1. React migration
2. complex component architecture
3. advanced role runtime orchestration
4. heavy artifact editor system
5. broad refactor of unrelated files
6. aggressive renaming that breaks the current working behavior

## Round 1 Review Questions

Before starting code, these questions should be answerable:

1. are we still treating conversation as the main work area?
2. are projects clearly the outermost container?
3. are workflow and artifacts visible as context, not the main canvas?
4. is the migration path incremental rather than destructive?
5. is the first round small enough to finish cleanly?

## Ready-To-Code Condition

Coding should start only when this is accepted:

1. the checklist order is acceptable
2. the scope is small enough for one implementation round
3. the UI intent is preserved
4. the migration strategy is acceptable

Once those are true, implementation can begin.
