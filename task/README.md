# task

A Bun-based CLI for managing `Task` ontology instances. Designed for AI agents and humans to track work units with Eisenhower-matrix prioritization, dependency graphs, worker locks, and semantic search.

## Features

- **Dependency Tree** — Visualize task relationships with topological sorting or critical path analysis
- **Smart Prioritization** — TaskWarrior-inspired scoring using urgency, importance, due dates, estimates, and dependencies
- **Worker Locks** — Cooperative locking to prevent multiple agents from working the same task
- **Semantic Search** — Index tasks to a local vector DB for natural-language recall

## Installation

```bash
cd task
bun install
bun link
```

## Commands

| Command | Description |
|---------|-------------|
| `task tree [--crit]` | Dependency tree table; `--crit` filters to critical path |
| `task next [-l N]` | Prioritized task list (top N with `-l`) |
| `task view <id>` | Print full Task YAML |
| `task take <id> <worker>` | Acquire worker lock |
| `task release <id> <worker>` | Release worker lock |
| `task index` | Update semantic search DB |

## Related

- See [SKILL.md](SKILL.md) for detailed usage examples and schema reference
- Uses the `ontology` CLI for storage operations
- Uses `memo` for vector search indexing
