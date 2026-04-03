# Snail Shell Workflow

## Purpose

This document defines the software production workflow for Snail Shell.

The workflow is intentionally strict. A project moves forward through explicit stage approvals. Later-stage discoveries do not silently patch earlier mistakes. If root cause analysis shows that a previous stage was wrong or incomplete, the workflow must roll back to that stage and restart from there.

This preserves production discipline, reduces hidden inconsistency, and keeps artifacts trustworthy.

## Workflow Principles

### 1. Stage-Based Production

Software work is organized into explicit stages. Each stage has:

- a purpose
- a responsible role
- required inputs
- required outputs
- approval criteria

No stage exists just for status tracking. Every stage must change the shape of the project by producing new artifacts.

### 2. Approval Before Progression

A stage is not complete because an agent said it is complete.

A stage is complete only when:

- required outputs exist
- outputs are reviewable
- the owner approves the stage

Only then may the project move to the next stage.

### 3. Root-Cause-Based Rollback

If a problem is discovered in a later stage, the project must not be patched forward by default.

The system must first determine where the problem originated.

If the root cause belongs to an earlier stage, the workflow must roll back to that stage. Work then resumes from that earlier stage and later stages must be regenerated or revised accordingly.

### 4. Artifact Over Conversation

Conversation supports production but does not replace production outputs.

Stage completion is based on artifacts, not on freeform chat history.

## Stage Overview

The MVP workflow uses six stages:

1. Initiative
2. Requirement Discussion
3. Product Design
4. Software Design
5. Implementation
6. Delivery Acceptance

The default project state is linear, but rollback is allowed when formally justified.

## Stage Definitions

### Stage 1. Initiative

Purpose:
Establish the project and define why it exists.

Primary role:
Owner

Supporting role:
Product Agent

Inputs:

- owner intent
- background context
- goals
- constraints

Required outputs:

- Project Charter
- Initiative Discussion Record

Approval criteria:

- the project has a clear name
- the project has a clear goal statement
- the project scope is bounded enough to continue
- major constraints are captured

Exit condition:
Owner approves project initiation.

### Stage 2. Requirement Discussion

Purpose:
Convert project intent into explicit, reviewable requirements.

Primary role:
Product Agent

Supporting role:
Owner

Inputs:

- Project Charter
- Initiative Discussion Record

Required outputs:

- Requirement Document
- Requirement Item List
- Open Questions List

Approval criteria:

- core functional requirements are explicit
- non-functional constraints are captured if relevant
- assumptions are recorded
- unresolved items are clearly marked
- requirements are specific enough for product design

Exit condition:
Owner approves the requirement baseline.

### Stage 3. Product Design

Purpose:
Define intended user-facing behavior and product structure.

Primary role:
Product Agent

Supporting role:
Owner

Inputs:

- approved Requirement Document
- Requirement Item List

Required outputs:

- Product Specification
- User Flow Definition
- Acceptance Criteria Draft

Approval criteria:

- the product behavior is understandable end-to-end
- major flows are covered
- business rules and edge expectations are documented
- acceptance direction is concrete enough for technical design

Exit condition:
Owner approves the product specification.

### Stage 4. Software Design

Purpose:
Translate product intent into implementable software structure.

Primary role:
Design Agent

Supporting roles:

- Product Agent
- Owner

Inputs:

- approved Product Specification
- approved Requirement Document

Required outputs:

- Technical Design
- Data and Interface Decisions
- Implementation Task Breakdown

Approval criteria:

- implementation boundaries are clear
- major modules and data shapes are defined
- key technical tradeoffs are explained
- work is decomposed into executable implementation tasks

Exit condition:
Owner approves the technical design baseline.

### Stage 5. Implementation

Purpose:
Produce software changes from approved design.

Primary role:
Implementation Agent

Supporting role:
Owner

Inputs:

- approved Technical Design
- Implementation Task Breakdown

Required outputs:

- Code Change Record
- Git Record Set
- Validation Record

Approval criteria:

- code changes map back to approved work items
- git history is attached to the work record
- validation evidence exists
- implementation aligns with approved design or deviations are documented

Exit condition:
Owner approves the implementation delivery for acceptance review.

### Stage 6. Delivery Acceptance

Purpose:
Verify whether the delivered work satisfies the intended scope.

Primary role:
Acceptance Agent

Supporting role:
Owner

Inputs:

- Code Change Record
- Git Record Set
- Acceptance Criteria Draft
- Validation Record

Required outputs:

- Acceptance Report
- Delivery Decision
- Residual Issues List

Approval criteria:

- delivered work is checked against acceptance criteria
- pass/fail status is explicit
- unresolved issues are recorded
- final delivery state is clear

Exit condition:
Owner accepts or rejects the delivery.

## Mandatory MVP Artifacts By Stage

For MVP, the following artifact types are mandatory:

1. Initiative
   - Project Charter
   - Initiative Discussion Record

2. Requirement Discussion
   - Requirement Document

3. Product Design
   - Product Specification

4. Software Design
   - Technical Design
   - Implementation Task Breakdown

5. Implementation
   - Code Change Record
   - Git Record Set

6. Delivery Acceptance
   - Acceptance Report

## Approval Model

Each stage should support the following approval states:

1. `not_started`
2. `in_progress`
3. `in_review`
4. `approved`
5. `rejected`
6. `rolled_back`

Recommended approval rules:

1. A stage enters `in_progress` when work starts.
2. A stage enters `in_review` when required outputs are present.
3. Only the owner can mark a stage `approved`.
4. If the owner rejects the outputs, the stage returns to `in_progress`.
5. If a later-stage problem traces back to this stage, the stage becomes `rolled_back` and becomes the active stage again.

## Rollback Model

Rollback is a first-class workflow action, not an exception.

### Trigger

Rollback may be triggered when:

- a requirement is wrong or incomplete
- product behavior was designed against the wrong requirement baseline
- technical design conflicts with product intent
- implementation reveals design infeasibility
- acceptance reveals upstream defects

### Required Rollback Procedure

When a problem is found:

1. Create a Root Cause Record.
2. Identify the earliest stage responsible for the defect.
3. Mark all downstream stages as invalidated.
4. Roll the project back to the responsible stage.
5. Revise outputs from that stage onward.
6. Re-run approvals in sequence.

### Rollback Rule

The workflow must roll back to the earliest stage that must change for the project to become coherent again.

Do not patch later artifacts while keeping known-invalid upstream artifacts approved.

## Handoff Rules

Each stage handoff should preserve explicit links between:

- input artifacts
- output artifacts
- producing role
- approving owner
- decision notes

This means every major stage transition should answer:

1. What was used as input?
2. What new outputs were produced?
3. Who produced them?
4. Who approved them?
5. What changed from the previous baseline?

## Workflow Events

The system should eventually model these events explicitly:

1. Project created
2. Stage entered
3. Artifact created
4. Artifact revised
5. Stage submitted for review
6. Stage approved
7. Stage rejected
8. Root cause recorded
9. Stage rolled back
10. Delivery accepted
11. Delivery rejected

## Minimal MVP System Behavior

For the workflow to be useful in MVP, Snail Shell should be able to:

1. show the current stage of a project
2. show which artifacts are required for the current stage
3. prevent stage progression before approval
4. record who produced and approved each artifact
5. record rollback reason and affected stages
6. preserve prior artifacts instead of deleting history

## Example Flow

Example:

1. Owner creates project.
2. Product Agent produces Requirement Document.
3. Owner approves requirement stage.
4. Product Agent produces Product Specification.
5. Owner approves product design stage.
6. Design Agent produces Technical Design and task breakdown.
7. Owner approves software design stage.
8. Implementation Agent writes code and attaches commits.
9. During acceptance, a key user flow is found to be missing.
10. Root cause analysis shows the flow was never specified in product design.
11. The project rolls back to Product Design.
12. Product Specification is revised.
13. Software Design is revised.
14. Implementation is revised.
15. Acceptance runs again.

This is the intended behavior, not a failure of the system.
