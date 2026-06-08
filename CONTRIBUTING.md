# Contributing to Snail Shell

## Commit Message Format

All commits must follow this template:

```
[FYYYYMMDDNN][module][Feature Update|BugFix|New Feature][Incompatible] 中文标题
```

- `FYYYYMMDDNN`: Feature/Issue ID (e.g. F2026060801)
- `module`: lowercase hyphen-separated (e.g. workflow, persistence, web, agent)
- `[Incompatible]`: only when there are breaking changes

## Branch Workflow

- Never commit directly to `main`
- Create a branch, develop, push, and open a PR
- PRs require CI to pass

## Project Structure

```
src/
  types/          # Domain types (no runtime deps)
  config/         # Configuration loading + Zod schemas
  db/             # Drizzle ORM schema, migrations, repos
  workflow/       # SOP engine, stage machine, gate checks
  agent/          # Runtime adapters (Claude Code, etc.)
  collaboration/  # Multi-role message orchestration
  server/         # Hono API + WebSocket
  web/            # React frontend
```

## Layer Rules

Dependencies flow downward only. ESLint enforces this:

```
types/config → db → workflow/agent → collaboration → server → web
```
