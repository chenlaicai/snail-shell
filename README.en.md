# Snail Shell

[中文](./README.md) | English

Snail Shell is a multi-agent collaborative workspace system that orchestrates specialized workflow roles and delegates actual execution to runtimes managed by Snail Den.

## Overview

Snail Shell manages workspaces through staged workflows (init -> discuss -> coding -> check -> publish). Each stage has designated roles that collaborate to produce formal artifacts.

### Core Concepts

- **Workspaces and stages**: Workspaces move through a fixed workflow, and each stage requires specific formal artifacts.
- **Roles**: Workflow responsibility identities, including product, design, implementation, and acceptance roles.
- **Snails**: Runtime executors in Snail Den that wrap an agent runtime and model.
- **Conversations**: Discussion threads inside a stage, where roles collaborate with each other through `@role_name` mentions.
- **Artifacts**: Formal deliverables, such as requirement documents, design documents, and code change records.

### Technical Architecture

- **Runtime abstraction**: Supports Claude Code CLI (stateless) and OpenCode CLI (stateful).
- **Persistence**: Uses SQLite and provides full-text search through FTS5.
- **API service**: Uses Express + WebSocket to provide REST APIs and real-time agent events.
- **Agent orchestration**: `IssueCollaboration` coordinates multi-agent collaboration and message routing.

## Quick Start

### Install dependencies

```bash
npm install
```

### Build the backend

```bash
npm run build
```

### Configure local ports

No configuration is required by default: the backend listens on `3000`, and the Web dev server listens on `5173`.

To change ports, copy the example config:

```bash
cp config/server.yaml.example config/server.yaml
```

Then edit `config/server.yaml`:

```yaml
# Backend HTTP listen port
port: 3000

# Web Vite dev server listen port
web_port: 5173
```

### Start in the background

```bash
npm run service:start
```

This starts both the backend and Web UI in the background without occupying the current terminal. The service script first checks whether configured ports are already in use and only reports running after the services are actually listening. Logs are written to:

- `logs/snail-shell.YYYY-MM-DD.log` — structured JSON logs from backend (primary log location)
- `logs/web.YYYY-MM-DD.log` — frontend performance logs
- `logs/server.log` — process-level output (non-pino, for startup failure debugging)
- `logs/web.log` — Vite process output

Common service commands:

```bash
npm run service:status
npm run service:stop
npm run service:restart
```

If startup fails, run `npm run service:status` to see whether `port` / `web_port` is occupied by another PID, then check the corresponding log.

Open the Web UI at `http://127.0.0.1:5173/` by default.

### Start backend and Web separately

Start the backend:

```bash
npm start
```

The backend starts at `http://localhost:3000` by default.

Start the Web UI in another terminal:

```bash
npm run web
```

The Web UI starts at `http://127.0.0.1:5173/` by default. Use this Web URL during development; Vite reads `config/server.yaml` and proxies `/api` and `/ws` to the backend `port`. `web_port` is strict: if it is already in use, Web startup fails instead of switching to another port.

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

- `data/file/sops/`: defines SOP workflows (including stages and roles).
- `data/file/prompts/`: defines runtime behavior rules and reference constraints.
- `data/file/skills/`: defines standalone capability protocols and operation steps.
- Snail Den runtime executors are managed via API and stored in the database.

## API Usage

### Create a workspace

```bash
POST /api/workspaces
{
  "name": "Workspace name",
  "description": "Workspace description"
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
POST /api/workspaces/:id/advance
```

### Search history

```bash
GET /api/conversations/:id/history/search?query=keyword
```

## Database

The development database is located at `data/database/snail-shell.db` and uses SQLite to store workspaces, conversations, messages, and artifacts.

## Workspace Structure

```text
src/
├── agent/          # agent runtime adapters
├── api/            # REST API and WebSocket service
├── llm/            # OpenAI integration
├── persistence/    # database operations
├── workspace/      # workspace management and collaboration logic
└── types/          # TypeScript definitions

data/file/          # metadata configuration
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
- Files under `data/file/` only use English keys and code-facing conventions, without separate Chinese and English copies.

## License

MIT
