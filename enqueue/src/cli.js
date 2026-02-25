#!/usr/bin/env bun
/**
 * enqueue CLI - Queue-focused ontology CLI for human-in-the-loop prompts
 * 
 * Interface mirrors `notify` CLI but routes through ontology instead of D-Bus.
 * Uses `ontology` shell command for all mutations (centralized file format logic).
 */

import { parse, stringify } from 'yaml';
import { existsSync, readFileSync, writeFileSync, watch, statSync, mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENQUEUE_CLI_ROOT = dirname(__dirname);

// ============================================================================
// Utilities
// ============================================================================

function findOntologyRoot(startDir = process.cwd()) {
  const envRoot = process.env.ENQUEUE_ONTOLOGY_ROOT || process.env.TASK_ONTOLOGY_ROOT;
  if (envRoot && existsSync(join(envRoot, 'config.yaml'))) {
    return envRoot;
  }

  let current = startDir;
  for (;;) {
    if (existsSync(join(current, 'config.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return startDir;
}

const ONTOLOGY_ROOT = findOntologyRoot();

function getOntologyStoragePath() {
  const envDb = process.env.ONTOLOGY_DB?.trim();
  if (envDb) {
    return envDb.startsWith('~') ? join(homedir(), envDb.slice(1)) : envDb;
  }

  const configPath = join(ONTOLOGY_ROOT, 'config.yaml');
  if (!existsSync(configPath)) {
    return join(homedir(), '.ontology', 'storage');
  }

  try {
    const config = parse(readFileSync(configPath, 'utf8'));
    const storagePath = config?.storage?.path;
    if (!storagePath) {
      return join(homedir(), '.ontology', 'storage');
    }
    if (storagePath.startsWith('~')) {
      return join(homedir(), storagePath.slice(1));
    }
    return storagePath;
  } catch {
    return join(homedir(), '.ontology', 'storage');
  }
}

function getQueueStoragePath() {
  return join(getOntologyStoragePath(), 'Queue');
}

function generateQueueId() {
  const content = `${Date.now()}-${Math.random()}-${process.pid}`;
  const hash = createHash('sha1').update(content).digest('hex');
  return `queue-${hash.slice(0, 12)}`;
}

function shortId(id) {
  if (!id) return '';
  // For queue-xxxx format, show queue-xxxxxx
  if (id.startsWith('queue-')) {
    return id.slice(0, 18);
  }
  return id.slice(0, 12);
}

function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\0/g, '');
}

async function runOntology(args) {
  const proc = Bun.spawn(['ontology', ...args], {
    cwd: ONTOLOGY_ROOT,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    const msg = (stderr || stdout || `ontology ${args.join(' ')} failed`).trim();
    throw new Error(msg);
  }

  return stdout;
}

function isTerminal(stream) {
  return stream.isTTY === true;
}

// ============================================================================
// YAML Payload Parsing
// ============================================================================

function parseYamlPayload(content) {
  if (!content || content.trim() === '') return null;
  try {
    return parse(content);
  } catch (e) {
    throw new Error(`Failed to parse YAML: ${e.message}`);
  }
}

function loadYamlFromFile(filePath) {
  if (filePath === '-') {
    // stdin handled separately
    return null;
  }
  const resolved = isAbsolute(filePath) ? filePath : join(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  return readFileSync(resolved, 'utf8');
}

async function loadStdin() {
  const chunks = [];
  const reader = Bun.stdin.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ============================================================================
// Card Generation (xnotid-compatible format)
// ============================================================================

function generateCardBody(card) {
  if (!card || !card.type) return null;

  const envelope = { xnotid_card: 'v1' };

  if (card.type === 'multiple-choice') {
    const choices = (card.choices || []).map((c, i) => {
      if (typeof c === 'string') {
        const id = normalizeChoiceId(c, i);
        return { id, label: c };
      }
      return { id: c.id || normalizeChoiceId(c.label, i), label: c.label || c.id };
    });

    envelope.type = 'multiple-choice';
    envelope.question = sanitizeText(card.question || '');
    envelope.choices = choices;
    envelope.allow_other = card.allow_other === true;

    return JSON.stringify(envelope);
  }

  if (card.type === 'permission') {
    envelope.type = 'permission';
    envelope.question = sanitizeText(card.question || '');
    envelope.allow_label = sanitizeText(card.allow_label || 'Allow');

    return JSON.stringify(envelope);
  }

  return null;
}

function normalizeChoiceId(label, fallbackIndex) {
  if (!label) return `choice_${fallbackIndex}`;
  let normalized = '';
  for (const ch of label) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      normalized += ch.toLowerCase();
    } else if (/[\s\-_]/.test(ch) && !normalized.endsWith('_')) {
      normalized += '_';
    }
  }
  normalized = normalized.replace(/^_+|_+$/g, '');
  return normalized || `choice_${fallbackIndex}`;
}

function generateActionsFromCard(card) {
  if (!card || !card.type) return [];

  if (card.type === 'multiple-choice') {
    return (card.choices || []).map((c, i) => {
      if (typeof c === 'string') {
        return { [normalizeChoiceId(c, i)]: c };
      }
      const id = c.id || normalizeChoiceId(c.label, i);
      return { [id]: c.label || id };
    });
  }

  if (card.type === 'permission') {
    const allowLabel = card.allow_label || 'Allow';
    const denyLabel = card.deny_label || 'Deny';
    return [{ allow: allowLabel }, { deny: denyLabel }];
  }

  return [];
}

// ============================================================================
// Card Validation
// ============================================================================

function validateCard(card) {
  if (!card) return; // No card is valid

  const errors = [];

  // Check for common mistake: using 'kind' instead of 'type'
  if (card.kind && !card.type) {
    errors.push(`card.kind "${card.kind}" is invalid - use "type" instead (e.g., type: ${card.kind})`);
  }

  // Check type is present
  if (!card.type) {
    if (!card.kind) {
      errors.push('card.type is required (valid values: "multiple-choice", "permission")');
    }
  } else {
    // Validate type value
    const validTypes = ['multiple-choice', 'permission'];
    if (!validTypes.includes(card.type)) {
      errors.push(`card.type "${card.type}" is invalid (valid values: ${validTypes.map(t => `"${t}"`).join(', ')})`);
    }

    // Type-specific validation
    if (card.type === 'multiple-choice') {
      if (!card.choices) {
        errors.push('card.choices is required for multiple-choice cards');
      } else if (!Array.isArray(card.choices)) {
        errors.push('card.choices must be an array');
      } else if (card.choices.length === 0) {
        errors.push('card.choices must have at least one choice');
      } else {
        // Validate each choice
        for (let i = 0; i < card.choices.length; i++) {
          const c = card.choices[i];
          if (typeof c !== 'string' && typeof c !== 'object') {
            errors.push(`card.choices[${i}] must be a string or object`);
          } else if (typeof c === 'object' && !c.label && !c.id) {
            errors.push(`card.choices[${i}] must have "label" or "id" property`);
          }
        }
      }
    }

    if (card.type === 'permission') {
      // allow_label and deny_label are optional with defaults
      if (card.allow_label && typeof card.allow_label !== 'string') {
        errors.push('card.allow_label must be a string');
      }
      if (card.deny_label && typeof card.deny_label !== 'string') {
        errors.push('card.deny_label must be a string');
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid card schema:\n  - ${errors.join('\n  - ')}`);
  }
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const result = {
    // Subcommands
    subcommand: null,
    subcommandArgs: [],

    // Main options
    summary: null,
    body: [],
    file: null,
    urgency: 'normal',
    appName: null,
    category: null,
    actions: [],
    timeout: 0,
    id: null,
    printId: false,
    awaitResult: false,

    // For subcommands
    pending: false,
    responded: false,
    json: false,
    force: false,
    other: null,

    // Flags
    help: false,
    version: false,
  };

  const subcommands = ['list', 'view', 'respond', 'rm', 'wait'];
  let i = 0;
  let foundDoubleDash = false;

  while (i < argv.length) {
    const arg = argv[i];

    if (foundDoubleDash) {
      result.body.push(arg);
      i++;
      continue;
    }

    if (arg === '--') {
      foundDoubleDash = true;
      i++;
      continue;
    }

    // Check for subcommand (first positional)
    if (!result.subcommand && result.summary === null && !arg.startsWith('-') && subcommands.includes(arg)) {
      result.subcommand = arg;
      result.subcommandArgs = argv.slice(i + 1);
      break;
    }

    // Options
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      i++;
    } else if (arg === '--version') {
      result.version = true;
      i++;
    } else if (arg === '--file' || arg === '-f') {
      result.file = argv[++i];
      i++;
    } else if (arg.startsWith('--file=')) {
      result.file = arg.slice(7);
      i++;
    } else if (arg === '--urgency' || arg === '-u') {
      result.urgency = argv[++i];
      i++;
    } else if (arg.startsWith('--urgency=')) {
      result.urgency = arg.slice(10);
      i++;
    } else if (arg === '--app-name' || arg === '-a') {
      result.appName = argv[++i];
      i++;
    } else if (arg.startsWith('--app-name=')) {
      result.appName = arg.slice(11);
      i++;
    } else if (arg === '--category' || arg === '-c') {
      result.category = argv[++i];
      i++;
    } else if (arg.startsWith('--category=')) {
      result.category = arg.slice(11);
      i++;
    } else if (arg === '--action') {
      result.actions.push(argv[++i]);
      i++;
    } else if (arg.startsWith('--action=')) {
      result.actions.push(arg.slice(9));
      i++;
    } else if (arg === '--timeout' || arg === '-t') {
      result.timeout = parseInt(argv[++i], 10) || 0;
      i++;
    } else if (arg.startsWith('--timeout=')) {
      result.timeout = parseInt(arg.slice(10), 10) || 0;
      i++;
    } else if (arg === '--id') {
      result.id = argv[++i];
      i++;
    } else if (arg.startsWith('--id=')) {
      result.id = arg.slice(5);
      i++;
    } else if (arg === '--print-id') {
      result.printId = true;
      i++;
    } else if (arg === '--await') {
      result.awaitResult = true;
      i++;
    } else if (arg === '--pending') {
      result.pending = true;
      i++;
    } else if (arg === '--responded') {
      result.responded = true;
      i++;
    } else if (arg === '--json') {
      result.json = true;
      i++;
    } else if (arg === '--force') {
      result.force = true;
      i++;
    } else if (arg === '--other') {
      result.other = argv[++i];
      i++;
    } else if (arg.startsWith('--other=')) {
      result.other = arg.slice(8);
      i++;
    } else if (arg.startsWith('-')) {
      // Unknown option - could be body starting with -
      if (arg === '-') {
        result.body.push(arg);
      } else {
        throw new Error(`Unknown option: ${arg}`);
      }
      i++;
    } else {
      // Positional: first is summary, rest is body
      if (result.summary === null) {
        result.summary = arg;
      } else {
        result.body.push(arg);
      }
      i++;
    }
  }

  return result;
}

function parseAction(input) {
  const colonIdx = input.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(`Invalid --action '${input}', expected ID:LABEL`);
  }
  const id = input.slice(0, colonIdx).trim();
  const label = input.slice(colonIdx + 1).trim();
  if (!id || !label) {
    throw new Error(`Invalid --action '${input}', ID and LABEL must be non-empty`);
  }
  return { [id]: label };
}

// ============================================================================
// Help & Version
// ============================================================================

function printHelp() {
  console.log(`enqueue - Queue-focused ontology CLI for human-in-the-loop prompts

Usage:
  enqueue [options] [summary] [body...]

Arguments:
  summary     Queue item title (overrides YAML summary)
  body...     Queue item body text; use '-' to read body text from stdin

Structured input sources (YAML; only one allowed):
  -                       Read YAML payload from stdin (default when piped)
  --file <PATH>           Read YAML payload from file (or '-' for stdin)

Common options:
  -u, --urgency <level>   Urgency: low, normal, critical [default: normal]
  -a, --app-name <NAME>   Originating application name
  -c, --category <CAT>    Queue item category
      --action <ID:LABEL> Add action button (repeatable)
  -t, --timeout <ms>      Auto-dismiss timeout (0 = persistent) [default: 0]
      --id <ID>           Custom queue ID (auto-generated if omitted)
      --print-id          Print the queue item ID to stdout
      --await             Block until response, then print JSON to stdout

Subcommands:
  list [--pending] [--json]       List queue items
  view <id>                       View queue item details
  respond <id> <response>         Record a response
  rm <id> [id...]                 Remove queue items
  wait <id> [--timeout <ms>]      Wait for response on existing item

Other:
  -h, --help              Show this help
      --version           Show version

Examples:
  # From YAML file
  enqueue --file payload.yaml --await

  # From stdin YAML
  printf 'summary: Test\\nbody: Hello\\n' | enqueue

  # Positional summary/body
  enqueue "Deploy approval" "Ready to deploy v2.4.0?"

  # With actions and await
  enqueue "Approve?" --action=yes:Yes --action=no:No --await
`);
}

function printVersion() {
  console.log('enqueue 0.1.0');
}

// ============================================================================
// Subcommand: list
// ============================================================================

async function cmdList(args) {
  const opts = {
    pending: args.includes('--pending'),
    responded: args.includes('--responded'),
    json: args.includes('--json'),
    app: null,
    limit: 20,
  };

  // Parse --app
  const appIdx = args.indexOf('--app');
  if (appIdx >= 0 && args[appIdx + 1]) {
    opts.app = args[appIdx + 1];
  }

  // Use ontology search --ids to find Queue item IDs
  let output;
  try {
    output = await runOntology(['search', ':Queue', '--ids']);
  } catch (e) {
    // If search returns nothing, it might error
    output = '';
  }

  const ids = output.trim().split('\n').filter(Boolean);
  
  // Read each item from storage
  const queuePath = getQueueStoragePath();
  let items = [];
  
  for (const id of ids) {
    const filePath = join(queuePath, `${id}.md`);
    if (!existsSync(filePath)) continue;
    
    try {
      const content = readFileSync(filePath, 'utf8');
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) continue;
      
      const frontmatter = parse(match[1]);
      const instance = frontmatter?.spec?.classes?.[0];
      if (!instance) continue;
      
      items.push(instance);
    } catch {
      continue;
    }
  }

  // Filter
  if (opts.pending) {
    items = items.filter(item => {
      const resp = item?.components?.notification?.response;
      return resp === undefined || resp === null || (typeof resp === 'object' && Object.keys(resp).length === 0);
    });
  }
  if (opts.responded) {
    items = items.filter(item => {
      const resp = item?.components?.notification?.response;
      return resp !== undefined && resp !== null && !(typeof resp === 'object' && Object.keys(resp).length === 0);
    });
  }
  if (opts.app) {
    items = items.filter(item => item?.components?.notification?.appName === opts.app);
  }

  // Limit
  items = items.slice(0, opts.limit);

  if (opts.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  // Table output
  if (items.length === 0) {
    console.log('No queue items found.');
    return;
  }

  console.log('| id | age | urgency | type | summary |');
  console.log('| --- | --- | --- | --- | --- |');

  for (const item of items) {
    const id = shortId(item._id || '');
    const notification = item?.components?.notification || {};
    const created = notification.created ? new Date(notification.created) : null;
    const age = created ? formatAge(created) : '-';
    const urgency = notification.urgency || 'normal';
    const card = notification.card;
    const type = card?.type === 'multiple-choice' ? 'mc' : card?.type === 'permission' ? 'permission' : 'action';
    const summary = (notification.summary || '').slice(0, 50);
    console.log(`| ${id} | ${age} | ${urgency} | ${type} | ${summary} |`);
  }
}

function formatAge(date) {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

// ============================================================================
// Subcommand: view
// ============================================================================

async function cmdView(args) {
  const id = args.find(a => !a.startsWith('-'));
  if (!id) {
    throw new Error('Usage: enqueue view <id>');
  }

  const resolvedId = await resolveQueueId(id);
  const output = await runOntology(['get', resolvedId]);
  console.log(output);
}

async function resolveQueueId(idOrPrefix) {
  // If it looks like a full ID, return it
  if (idOrPrefix.startsWith('queue-') && idOrPrefix.length > 18) {
    return idOrPrefix;
  }

  // Try to find by prefix
  const queuePath = getQueueStoragePath();
  if (!existsSync(queuePath)) {
    throw new Error(`Queue item not found: ${idOrPrefix}`);
  }

  const files = Bun.spawnSync(['ls', queuePath]).stdout.toString().trim().split('\n').filter(Boolean);
  const matches = files
    .map(f => f.replace(/\.md$/, ''))
    .filter(id => id.startsWith(idOrPrefix) || id.includes(idOrPrefix));

  if (matches.length === 0) {
    throw new Error(`Queue item not found: ${idOrPrefix}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous ID prefix '${idOrPrefix}', matches: ${matches.join(', ')}`);
  }

  return matches[0];
}

// ============================================================================
// Subcommand: respond
// ============================================================================

async function cmdRespond(args) {
  // Parse args
  let id = null;
  let response = null;
  let other = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--other') {
      other = args[++i];
    } else if (arg.startsWith('--other=')) {
      other = arg.slice(8);
    } else if (!arg.startsWith('-')) {
      if (!id) {
        id = arg;
      } else if (!response) {
        response = arg;
      }
    }
  }

  if (!id) {
    throw new Error('Usage: enqueue respond <id> <response>');
  }

  const resolvedId = await resolveQueueId(id);

  // Build response payload
  let payload;
  if (other) {
    payload = {
      kind: 'multiple-choice',
      selected: [],
      other: other,
      respondedAt: new Date().toISOString()
    };
  } else if (response) {
    // Check if it's a permission response
    if (response === 'allow' || response === 'deny') {
      payload = {
        kind: 'permission',
        action: response,
        respondedAt: new Date().toISOString()
      };
    } else {
      // Treat as action or multiple-choice selection
      payload = {
        kind: 'action',
        action: response,
        respondedAt: new Date().toISOString()
      };
    }
  } else {
    throw new Error('Usage: enqueue respond <id> <response>');
  }

  // Use ontology set to update response
  const jsonPayload = JSON.stringify(payload);
  await runOntology(['set', `${resolvedId}:Queue`, `notification.response=${jsonPayload}`]);
  console.log(`Responded: ${response || `other (${other})`}`);
}

// ============================================================================
// Subcommand: rm
// ============================================================================

async function cmdRm(args) {
  const force = args.includes('--force');
  const ids = args.filter(a => !a.startsWith('-'));

  if (ids.length === 0) {
    throw new Error('Usage: enqueue rm <id> [id...]');
  }

  const resolvedIds = [];
  for (const id of ids) {
    resolvedIds.push(await resolveQueueId(id));
  }

  const rmArgs = ['rm', ...resolvedIds];
  if (force) rmArgs.push('--force');

  await runOntology(rmArgs);
  console.log(`Removed ${resolvedIds.length} item(s)`);
}

// ============================================================================
// Subcommand: wait
// ============================================================================

async function cmdWait(args) {
  let id = null;
  let timeout = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--timeout' || arg === '-t') {
      timeout = parseInt(args[++i], 10) || 0;
    } else if (arg.startsWith('--timeout=')) {
      timeout = parseInt(arg.slice(10), 10) || 0;
    } else if (!arg.startsWith('-')) {
      if (!id) id = arg;
    }
  }

  if (!id) {
    throw new Error('Usage: enqueue wait <id> [--timeout <ms>]');
  }

  const resolvedId = await resolveQueueId(id);
  await awaitResponse(resolvedId, timeout);
}

// ============================================================================
// Await Response (inotify-based)
// ============================================================================

async function awaitResponse(queueId, timeoutMs = 0) {
  const queuePath = getQueueStoragePath();
  const filePath = join(queuePath, `${queueId}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Queue item file not found: ${filePath}`);
  }

  // Check if already has response
  const existingResponse = readResponseFromFile(filePath);
  if (existingResponse) {
    printAwaitResult(queueId, existingResponse);
    return;
  }

  // Set up timeout
  let timeoutHandle = null;
  let resolved = false;

  const timeoutPromise = timeoutMs > 0
    ? new Promise((resolve) => {
        timeoutHandle = setTimeout(() => {
          if (!resolved) {
            const output = { event: 'await-timeout', id: queueId, timeout_ms: timeoutMs };
            console.log(JSON.stringify(output));
            process.exit(124);
          }
        }, timeoutMs);
      })
    : new Promise(() => {}); // Never resolves

  // Watch for file changes
  const watchPromise = new Promise((resolve, reject) => {
    const watcher = watch(filePath, { persistent: true }, (eventType) => {
      if (resolved) return;

      // Re-read the file to check for response
      const response = readResponseFromFile(filePath);
      if (response) {
        resolved = true;
        watcher.close();
        if (timeoutHandle) clearTimeout(timeoutHandle);
        printAwaitResult(queueId, response);
        resolve();
      }
    });

    watcher.on('error', (err) => {
      if (!resolved) {
        reject(err);
      }
    });
  });

  await Promise.race([watchPromise, timeoutPromise]);
}

function readResponseFromFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    // Parse YAML frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const frontmatter = parse(match[1]);
    const notification = frontmatter?.spec?.classes?.[0]?.components?.notification;
    const response = notification?.response;

    if (!response) return null;
    if (typeof response === 'object' && Object.keys(response).length === 0) return null;

    return response;
  } catch {
    return null;
  }
}

function printAwaitResult(queueId, response) {
  let output;

  // Handle JSON-encoded string responses
  if (typeof response === 'string') {
    try {
      response = JSON.parse(response);
    } catch {
      // Not JSON, treat as simple action string
      response = { action: response };
    }
  }

  if (response.kind === 'multiple-choice') {
    output = {
      event: 'action',
      id: queueId,
      action_data: response
    };
  } else if (response.kind === 'permission') {
    output = {
      event: 'action',
      id: queueId,
      action: response.action
    };
  } else if (response.kind === 'action') {
    output = {
      event: 'action',
      id: queueId,
      action: response.action
    };
  } else if (response.action) {
    output = {
      event: 'action',
      id: queueId,
      action: response.action
    };
  } else {
    output = {
      event: 'action',
      id: queueId,
      action_data: response
    };
  }

  console.log(JSON.stringify(output));
}

// ============================================================================
// Main: Create Queue Item
// ============================================================================

async function createQueueItem(args, payload) {
  // Merge CLI args with YAML payload
  const queueId = args.id || payload?.id || generateQueueId();
  const summary = sanitizeText(args.summary || payload?.summary || '');
  const urgency = args.urgency || payload?.urgency || 'normal';
  const appName = args.appName || payload?.app_name || payload?.appName || null;
  const category = args.category || payload?.category || null;
  const timeout = args.timeout !== undefined ? args.timeout : (payload?.timeout ?? 0);
  const awaitResult = args.awaitResult || payload?.await === true;
  const printId = args.printId || payload?.print_id === true;
  const card = payload?.card || null;

  // Validate card schema early
  validateCard(card);

  // Determine body
  let body = '';
  if (args.body.length === 1 && args.body[0] === '-') {
    // Body from stdin - but stdin might already be consumed for YAML
    // This case is handled before this function
    body = '';
  } else if (args.body.length > 0) {
    body = args.body.join(' ');
  } else if (payload?.body) {
    body = payload.body;
  }

  // If card is present, generate body from card
  if (card && !body) {
    body = generateCardBody(card);
  }

  // Merge actions
  let actions = [];
  if (payload?.actions && Array.isArray(payload.actions)) {
    actions = payload.actions.map(a => {
      if (typeof a === 'string') return parseAction(a);
      if (typeof a === 'object') return a;
      return null;
    }).filter(Boolean);
  }
  if (args.actions.length > 0) {
    for (const actionStr of args.actions) {
      actions.push(parseAction(actionStr));
    }
  }
  // Auto-generate actions from card if none specified
  if (actions.length === 0 && card) {
    actions = generateActionsFromCard(card);
  }

  if (!summary) {
    throw new Error('summary is required');
  }

  // Build the ontology import document
  const importDoc = {
    _class: 'Queue',
    _id: queueId,
    components: {
      notification: {
        summary: sanitizeText(summary),
        body: sanitizeText(body),
        urgency: urgency,
        timeout: timeout,
        await: awaitResult,
        created: new Date().toISOString(),
      }
    }
  };

  if (appName) importDoc.components.notification.appName = appName;
  if (category) importDoc.components.notification.category = category;
  if (actions.length > 0) importDoc.components.notification.actions = actions;
  if (card) importDoc.components.notification.card = card;

  // Write temp file for ontology import
  const tmpDir = join(ENQUEUE_CLI_ROOT, '.tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, `import-${queueId}.yaml`);

  writeFileSync(tmpFile, stringify(importDoc));

  try {
    await runOntology(['import', tmpFile, '--force']);

    if (printId) {
      console.log(queueId);
    }

    if (awaitResult) {
      await awaitResponse(queueId, timeout > 0 ? timeout + 1000 : 0);
    }
  } finally {
    // Clean up temp file
    try {
      Bun.spawnSync(['rm', '-f', tmpFile]);
    } catch {}
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function run(argv) {
  try {
    const args = parseArgs(argv);

    if (args.help) {
      printHelp();
      return;
    }

    if (args.version) {
      printVersion();
      return;
    }

    // Handle subcommands
    if (args.subcommand) {
      switch (args.subcommand) {
        case 'list':
          await cmdList(args.subcommandArgs);
          return;
        case 'view':
          await cmdView(args.subcommandArgs);
          return;
        case 'respond':
          await cmdRespond(args.subcommandArgs);
          return;
        case 'rm':
          await cmdRm(args.subcommandArgs);
          return;
        case 'wait':
          await cmdWait(args.subcommandArgs);
          return;
        default:
          throw new Error(`Unknown subcommand: ${args.subcommand}`);
      }
    }

    // Load YAML payload
    let payload = null;
    let stdinContent = null;

    // Check for body='-' (read body from stdin as text)
    const bodyFromStdin = args.body.length === 1 && args.body[0] === '-';

    if (args.file) {
      if (args.file === '-') {
        stdinContent = await loadStdin();
        payload = parseYamlPayload(stdinContent);
      } else {
        const fileContent = loadYamlFromFile(args.file);
        payload = parseYamlPayload(fileContent);
      }
    } else if (!process.stdin.isTTY && !bodyFromStdin) {
      // Stdin is piped and we're not using it for body text
      stdinContent = await loadStdin();
      if (stdinContent.trim()) {
        payload = parseYamlPayload(stdinContent);
      }
    }

    // Handle body='-' case
    if (bodyFromStdin && !args.file) {
      const stdinBody = await loadStdin();
      args.body = [stdinBody];
    }

    // If nothing provided, show help
    if (!payload && !args.summary && args.body.length === 0 && args.actions.length === 0) {
      printHelp();
      return;
    }

    await createQueueItem(args, payload);

  } catch (err) {
    console.error(`enqueue: ${err.message}`);
    process.exit(1);
  }
}
