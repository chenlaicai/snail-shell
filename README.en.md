# Snail Shell

[中文](./README.md) | English

Snail Shell is a multi-agent collaborative workspace system that orchestrates specialized workflow roles and delegates actual execution to runtimes managed by Snail Den.

## Overview

Snail Shell manages projects through staged workflows (init -> discuss -> coding -> check -> publish). Each stage has designated roles that collaborate to produce formal artifacts.

### Core Concepts

- **Projects and stages**: Projects move through a fixed workflow, and each stage requires specific formal artifacts.
- **Roles**: Workflow responsibility identities, including product, design, implementation, and acceptance roles.
- **Snails**: Runtime executors in Snail Den that wrap an agent runtime and model.
- **Conversations**: Discussion threads inside a stage, where roles collaborate with each other through `@role_name` mentions.
- **Artifacts**: Formal deliverables, such as requirement documents, design documents, and code change records.

### Technical Architecture

- **Runtime abstraction**: Supports Claude Code CLI (stateless) and OpenCode CLI (stateful).
- **Persistence**: Uses SQLite and provides full-text search through FTS5.
- **API service**: Uses Express + WebSocket to provide REST APIs and real-time agent events.
- **Agent orchestration**: `ProjectManager` coordinates multi-agent collaboration and message routing.

## Quick Start

### Install dependencies

```bash
npm install
```

### Build the project

```bash
npm run build
```

### Start the server

```bash
npm start
```

The server starts at `http://localhost:3000`.

### Development commands

```bash
# lint
npm run lint
npm run lint:fix

# Run all checks (lint + build + test)
npm run check

# Run tests
npm run test
```

## Configuration

### LLM configuration

Configure OpenAI in `config/llm.json`:

```json
{
  "provider": "openai",
  "openai": {
    "api_key": "your-api-key",
    "model": "gpt-4",
    "base_url": "https://api.openai.com/v1",
    "timeout_ms": 30000
  }
}
```

### Metadata configuration

- `.meta/stages.json`: defines workflow stages.
- `.meta/roles.json`: defines workflow roles.
- `.meta/snails.json`: defines Snail Den runtime executors.
- `.meta/artifact-types.json`: defines artifact types.

## API Usage

### Create a project

```bash
POST /api/projects
{
  "name": "Project name",
  "description": "Project description"
}
```

### Send a message

```bash
POST /api/conversations/:id/messages
{
  "from_role": "Owner Role",
  "parts": [
    { "kind": "text", "payload": { "text": "Message content", "mentions": [] } }
  ]
}
```

### Advance a stage

```bash
POST /api/projects/:id/advance
```

### Search history

```bash
GET /api/conversations/:id/history/search?query=keyword
```

## Database

The development database is located at `data/snail-shell.db` and uses SQLite to store projects, conversations, messages, and artifacts.

## Project Structure

```text
src/
├── agent/          # AI agent runtime adapters
├── api/            # REST API and WebSocket service
├── llm/            # OpenAI integration
├── persistence/    # database operations
├── project/        # project management and collaboration logic
└── types/          # TypeScript definitions

.meta/              # metadata configuration
config/             # runtime configuration
tests/              # tests
```

## Repository Collaboration

- GitHub Actions runs `npm run check` on `main` and on pull requests.
- Pull request templates capture motivation, affected areas, risks, and verification steps.
- Security issues should be reported privately through GitHub Security Advisories.

## Documentation Language Rules

- `README.md` is written in Chinese.
- `README.en.md` is written in English and must stay aligned with `README.md`.
- `CONTRIBUTING.md` is written in English.
- `SECURITY.md` is written in English.
- `.github/pull_request_template.md` is written in English.
- `.github/ISSUE_TEMPLATE/*` is written in English.
- The GitHub repository `About` section, including Description, Homepage, and Topics, is written in English.
- Requirement documents, design documents, analysis documents, discussion notes, and stage output documents are written in Chinese.
- Files under `.meta/` only use English keys and code-facing conventions, without separate Chinese and English copies.

## License

MIT
