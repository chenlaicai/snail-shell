# Snail Shell Blueprint

## Product Definition

Snail Shell is an agent-native software production studio.

It is not a chat app, not a generic workflow engine, and not an IDE replacement. It is a local-first studio system where one human owner coordinates multiple AI agents to produce software through a clear software delivery process.

The core unit of management is not the agent itself, but the work artifact the agent leaves behind.

## Target User

Primary user: the studio owner.

At the current stage, the system serves one human operator running a local single-machine studio. The machine may host multiple agents, but the studio still has a single owner who initiates work, reviews outputs, makes tradeoffs, and accepts delivery.

## Vision

Build a compact software studio where software projects can move from idea to delivery through a structured, persistent, inspectable process.

The long-term value of Snail Shell is not just helping an agent answer questions. The value is making software production legible:

- every stage has a purpose
- every role has a responsibility
- every handoff has inputs and outputs
- every artifact is persisted and organized
- every decision leaves a trace

## Core Principles

### 1. Subtraction Over Expansion

Snail Shell should stay small and disciplined.

The goal is not to simulate a giant company with excessive process. The goal is to maintain a compact studio scale with only the minimum structure needed to reliably produce software.

Every new concept must justify itself through clearer work organization or better delivery quality.

### 2. Trust Agent Capability

The system should assume AI agents are capable workers.

Snail Shell should not heavily intrude into the internal reasoning style or execution style of the underlying agents. It should avoid over-controlling how agents think. Instead, it should focus on:

- assigning roles
- defining stage boundaries
- structuring artifacts
- recording outputs
- connecting work across stages

The system manages production context, not the internal cognition of agents.

### 3. Artifact-Centric Persistence

All meaningful work must leave durable traces.

Work content must not be scattered across temporary chat fragments, shell logs, or unstructured files. Snail Shell should organize all production artifacts into persistent, queryable, stage-aware records.

This includes at least:

- discussions
- decisions
- requirements
- product documents
- design documents
- implementation tasks
- code changes
- git records
- acceptance results

## Product Frame

Snail Shell is best understood as a software production operating surface built around four layers:

1. Workflow layer
   Defines the software delivery stages and the expected input/output for each stage.

2. Role layer
   Defines which agent role is responsible for which type of work.

3. Artifact layer
   Defines what persistent outputs must exist after each meaningful step.

4. Traceability layer
   Connects artifacts, conversations, code, and git history into one inspectable chain.

## Core Scenario

The primary end-to-end scenario is:

1. The owner creates a new software initiative.
2. The owner discusses intent, goals, constraints, and expected outcomes.
3. The studio converts that discussion into structured requirements.
4. Product design artifacts are produced.
5. Software design artifacts are produced.
6. Implementation work is executed by one or more agents.
7. Code changes and git records are attached to the work.
8. Delivery is reviewed and accepted.
9. The full chain remains inspectable afterward.

Expressed more simply:

idea -> requirement discussion -> product design -> software design -> implementation -> delivery acceptance

## Studio Model

The studio behaves like a compact company, except the workers are agents.

The human owner remains the final authority. Agents are organized into roles with bounded responsibilities. Each role participates in a stage of work and produces explicit outputs.

Initial role model for MVP:

1. Owner
   Initiates projects, gives direction, reviews outputs, approves transitions, and accepts delivery.

2. Product Agent
   Converts intention into structured requirements and product-facing definitions.

3. Design Agent
   Produces software design artifacts from approved product intent.

4. Implementation Agent
   Turns approved designs into code and associated git history.

5. Acceptance Agent
   Organizes delivery checks, validation records, and acceptance summaries.

These roles do not need to be different model providers or different runtimes in MVP. The important thing is role identity, stage responsibility, and output structure.

## Workflow Blueprint

### Stage 1. Initiative

Purpose: establish what is being built and why.

Inputs:

- owner intent
- background context
- goals and constraints

Outputs:

- initiative record
- initial discussion log
- project scope statement

### Stage 2. Requirement Discussion

Purpose: turn raw intent into explicit requirements.

Inputs:

- initiative record
- owner conversations

Outputs:

- requirement list
- requirement descriptions
- assumptions
- open questions
- priority or phase hints

### Stage 3. Product Design

Purpose: define product behavior and user-facing structure.

Inputs:

- approved requirements

Outputs:

- product spec
- interaction flow
- business rules
- acceptance criteria draft

### Stage 4. Software Design

Purpose: define the implementation structure.

Inputs:

- product spec
- requirements

Outputs:

- technical design doc
- module boundaries
- data model decisions
- interface definitions
- implementation plan

### Stage 5. Implementation

Purpose: produce the software artifacts.

Inputs:

- approved technical design
- implementation tasks

Outputs:

- code changes
- commit records
- implementation notes
- test results

### Stage 6. Delivery Acceptance

Purpose: verify completion and preserve delivery status.

Inputs:

- code and git outputs
- acceptance criteria
- validation results

Outputs:

- acceptance summary
- unresolved issues
- delivery record

## MVP Scope

The MVP should focus on a complete but compact production loop.

### Must Have

1. Project or initiative workspace
   A top-level container for one software effort.

2. Work content system
   Persistent management for documents, conversations, code references, and git records.

3. Explicit workflow model
   The system must know the major delivery stages and keep work organized by stage.

4. Role-aware execution
   Work should be attributable to a role, even if multiple roles share the same underlying agent engine.

5. Structured artifacts
   Each stage must produce persistent outputs instead of only freeform chat.

6. Traceability
   A user must be able to inspect how a delivery was produced across conversation, document, code, and git history.

7. Local single-machine operation
   The whole MVP runs locally, even if several agents operate within the same machine.

### Nice to Have, But Not Required Yet

- richer web UI for studio dashboards
- role-specific prompt packs
- automated stage transition suggestions
- artifact templates
- acceptance report generation

## Non-Goals

The following are intentionally out of scope for the current stage:

1. Multi-user collaboration
2. Cloud sync or remote workspace orchestration
3. Large-scale organization simulation
4. Plugin marketplace or open extension ecosystem
5. Full control over agent internals
6. Replacing the local IDE or terminal entirely

## Core Domain Objects

The current codebase already contains some of the right primitives, but the blueprint should formalize the target model.

Recommended primary objects:

1. Initiative
   A software project or workstream initiated by the owner.

2. Stage
   A named step in the delivery workflow.

3. Role
   A studio responsibility assigned to an agent identity.

4. Conversation
   A persistent dialogue attached to an initiative and usually scoped to a role or stage.

5. Artifact
   A durable work output such as a requirement doc, product spec, technical design, implementation note, or acceptance report.

6. Requirement
   A structured unit of product intent tracked through the workflow.

7. Work Item
   An executable task or delivery unit derived from requirements or design.

8. Code Record
   A link from work items to changed files, branches, commits, or verification outputs.

9. Delivery Record
   The final acceptance state of a body of work.

## Artifact Strategy

Snail Shell should treat artifacts as first-class objects, not side effects.

For MVP, artifact categories should be explicit:

1. Discussion artifacts
   Conversation logs, summaries, key decisions.

2. Planning artifacts
   Requirement lists, project scope, milestone definitions.

3. Design artifacts
   Product specs and technical designs.

4. Execution artifacts
   Tasks, implementation notes, test results.

5. Delivery artifacts
   Acceptance reports, issue lists, final status.

6. Source-control artifacts
   Branch names, commits, diffs, and release markers.

Every artifact should eventually answer:

- who created it
- in which stage it was created
- which initiative it belongs to
- what it references
- what supersedes it, if applicable

## Relationship To Agents

Agents are workers inside the studio, not the studio itself.

Snail Shell should not overfit to one agent vendor or one reasoning pattern. The system should remain compatible with multiple underlying agents as long as they can:

- receive context
- perform work
- emit outputs
- leave inspectable artifacts

The platform should manage role, workflow, and persistence around the agents rather than forcing agent-specific behavior deep into the core model.

## Architectural Direction

Based on the current codebase, the architecture should evolve in this order:

1. From session-centric to initiative-centric
   Sessions should become one kind of work surface inside a broader initiative.

2. From chat records to artifact records
   Conversation remains important, but documents and delivery records must become equal citizens.

3. From generic messages to stage-aware work logs
   The system should know whether content belongs to requirement discussion, product design, implementation, or acceptance.

4. From single-agent interaction to role-based multi-agent coordination
   Even on one machine, the model should support multiple active roles.

## Immediate Design Implications For This Repo

The existing repository suggests a good early base, but the next blueprint-driven changes will likely be:

1. Introduce initiative/project as a first-class entity above session.
2. Add stage and role metadata to sessions, conversations, or artifacts.
3. Expand persistence from sessions/messages/requirements into a broader artifact model.
4. Define a standard artifact schema and storage layout.
5. Connect git records to implementation and delivery artifacts.
6. Add stage transition rules instead of only freeform conversation.

## Success Criteria For MVP

The MVP is successful if the owner can do the following on one machine:

1. Create a software initiative.
2. Discuss and persist requirements in an organized way.
3. Move work through product design, software design, implementation, and acceptance.
4. Use one or more agents under explicit studio roles.
5. Inspect the resulting artifacts, conversations, code changes, and git history as one coherent production record.

## Open Questions

These should guide the next round of design work:

1. Should initiative, session, and conversation be separate entities or should session be upgraded into initiative?
2. What is the minimum artifact taxonomy needed for MVP?
3. How strict should stage transitions be?
4. How should role identity be represented when multiple roles share one agent runtime?
5. Should documents live only in SQLite metadata, only in the filesystem, or in a hybrid model?
6. What is the minimal git trace model needed for implementation and acceptance stages?
7. What is the smallest useful multi-agent coordination mechanism for a local single-machine studio?

## Proposed Next Documents

After this blueprint, the next useful documents are:

1. `docs/domain-model.md`
   Define entities, relationships, and lifecycle states.

2. `docs/workflow.md`
   Define stage transitions, role responsibilities, and required outputs.

3. `docs/mvp-scope.md`
   Translate the blueprint into a concrete first delivery slice.
