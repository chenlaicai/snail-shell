# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General Principles

- Communicate in Chinese (中文) when interacting with users in this project.

## Project Overview

Snail Shell is a multi-agent collaborative workspace system that orchestrates conversations between specialized AI agents ("snails") through a structured workflow. The system manages projects through stages (init → discuss → coding → check → publish), with each stage having designated snails that collaborate to produce formal artifacts.

## Build and Development Commands

```bash
# Build the project
npm run build

# Run linting
npm run lint
npm run lint:fix

# Run all checks (lint + build + test)
npm run check

# Run tests
npm run test

# Start the server (builds first)
npm start

# Development database location
data/snail-shell.db
```

## Architecture

### Core Concepts

**Projects and Stages**: Projects progress through a fixed workflow of stages defined in `.meta/stages.json`. Each stage has:
- Required formal artifact types that must be produced before advancing
- Designated snails that participate in that stage
- Input artifacts from previous stages and output requirements

**Snails**: AI agents with specific roles defined in `.meta/snails.json`:
- `owner`: Human user (boss), uses Claude Code CLI
- `product_agent`: Product/requirements analysis, uses OpenCode CLI
- `design_agent`: Architecture and technical design, uses OpenCode CLI
- `implementation_agent`: Code implementation, uses Claude Code CLI
- `acceptance_agent`: Validation and acceptance, uses OpenCode CLI

**Conversations**: Discussion threads within a stage where snails collaborate. Each conversation:
- Belongs to a project and stage
- Has a default snail and list of participating snails
- Contains messages with structured parts (text, mentions, quotes, results)
- Can mention other snails using `@snail_name` to dispatch work

**Artifacts**: Formal deliverables produced during stages (e.g., project_charter, requirement_document, code_change_record). Artifacts are tracked and must satisfy stage requirements before advancing.

### Runtime Architecture

**Stateless vs Stateful Runtimes**:
- Claude Code CLI: Stateless, receives full conversation context each turn
- OpenCode CLI: Stateful, maintains session state across turns after bootstrap

The system abstracts these differences through `SnailRuntime` interface in `src/agent/interface.ts`. The `ProjectManager` coordinates all interactions through the `ConversationStore` (SQLite database).

### Key Components

**src/persistence/store.ts**: `ConversationStore` class manages all database operations using better-sqlite3. Schema includes projects, stages, conversations, messages (with parts), artifacts, and message dispatches. Full-text search is implemented via SQLite FTS5 for conversation history.

**src/project/manager.ts**: `ProjectManager` is the main orchestration layer. It:
- Creates and advances projects through stages
- Manages conversations and message routing
- Handles snail mentions and dispatches
- Generates conversation summaries via OpenAI
- Coordinates between snails and their runtimes

**src/project/collaboration.ts**: Implements the multi-turn collaboration protocol where snails can mention each other up to MAX_COLLABORATION_TURNS times before forcing wrap-up.

**src/agent/**: Runtime adapters for different agent CLIs:
- `claude-code.ts`: Spawns `claude` CLI with `--no-session-persistence` and stream-json format
- `opencode.ts`: Spawns `opencode` CLI with session management
- `prompt-mapper.ts`: Converts Snail Shell's structured context into runtime-specific formats

**src/api/server.ts**: Express + WebSocket server exposing REST API and real-time agent events. WebSocket clients subscribe to conversation_id for streaming agent responses.

**src/llm/**: OpenAI integration for conversation summaries and mention extraction (fallback when structured mentions aren't provided).

### Database Schema

The SQLite schema (`src/persistence/schema.ts`) uses:
- Foreign keys with cascading deletes
- JSON columns for arrays (participating_snails, formal_artifacts, runtime_sessions)
- FTS5 virtual table (message_search) for full-text search
- Automatic timestamps (created_at, updated_at)

Messages are stored with separate `message_part` records for structured content (text, mention, quote, result parts).

## Configuration

**config/llm.json**: OpenAI API configuration for conversation summaries and mention extraction. Required fields:
- `provider`: Must be "openai"
- `openai.api_key`: API key
- `openai.model`: Model name
- `openai.base_url`: Optional custom endpoint
- `openai.timeout_ms`: Request timeout

**.meta/**: JSON configuration files defining stages, snails, and artifact types. These are loaded at runtime and drive the workflow logic.

## Testing

Tests are in `tests/` and run via compiled JavaScript:
- `tests/agent/opencode-parser-test.js`: OpenCode output parsing
- `tests/integration/integration-test.js`: End-to-end workflow tests
- `tests/persistence/persistence-test.js`: Database operations

The test command runs lint, build, then executes test files directly with node.

## Important Patterns

**Message Parts**: Messages are structured as arrays of parts with types: text, mention, quote, result. This enables rich interactions like quoting previous messages or explicitly mentioning snails.

**Dispatch System**: When a snail mentions another snail, a `message_dispatch` record is created with status pending/seen/consumed/skipped. The mentioned snail processes pending dispatches on its next turn.

**Stage Advancement**: Requires all formal artifacts to be created and marked. The system validates that artifact types match stage requirements before allowing advancement.

**Session Management**: OpenCode maintains per-conversation, per-snail session IDs stored in `conversation.runtime_sessions`. Claude Code is always stateless.

## Common Workflows

**Creating a project**: POST /api/projects → creates project, initial stage, and first conversation with stage-appropriate snails.

**Sending a message**: POST /api/conversations/:id/messages with parts array → triggers collaboration protocol, may invoke multiple snails if mentions are present.

**Advancing stages**: POST /api/projects/:id/advance → validates formal artifacts, completes current stage, creates next stage and conversation.

**Searching history**: GET /api/conversations/:id/history/search?query=... → uses FTS5 to find relevant messages with BM25 ranking.
