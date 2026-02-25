```skill
# enqueue — CLI Usage Guide

`enqueue` creates Queue class instances in the ontology database for human-in-the-loop prompts. Queue items appear in gdedit's Queue page.

## Primary Interface

```bash
enqueue [options] [summary] [body...]
```

- `summary` — Queue item title
- `body...` — Body text; use `-` to read from stdin
- Use `--file` or pipe stdin for YAML input

## Common Patterns

### Permission Request (blocking)

```bash
RESPONSE=$(enqueue --file - --await <<EOF
summary: Permission request
timeout: 0
card:
  type: permission
  question: Allow me to run database migration?
urgency: critical
EOF
)

ACTION=$(echo "$RESPONSE" | jq -r '.action')
if [ "$ACTION" = "allow" ]; then
  echo "Granted"
else
  echo "Denied"
fi
```

### Multiple Choice (blocking)

```bash
RESPONSE=$(enqueue --file - --await <<EOF
summary: Deployment target
card:
  type: multiple-choice
  question: Deploy to which environment?
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

TARGET=$(echo "$RESPONSE" | jq -r '.action_data.selected[0].id // .action')
echo "Deploying to: $TARGET"
```

### Simple Action Buttons

```bash
enqueue "Approve release?" "v2.4.0 ready for production" \
  --action=approve:Approve --action=deny:Deny --await
```

### Fire-and-forget Notification

```bash
enqueue "Build complete" "Pipeline finished in 3m 42s" --timeout 10000
```

## Subcommands

| Command | Description |
|---------|-------------|
| `enqueue list` | List queue items (add `--pending` for unanswered) |
| `enqueue view <id>` | View queue item details |
| `enqueue respond <id> <action>` | Record a response |
| `enqueue rm <id>` | Remove queue item |
| `enqueue wait <id>` | Block until response on existing item |

## Key Options

| Option | Description |
|--------|-------------|
| `--file <path>` | Read YAML from file (or `-` for stdin) |
| `--await` | Block until response, print JSON to stdout |
| `--print-id` | Print queue ID on creation |
| `--action <id:label>` | Add action button (repeatable) |
| `--urgency <level>` | low, normal, critical |
| `--timeout <ms>` | Auto-dismiss timeout (0 = persistent) |

## --await JSON Output

```json
{"event":"action","id":"queue-abc123","action":"approve"}
```

For multiple-choice:
```json
{"event":"action","id":"queue-abc123","action_data":{"kind":"multiple-choice","selected":[{"id":"prod","label":"Production"}],"other":null}}
```

## YAML Card Reference

### Multiple-choice

```yaml
card:
  type: multiple-choice
  question: Which option?
  choices:
    - id: opt1
      label: Option 1
    - id: opt2
      label: Option 2
  allow_other: true  # Allow custom text input
```

### Permission

```yaml
card:
  type: permission
  question: Allow this action?
  allow_label: Allow  # Custom button text
```

## Environment

- Storage: `~/.ontology/storage/Queue/*.md`
- Uses `ontology` CLI for all mutations
```
