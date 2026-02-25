# enqueue

Queue-focused ontology CLI for human-in-the-loop prompts.

## Overview

`enqueue` creates `Queue` class instances in the ontology database that appear in gdedit's Queue page. It provides a scriptable way for agents and automated processes to request human input.

**Relationship to `notify`:** Both tools handle the same data model (notifications with actions). The difference:
- `notify` → D-Bus → xnotid (desktop notification daemon)
- `enqueue` → ontology → gdedit (web-based queue UI)

## Installation

```bash
cd enqueue
bun install
bun link
```

## Quick Start

```bash
# Simple notification
enqueue "Build complete"

# Permission request with blocking await
enqueue --file - --await <<EOF
summary: Deploy to production?
card:
  type: permission
  allow_label: Deploy
  deny_label: Cancel
EOF
```

## Documentation

See [SKILL.md](SKILL.md) for detailed usage, YAML format, card types, subcommands, and examples.

## Architecture

`enqueue` uses the `ontology` CLI for all mutations:
- Create: `ontology import`
- View: `ontology get`
- Remove: `ontology rm`
- List: `ontology search`
- Respond: `ontology set`

Only `--await` file watching uses direct file access (inotify).
