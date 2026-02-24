# task — CLI Usage Guide

`task` is a specialized CLI for managing `Task` class instances in the ontology database. It wraps `ontology` commands with task-focused workflows.

## Task Schema

Tasks use the `WorkUnit` component with these properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique SHA1 identifier |
| `summary` | string | Short title (required) |
| `description` | string | Detailed body text |
| `important` | bool | Eisenhower matrix: important axis |
| `urgent` | bool | Eisenhower matrix: urgent axis |
| `weight` | int | Manual priority adjustment |
| `status` | enum | `idle`, `running`, `success`, `fail` |
| `worker` | string | Current lock holder (agent name) |
| `tags` | string[] | Categorization (e.g., `#platform`, `#ux`) |
| `stakeholders` | string[] | Impacted users (e.g., `@alice`) |
| `due` | date | Hard deadline |
| `estimateOptimistic` | date | Best-case completion |
| `estimateLikely` | date | Expected completion |
| `estimatePessimistic` | date | Worst-case completion |
| `dependsOn` | string[] | Blocking task IDs |
| `correlations` | string[] | Related URLs/references |
| `journal` | string[] | Timestamped progress entries |

## Commands

### `task tree [--crit]`

Print dependency tree as a markdown table.

```bash
$ task tree
| id | desc | parents |
| --- | --- | --- |
| a96d1c | Normalize legacy queue card payload fixtures | - |
| 5c2f9c | Rebuild search index pipeline for workspace graph data | a96d1c |
| f17481 | Add keyboard-first triage flow for queue operators | 5c2f9c |
```

With `--crit`, filters to the critical path (shortest path through dependencies):

```bash
$ task tree --crit
| id | desc | parents |
| --- | --- | --- |
| a96d1c | Normalize legacy queue card payload fixtures | - |
| 5c2f9c | Rebuild search index pipeline for workspace graph data | a96d1c |
| f17481 | Add keyboard-first triage flow for queue operators | 5c2f9c |
```

### `task next [-l|--limit <n>]`

Print prioritized task list sorted by computed score.

```bash
$ task next -l 3
| id | age | deps | p | tags | due | worker | summary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5c2f9c | 3d ago | 1 | UI | #platform, #search, #infra | in 5d | - | Rebuild search index pipeline |
| f17481 | 1d ago | - | U | #ux, #operator | in 9d | - | Add keyboard-first triage flow |
```

**Scoring factors:**
- Eisenhower quadrant (urgent+important = highest)
- Weight multiplier
- Due date pressure (exponential as deadline approaches)
- Estimate uncertainty
- Dependency propagation (blockers inherit blocked task's urgency)
- Tag coefficients (`#critical` +12, `#someday` -10, etc.)
- Status bonus (`running` +5, `success`/`fail` -20)
- Age creep (older tasks slowly rise)

### `task view <id>`

Print full Task instance as YAML. Accepts 6-char prefix or full SHA1.

```bash
$ task view 5c2f9c
apiVersion: agent/v1
kind: Ontology
spec:
  classes:
    - _class: Task
      _id: 5c2f9cebe6d32f0d9bf39f45bbf2cc9d7f7444d1
      components:
        workunit:
          id: 5c2f9cebe6d32f0d9bf39f45bbf2cc9d7f7444d1
          important: true
          urgent: true
          weight: 90
          tags:
            - "#platform"
            - "#search"
          status: running
          summary: Rebuild search index pipeline for workspace graph data
          description: Migrate the indexing job...
          due: 2026-02-28
          dependsOn:
            - a96d1cf3ebf4ef0dc71fef7306835f4f6f7155f9
          journal:
            - "2026-02-20T09:15:00Z @alice: migration branch cut"
```

### `task take <id> <worker>`

Acquire a cooperative lock on a task.

```bash
$ task take 5c2f9c agent-1
you acquired the task lock

$ task take 5c2f9c agent-1
you already hold the task lock

$ task take 5c2f9c agent-2
you may not have it, because another worker "agent-1" currently has the the task lock
```

### `task release <id> <worker>`

Release the lock if you hold it.

```bash
$ task release 5c2f9c agent-1
you released the task lock

$ task release 5c2f9c agent-2
you do not hold the lock, another worker "agent-1" does
```

### `task index`

Index all modified tasks to the semantic search database.

```bash
$ task index
Memorized: '# Rebuild search index pipeline...' (ID: 0)
Memorized: '# Add keyboard-first triage flow...' (ID: 1)

$ task index
All tasks up to date; nothing to index.
```

**Indexed metadata:** id, important, urgent, weight, tags, stakeholders, status, worker, due, estimates, dependsOn, correlations

**Indexed body:** summary, description, journal (using template format)

### `task upsert <file.yaml>`

Create or update a task from a YAML file. Supports multiline descriptions. Auto-indexes after write.

**Input format:**

```yaml
summary: Descriptive task title
description: |
  Multiline description with markdown support.
  
  Can have multiple paragraphs and formatting.
important: true
urgent: false
status: idle
weight: 5
tags:
  - "#feature"
  - "#backend"
stakeholders:
  - "@alice"
due: 2026-03-15
dependsOn:
  - a96d1cf3ebf4ef0dc71fef7306835f4f6f7155f9
correlations:
  - https://github.com/org/repo/issues/123
```

**For updates**, include the task ID:

```yaml
id: 5c2f9cebe6d32f0d9bf39f45bbf2cc9d7f7444d1
summary: Updated title
description: Updated description
important: true
urgent: true
status: running
```

**Example:**

```bash
$ task upsert new-task.yaml
Created task: a1b2c3 (a1b2c3d4e5f6...)
Indexing...
Memorized: '# Descriptive task title...' (ID: 7)

$ task upsert update-task.yaml  # with id field
Updated task: 5c2f9c (5c2f9cebe6d32f0d9bf...)
Indexing...
```

**Validation:**
- `important` and `urgent` are required booleans
- `summary` and `description` are required strings
- Tags must start with `#` (e.g., `#feature`)
- Stakeholders must start with `@` (e.g., `@alice`)
- `status` must be one of: `idle`, `running`, `success`, `fail`
- `dependsOn` IDs are verified to exist

## Semantic Search

After indexing, use `memo` directly to search tasks:

```bash
$ memo -f task/db/tasks recall -k 3 "search indexing"
Top 3 results for 'search indexing':
  [1] Score: 1.86 |
      # Rebuild search index pipeline for workspace graph data
      ...

$ memo -f task/db/tasks recall --filter '{status: running}' "what am I working on"
```

## Environment

- `TASK_ONTOLOGY_ROOT` — Override project root detection (looks for `config.yaml`)
- Storage: `~/.ontology/storage/Task/*.md` (configured in `config.yaml`)
- Index DB: `task/db/tasks.memo`, `task/db/tasks.yaml`
