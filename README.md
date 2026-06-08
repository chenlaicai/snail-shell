# Snail Shell

Multi-agent collaborative workspace with SOP-driven workflows.

## Overview

Snail Shell orchestrates specialized AI roles (architect, developer, reviewer) through staged workflows to produce formal software delivery artifacts. Define a Standard Operating Procedure (SOP) as a directed graph of stages with roles, then let multiple AI agents collaborate within each stage.

## Tech Stack

- **Runtime:** Node.js 22 + TypeScript 6 (ESM)
- **HTTP:** Hono (built-in SSE/WebSocket)
- **Database:** SQLite via Drizzle ORM
- **Frontend:** React 19 + Vite 8 + Tailwind CSS 4
- **State:** Zustand + TanStack Query
- **Validation:** Zod

## Getting Started

```bash
npm install
npm run dev
```

## Development

```bash
npm run test        # Run tests
npm run lint        # Lint code
npm run check       # Lint + test
npm run build       # Build for production
npm run db:generate # Generate DB migrations
npm run db:migrate  # Apply migrations
```

## License

[MIT](LICENSE)
