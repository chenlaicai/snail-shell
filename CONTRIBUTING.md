# Contributing to Snail Shell

## Commit Message Format

All commits must follow this template:

```
[FYYYYMMDDNN][module][Feature Update|BugFix|New Feature][Incompatible] 中文标题
```

- `FYYYYMMDDNN`: Feature/Issue ID (e.g. F2026060801)
- `module`: lowercase hyphen-separated (e.g. issue, sop, snail, conversation, db, server, web)
- `[Incompatible]`: only when there are breaking changes

## Branch Workflow

- Never commit directly to `main`
- Create a branch, develop, push, and open a PR
- PRs require CI to pass

## Architecture: Domain-Driven Design

Each module is a bounded context with clear boundaries:

```
<module>/
  api.ts              # 🟢 Public API — exports for external use
  types.ts            # 🟢 Public types — structs exposed externally
  _internal/
    *.ts              # 🔴 Internal implementation — external import forbidden
```

### Import Rules

```typescript
import { createIssue } from '@/issue/api';           // ✅ Public API
import type { Issue } from '@/issue/types';           // ✅ Public types
import { parseYaml } from '@/sop/_internal/loader';   // ❌ ESLint error
```

### Domain Modules

| Module | Business Concept | Owns |
|--------|-----------------|------|
| `workspace/` | Project space | Workspace, GuardProfile |
| `sop/` | Workflow template | SOP, StageDefinition, Transition |
| `issue/` | Work item | Issue, Stage, GateEvidence |
| `snail/` | Agent runtime | SnailTemplate, SnailRuntime, AgentEvent |
| `conversation/` | Dialogue | Conversation, Message, MessageEvent |
| `evolution/` | Governance | EvolutionItem, KnowledgeEntry |

### Dependency Direction

```
workspace ──→ sop ──→ issue ──→ conversation
                │                   ↑
                └───────────────────┘
                        │
                       snail
```

### Config vs Data

- **Config** (no business logic) → `config/`
- **Domain data** (business semantics) → belongs to its domain module

See `docs/v2-design-decisions.md` for full design rationale.
