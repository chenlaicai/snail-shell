# Snail Shell MVP Scope

## Purpose

This document turns the blueprint into a concrete first release boundary.

The goal of the MVP is not to build the full vision of an agent-native software studio in one step. The goal is to build the smallest complete production loop that proves the model works.

That loop must allow the owner to create a project, move it through a strict software workflow, preserve artifacts at every important stage, and trace implementation back to code and git history.

## MVP Goal

The MVP should prove that Snail Shell can act as a local single-machine software production studio for one owner and one or more local agents.

The MVP succeeds if the owner can:

1. create a project
2. move the project through explicit stages
3. review and approve stage outputs
4. roll back to an earlier stage when root cause requires it
5. inspect the resulting artifacts, conversation records, and git traces as one coherent work history

## Product Slice

The MVP focuses on one compact workflow slice:

1. Project setup
2. Requirement discussion
3. Product design
4. Software design
5. Implementation tracking
6. Delivery acceptance

This is the minimum slice that demonstrates software production rather than just conversation.

## In Scope

### 1. Project Management

The system must support:

- creating a project
- listing projects
- opening a project workspace
- showing current project stage
- showing project status

Minimum required fields for project creation:

- name
- summary

### 2. Stage-Based Workflow

The system must support:

- fixed ordered workflow stages
- viewing current stage
- submitting a stage for review
- owner approval of a stage
- owner rejection of a stage
- rollback to an earlier stage with root cause record

The system should not allow silent stage skipping.

### 3. Role-Aware Work Structure

The system must support stage work being attributed to a role.

For MVP, roles may share the same underlying agent runtime. The important requirement is that outputs clearly indicate which studio role produced them.

Required MVP roles:

- owner
- product_agent
- design_agent
- implementation_agent
- acceptance_agent

### 4. Conversation Management

The system must support persistent conversations attached to a project.

Each conversation should ideally also be associated with:

- a stage
- a role

Minimum capabilities:

- create conversation inside a project
- send and persist messages
- stream agent output
- list conversation history

Conversation is in scope because it is part of how artifacts are produced, but it is not the final output of work.

### 5. Artifact Management

The system must support first-class artifact records.

Required MVP artifact types:

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

Minimum artifact capabilities:

- create artifact
- revise artifact
- store artifact status
- associate artifact with project, stage, and role
- mark artifact as current or superseded
- view artifacts by stage

### 6. Approval Records

The system must support explicit owner review records.

Minimum capabilities:

- approve stage outputs
- reject stage outputs
- request revision
- preserve approval note

### 7. Git Traceability

The system must support linking implementation work to git history.

Minimum capabilities:

- attach branch name
- attach commit hash
- attach commit message
- attach change summary

The MVP does not need full git automation, but it must persist git traces as first-class project records.

### 8. Delivery Acceptance

The system must support a final acceptance step.

Minimum capabilities:

- create acceptance report
- mark delivery accepted or rejected
- record unresolved issues
- preserve acceptance notes

## Out Of Scope

The following are intentionally excluded from MVP:

1. multi-user collaboration
2. remote or cloud execution
3. distributed agent scheduling
4. marketplace-style plugins
5. fine-grained agent permission systems
6. complex IDE-like editing environment
7. advanced visual workflow editor
8. automatic project planning across many simultaneous projects
9. full autonomous agent org simulation

## MVP User Experience

The MVP should provide a usable local workflow, not a polished enterprise UI.

The owner should be able to:

1. create a project
2. open the project workspace
3. see the current stage
4. open the stage conversation
5. create or inspect stage artifacts
6. approve or reject the stage
7. roll back when needed
8. inspect implementation and delivery records

This can be achieved through a minimal web UI plus backend APIs.

## MVP Screens Or Views

The MVP likely needs these views:

1. Project List
   Shows all projects and their current stage/status.

2. Project Workspace
   Shows current stage, stage history, artifact summary, and conversations.

3. Conversation View
   Allows role-scoped discussion and streaming output.

4. Artifact View
   Shows stage artifacts and their versions.

5. Approval / Rollback View
   Allows approval, rejection, and rollback recording.

These views can be compact. They do not need a heavy visual design in MVP.

## MVP API Scope

At a minimum, the backend should support APIs for:

1. project CRUD-lite
   Create, list, fetch detail.

2. stage state management
   View stage states, submit for review, approve, reject, rollback.

3. conversation management
   Create conversation, send message, list messages.

4. artifact management
   Create, list, fetch, revise.

5. approval records
   Create and list review decisions.

6. git record management
   Create and list git trace records.

7. acceptance record management
   Create and list acceptance outputs.

## MVP Data Integrity Rules

The MVP should enforce the following rules:

1. a project has exactly one active current stage
2. a later stage cannot be approved if required previous stages are not approved
3. rollback must include a root cause record
4. an artifact revision must not destroy old versions
5. approved upstream changes can invalidate downstream artifacts
6. implementation records must link back to project and stage

## What The MVP Does Not Need To Solve Yet

The MVP does not need to perfectly solve:

1. prompt engineering strategy per role
2. sophisticated multi-agent coordination
3. automatic artifact generation quality
4. complete git automation
5. full document editing ergonomics
6. long-term scaling across many operators

The MVP only needs to prove the production model and persistence model are sound.

## Suggested Implementation Phases Inside MVP

To keep the build compact, MVP implementation itself should likely proceed in this order:

### Phase A. Project And Stage Foundation

- add project entity
- add stage state model
- attach current sessions to project context

### Phase B. Artifact Foundation

- add generic artifact model
- preserve versioning and current/superseded state

### Phase C. Workflow Decisions

- add approval records
- add rollback mechanics

### Phase D. Execution Traceability

- add git records
- add validation and acceptance records

### Phase E. Basic UI Refinement

- surface project workspace, stages, artifacts, and review actions

## MVP Acceptance Criteria

The MVP should be considered complete when all of the following are true:

1. a user can create a project and see it in a project list
2. the system shows the project's current workflow stage
3. the user can hold persistent project conversations
4. the user can create required stage artifacts
5. the user can approve a stage and progress to the next one
6. the user can reject or roll back a stage with reasons recorded
7. the user can attach code and git traces during implementation
8. the user can produce an acceptance report and mark delivery outcome
9. the full project history remains inspectable afterward

## Strategic Constraint

The MVP must remain compact.

If a proposed feature does not strengthen one of the following, it should probably be deferred:

1. workflow clarity
2. artifact persistence
3. project traceability
4. delivery quality

This keeps Snail Shell aligned with the studio philosophy of subtraction over expansion.
