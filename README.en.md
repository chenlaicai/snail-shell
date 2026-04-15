# Snail Shell

[中文](./README.md) | English

Snail Shell is a multi-agent collaborative workspace system that orchestrates specialized AI agents ("snails") through a structured workflow.

## Overview

Snail Shell manages projects through staged workflows (init -> discuss -> coding -> check -> publish). Each stage involves specific snails collaborating to produce formal artifacts.

### Core Concepts

- **Projects and stages**: Projects move through a fixed workflow, and each stage requires specific formal artifacts.
- **Snails**: AI agents with distinct roles such as product, design, implementation, and acceptance.
- **Conversations**: Discussion threads inside a stage where snails collaborate via `@snail_name` mentions.
- **Artifacts**: Formal deliverables such as requirement documents, design documents, and code change records.

### Technical Architecture

- **Runtime abstraction**: Supports Claude Code CLI (stateless) and OpenCode CLI (stateful).
- **Persistence**: SQLite with full-text search via FTS5.
- **API service**: Express + WebSocket for REST APIs and real-time agent events.
- **Agent orchestration**: `ProjectManager` coordinates collaboration and message routing.

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
# Lint
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

- `.meta/stages.json`: defines workflow stages
- `.meta/snails.json`: defines snail roles
- `.meta/artifact-types.json`: defines artifact types

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
  "snail_name": "owner",
  "parts": [
    { "type": "text", "content": "Message content" }
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

The development database is located at `data/snail-shell.db` and stores projects, conversations, messages, and artifacts in SQLite.

## Project Structure

```text
src/
├── agent/          # runtime adapters for AI agents
├── api/            # REST API and WebSocket service
├── llm/            # OpenAI integration
├── persistence/    # database operations
├── project/        # project management and collaboration logic
└── types/          # TypeScript definitions

.meta/              # metadata configuration
config/             # runtime configuration
tests/              # tests
```

## Collaboration

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
- Files under `.meta/` use English keys and code-facing conventions only, without separate Chinese and English copies.

## License

MIT
