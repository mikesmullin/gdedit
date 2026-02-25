# enqueue CLI - Product Requirements Document

## Overview

`enqueue` is a CLI tool for creating and managing `Queue` class instances in the ontology database. Queue items represent actionable prompts that appear in gdedit's Queue page, awaiting human response.

**Relationship to `notify`:** Both tools route the same kind of information (notifications requiring human interaction). The key difference:
- `notify` → D-Bus → xnotid (desktop notification daemon)
- `enqueue` → ontology → gdedit (web-based queue UI)

The interface should be similar since they handle the same data model, but `enqueue` shortcuts via the ontology file system for tighter integration with the subd/gdedit ecosystem.

## Comparison: notify vs enqueue

| Aspect | `notify` | `enqueue` |
|--------|----------|-----------|
| **Transport** | D-Bus → xnotid daemon | ontology fs → gdedit API |
| **UI** | Desktop notification popup | gdedit Queue page (web) |
| **Language** | Rust | Bun/JavaScript |
| **Await mechanism** | D-Bus signal subscription | inotify file watch |
| **Response routing** | xnotid → D-Bus → notify stdout | gdedit API → ontology file → enqueue stdout |
| **Card format** | JSON in body (xnotid_card v1) | Same JSON format |
| **YAML input** | stdin or --file | stdin or --file |
| **CLI options** | Nearly identical | Nearly identical |

Both tools:
- Accept YAML from stdin or `--file`
- Support `--await` to block until response
- Support `--print-id`, `--timeout`, `--urgency`
- Support `--action` for custom buttons
- Support `card` object for multiple-choice/permission
- Output JSON on `--await`

## Motivation

Agents and automated processes need a way to:
1. Request human decisions (multiple-choice, yes/no)
2. Request permissions before dangerous operations
3. Display notifications requiring acknowledgment
4. Query the status of pending requests
5. **Block (`--await`) until the human responds, then receive the response on stdout**

The `enqueue` CLI provides a scriptable interface for these interactions, complementing the visual Queue page in gdedit.

## Queue Schema

Queue instances use the `Notification` component:

| Property | Type | Description |
|----------|------|-------------|
| `summary` | string | Short title (required for display) |
| `body` | string | Extended text or JSON payload |
| `urgency` | string | `low`, `normal`, `critical` |
| `timeout` | int | Auto-dismiss timeout in ms (0 = never) |
| `await` | bool | Block until responded (default: true) |
| `actions` | json | Array of `{key: label}` action buttons |
| `card` | json | Structured card payload (see Card Types) |
| `appName` | string | Originating application name |
| `category` | string | Notification category |
| `icon` | string | Icon name or path |
| `printId` | bool | Print ID on creation |
| `progress` | int | Progress percentage (0-100) |
| `id` | int | Numeric ID for reference |
| `hints` | json | Additional metadata hints |
| `response` | json | Recorded response (set when answered) |
| `created` | date | Creation timestamp |
| `updated` | date | Last update timestamp |

### Card Types

**Multiple-choice:**
```yaml
card:
  type: multiple-choice
  question: Which environment?
  choices:
    - id: dev
      label: Development
    - id: prod
      label: Production
  allow_other: false  # Allow custom text input
```

**Permission:**
```yaml
card:
  type: permission
  question: Allow me to run database migration?
```

## Commands

### Primary Interface

```text
Usage: enqueue [options] [summary] [body...]

Arguments:
  summary     Queue item title (overrides YAML summary)
  body...     Queue item body text; use '-' to read body text from stdin

Structured input sources (YAML; only one allowed):
  -                       Read YAML payload from stdin (default when piped)
  --file <PATH>           Read YAML payload from file (or '-' for stdin)

Common options:
  -u, --urgency <low|normal|critical>     [default: normal]
  -a, --app-name <NAME>                   Originating application name
  -c, --category <CATEGORY>               Queue item category
      --action <ID:LABEL>                 Add action button (repeatable)
  -t, --timeout <ms>                      Auto-dismiss timeout (0 = persistent) [default: 0]
      --id <ID>                           Custom queue ID (auto-generated if omitted)
      --print-id                          Print the queue item ID to stdout
      --await                             Block until response, then print JSON to stdout

Other:
  -h, --help              Show this help
      --version           Show version
```

### Semantics (matching `notify`)

- If stdin is not a terminal and no `--file`, read YAML payload from stdin
- Both stdin and `--file` input are interpreted as YAML objects
- YAML supports all CLI-accepted fields (summary, body, urgency, actions, timeout, card, etc.)
- CLI options override YAML fields when both are provided
- `--await` blocks until the queue item receives a response (via gdedit UI), then prints JSON to stdout
- `--` (double dash) stops option parsing for remaining CLI arguments

### YAML Input Model

When stdin is piped (and `--file` is not provided), input is parsed as YAML:

```yaml
summary: Deploy status
body: |
  Build completed.
  Waiting for approval.
urgency: critical  # low|normal|critical
app_name: agent-1
category: deployment
actions:
  - approve:Approve
  - deny:Deny
timeout: 0
await: true
print_id: true
```

### Card Payloads (structured prompts)

`enqueue` can generate structured card JSON (matching xnotid card format) from YAML `card` definitions.

**Multiple-choice card:**

```yaml
summary: Clarification needed
timeout: 0
await: true
card:
  type: multiple-choice
  question: Which deployment environment should I use?
  choices:
    - id: dev
      label: Dev
    - id: staging
      label: Staging
    - id: prod
      label: Production
  allow_other: true
```

**Permission card:**

```yaml
summary: Permission request
timeout: 0
await: true
card:
  type: permission
  question: Allow me to run the database migration now?
  allow_label: Allow
```

Notes:
- If `card` is provided, `body` is auto-generated as JSON (same format as xnotid)
- If no explicit `actions` are passed, `enqueue` auto-populates fallback actions from the card
- For `multiple-choice` with `allow_other: true`, gdedit accepts custom text input

### Examples

**Send from file:**
```bash
enqueue --file payload.yaml
```

**Send from stdin YAML:**
```bash
printf 'summary: Test\nbody: Hello\n' | enqueue
```

**Send with positional summary/body:**
```bash
enqueue "Deploy approval" "Ready to deploy v2.4.0 to production?"
```

**Send body from stdin text using positional `-`:**
```bash
echo "multi-line body" | enqueue "from stdin" -
```

**Interactive question with await:**
```bash
enqueue --file question.yaml --timeout=0 \
  --action=approve:Approve --action=deny:Deny --await
```

**Multiple-choice card with await:**
```bash
enqueue --file card.multiple-choice.yaml --await --print-id --timeout=0
```

**Permission card with await:**
```bash
enqueue --file card.permission.yaml --await --print-id --timeout=0
```

### `--await` Output Format

When `--await` is used, `enqueue` blocks until the queue item receives a response (when user clicks action in gdedit), then prints JSON to stdout:

**Action selected:**
```json
{"event":"action","id":"queue-a1b2c3","action":"approve"}
```

**Multiple-choice response:**
```json
{"event":"action","id":"queue-a1b2c3","action_data":{"kind":"multiple-choice","selected":[{"id":"prod","label":"Production"}],"other":null}}
```

**Permission response:**
```json
{"event":"action","id":"queue-a1b2c3","action":"allow"}
```

**Await timeout (if `--timeout` specified):**
```json
{"event":"await-timeout","id":"queue-a1b2c3","timeout_ms":30000}
```

### Auxiliary Commands

These subcommands provide additional queue management (all shell to `ontology`):

#### `enqueue list [--filter <query>]`

List pending queue items. Uses `ontology search ":Queue"`.

```bash
$ enqueue list
| id | age | urgency | type | summary |
| --- | --- | --- | --- | --- |
| queue-a1b2c3 | 2m ago | critical | permission | Run database migration? |
| queue-d4e5f6 | 15m ago | normal | mc | Which environment? |

$ enqueue list --pending        # Only items without response
$ enqueue list --app agent-1    # Filter by app name
$ enqueue list --json           # Output as JSON
```

#### `enqueue view <id>`

View a queue item in detail. Uses `ontology get <id>`. Accepts 6-char prefix or full ID.

```bash
$ enqueue view queue-a1b2c3
```

#### `enqueue respond <id> <response>`

Record a response to a queue item. Uses `ontology set <id>:Queue notification.response=<json>`.

```bash
$ enqueue respond queue-a1b2c3 allow
$ enqueue respond queue-d4e5f6 prod
$ enqueue respond queue-d4e5f6 --other "custom-env-xyz"
```

#### `enqueue rm <id> [id...]`

Remove queue items. Uses `ontology rm <id>`.

```bash
$ enqueue rm queue-a1b2c3
$ enqueue rm queue-a1b2c3 queue-d4e5f6 --force
```

#### `enqueue wait <id> [--timeout <ms>]`

Attach to existing queue item and block until response. Uses inotify (direct file access).

```bash
$ enqueue wait queue-a1b2c3
# Blocks until response...
{"event":"action","id":"queue-a1b2c3","action":"approve"}

$ enqueue wait queue-a1b2c3 --timeout 30000
# Timeout after 30 seconds, exit code 124 if no response
```

## Workflow Examples

### Agent requesting permission (matching notify pattern)

```bash
#!/bin/bash
# Agent script requesting DB migration permission

RESPONSE=$(enqueue --file - --await --print-id <<EOF
summary: Permission request
timeout: 0
card:
  type: permission
  question: Allow me to run migration on production?
urgency: critical
EOF
)

ACTION=$(echo "$RESPONSE" | jq -r '.action // empty')

if [ "$ACTION" = "allow" ]; then
  echo "Permission granted, running migration..."
  ./run-migration.sh
else
  echo "Permission denied, aborting."
  exit 1
fi
```

### Multiple-choice deployment target

```bash
#!/bin/bash
# CI script asking for deployment target

RESPONSE=$(enqueue --file - --await <<EOF
summary: Deployment target
card:
  type: multiple-choice
  question: Deploy v2.4.0 to which environment?
  choices:
    - id: dev
      label: Development
    - id: staging
      label: Staging
    - id: prod
      label: Production
timeout: 0
EOF
)

TARGET=$(echo "$RESPONSE" | jq -r '.action_data.selected[0].id // .action // empty')

echo "Deploying to: $TARGET"
./deploy.sh --env "$TARGET"
```

### Fire-and-forget notification

```bash
# Notify without blocking (no --await)
enqueue "Build complete" "Pipeline finished in 3m 42s" --timeout 10000
```

### Simple inline usage

```bash
# Quick permission request with positional args
enqueue "Delete records?" "Remove 47 stale cache entries?" \
  --action=yes:Yes --action=no:No --await

# Pipe body from command output
git log --oneline -10 | enqueue "Recent commits" - --app-name git-summary
```

## Implementation Notes

### Architecture Principle: Shell to `ontology`

`enqueue` should use the `ontology` CLI behind the scenes wherever possible, rather than directly manipulating ontology storage files. This centralizes file format logic in one place.

| Operation | Implementation |
|-----------|----------------|
| Create queue item | `ontology import <tmpfile.yaml>` |
| View queue item | `ontology get <id>` |
| Remove queue item | `ontology rm <id>` |
| List queue items | `ontology search ":Queue"` |
| Set response | `ontology set <id>:Queue notification.response=<json>` |
| Check if responded | Parse output of `ontology get <id>` |

**Exceptions** (direct file access required):
- `--await` file watching: Use inotify on `~/.ontology/storage/Queue/<id>.md` directly (can't shell out for blocking watch)
- Reading response for await: Parse file directly after inotify triggers

### Storage & IDs
- Queue instances stored at `~/.ontology/storage/Queue/<id>.md`
- IDs auto-generated as `queue-<sha1_prefix>` or custom via `--id`
- Timestamps: `created` set on creation, `updated` on response

### Await Mechanism

When `--await` is specified:
1. Create queue item via `ontology import <tmpfile.yaml>` (shells out)
2. Resolve storage path from `ontology get <id>` output or config
3. Watch the queue item file for changes using inotify (direct file access — can't shell for blocking watch)
4. When file modified, parse it directly to check for `response` field
5. When `response` is populated (via gdedit API when user clicks action):
   - Parse the response payload
   - Print JSON to stdout
   - Exit 0
6. If `--timeout <ms>` specified and expires:
   - Print timeout JSON to stdout
   - Exit 124 (matching `timeout` command convention)

### Response Flow

```
enqueue --await        ontology CLI          gdedit UI              ontology storage
    │                      │                      │                        │
    ├── import ───────────►│                      │                        │
    │                      ├─── write ───────────────────────────────────► │  Queue/<id>.md
    │                      │                      │                        │
    ├── inotify watch ◄────────────────────────────────────────────────────┤  (direct file access)
    │                      │                      │                        │
    │                      │                      ├── user clicks ────────►│  PATCH response
    │                      │                      │                        │
    ◄── file changed ──────────────────────────────────────────────────────┤
    │                      │                      │                        │
    ├── read & parse ◄─────────────────────────────────────────────────────┤  (direct file access)
    │                      │                      │                        │
    ├── print JSON ───►stdout                     │                        │
    │                      │                      │                        │
    └── exit 0             │                      │                        │
```

### Card Auto-Actions

When `card` is provided without explicit `actions`:
- **multiple-choice**: Actions auto-generated from choices (e.g., `dev:Dev`, `staging:Staging`)
- **permission**: Actions auto-generated as `allow:<allow_label>` (default "Allow")

### Body Generation

When `card` is provided:
- Body is serialized as JSON matching xnotid card format:
  ```json
  {"xnotid_card":"v1","type":"multiple-choice","question":"...","choices":[...]}
  ```
- This allows gdedit's queueView to render structured cards

### Response Payloads (stored in ontology)

These are written by gdedit when user interacts with the queue item:

**Permission:**
```json
{
  "kind": "permission",
  "action": "allow",
  "respondedAt": "2026-02-25T10:35:00Z"
}
```

**Multiple-choice:**
```json
{
  "kind": "multiple-choice",
  "selected": [{"id": "prod", "label": "Production"}],
  "other": null,
  "respondedAt": "2026-02-25T10:35:00Z"
}
```

**Action button:**
```json
{
  "kind": "action",
  "action": "approve",
  "label": "Approve",
  "respondedAt": "2026-02-25T10:35:00Z"
}
```

### Stdout Output Format (from --await)

Matches `notify --await` JSON format:

**Simple action:**
```json
{"event":"action","id":"queue-a1b2c3","action":"approve"}
```

**Multiple-choice:**
```json
{"event":"action","id":"queue-a1b2c3","action_data":{"kind":"multiple-choice","selected":[{"id":"prod","label":"Production"}],"other":null}}
```

**Timeout:**
```json
{"event":"await-timeout","id":"queue-a1b2c3","timeout_ms":30000}
```

## File Structure

```
enqueue/
├── bin/
│   └── enqueue.js          # Entry point (bun link target)
├── src/
│   └── cli.js              # Main CLI implementation
├── package.json
├── README.md
└── SKILL.md                # AI skill documentation
```

## Dependencies

- **Bun** runtime (for fs.watch / inotify support)
- **yaml** package for YAML parsing (input parsing + temp file generation)
- **ontology** CLI (required, must be in $PATH) — all mutations go through this

### Why shell to `ontology`?

1. **Single source of truth** — File format, validation, and storage logic centralized in `ontology`
2. **No shared library needed** — Simpler than extracting/importing JS modules
3. **Consistency** — Same behavior whether user runs `enqueue` or `ontology` directly
4. **Easier maintenance** — Changes to storage format only need updating in one place

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Item not found |
| 124 | Await timeout (matches `timeout` command) |

## Open Questions

1. ~~Should `wait` poll the filesystem or use a watch mechanism?~~ → Use inotify via Bun's `fs.watch`
2. Should there be an `enqueue clear` to remove all responded items?
3. Should `list` support ontology search DSL for complex filters?
4. Should `--await` also support a `--poll-interval` for non-inotify fallback?
