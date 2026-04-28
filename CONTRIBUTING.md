# Contributing

## Development Setup

```bash
npm install
npm run check
```

## Pull Requests

- Keep changes focused and complete: address the full validated problem and its necessary tests without unrelated churn.
- Explain why the change is needed.
- Call out whether the change affects workflow, persistence, runtime adapters, or API behavior.
- Run `npm run check` before opening a PR.

## Project Notes

Snail Shell coordinates multiple AI runtimes through staged workflows and formal artifacts. Changes that affect persistence, runtime sessions, stage advancement, or artifact constraints should clearly describe compatibility and migration risks in the PR.
