#!/usr/bin/env bun
import { parse, stringify } from 'yaml';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TASK_CLI_ROOT = dirname(__dirname);

const ANSI_RESET = '\x1b[0m';
const ANSI_GREEN = '\x1b[38;2;80;200;120m';
const ANSI_YELLOW = '\x1b[38;2;235;195;90m';
const ANSI_RED = '\x1b[38;2;235;95;95m';

function colorize(text, color) {
  return `${color}${text}${ANSI_RESET}`;
}

function colorizeIndexAction(action) {
  if (action === 'adding') return colorize(action, ANSI_GREEN);
  if (action === 'updating') return colorize(action, ANSI_YELLOW);
  if (action === 'deleting') return colorize(action, ANSI_RED);
  return action;
}

function extractIdFromTaskFilePath(filePath) {
  const idMatch = filePath.match(/([a-f0-9]{40})\.md$/i);
  return idMatch ? idMatch[1].toLowerCase() : null;
}

function findOntologyRoot(startDir = process.cwd()) {
  const envRoot = process.env.TASK_ONTOLOGY_ROOT;
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
    return join(envDb, 'storage');
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
      return join(process.env.HOME || '', storagePath.slice(1));
    }
    return storagePath;
  } catch {
    return join(homedir(), '.ontology', 'storage');
  }
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
    throw new Error((stderr || stdout || `ontology ${args.join(' ')} failed`).trim());
  }

  return stdout;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  return { command, rest };
}

function shortId(id) {
  return (id || '').slice(0, 6);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelative(targetDate, now = new Date()) {
  const date = toDateOrNull(targetDate);
  if (!date) return '-';
  const diffMs = date.getTime() - now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round(Math.abs(diffMs) / dayMs);
  if (diffMs >= 0) return `in ${days}d`;
  return `${days}d ago`;
}

function extractEntryDate(task) {
  const explicit = toDateOrNull(task?.created || task?.workunit?.created);
  if (explicit) return explicit;

  for (const entry of asArray(task.workunit?.journal)) {
    const m = String(entry).match(/^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?)/);
    if (m) {
      const dt = toDateOrNull(m[1]);
      if (dt) return dt;
    }
  }

  return null;
}

function formatMarkdownTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

async function listTaskIds() {
  const out = await runOntology(['search', 'Task']);
  const ids = new Set();

  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/\b([a-f0-9]{40})\b/gi);
    if (!m) continue;
    for (const token of m) ids.add(token.toLowerCase());
  }

  return [...ids];
}

function splitGetSections(text) {
  const lines = text.split(/\r?\n/);
  const header = lines[0] || '';
  const classMatch = header.match(/^Class\s+([^:]+):([^\s#]+)/);
  const id = classMatch?.[1]?.trim();
  const className = classMatch?.[2]?.trim();

  const pIdx = lines.findIndex((l) => l.trim() === 'Properties:');
  const rIdx = lines.findIndex((l) => l.trim() === 'Relations:');

  let pBlock = '';
  let rBlock = '';

  if (pIdx >= 0) {
    const pStart = pIdx + 1;
    const pEnd = rIdx >= 0 ? rIdx : lines.length;
    pBlock = lines.slice(pStart, pEnd).join('\n');
  }

  if (rIdx >= 0) {
    rBlock = lines.slice(rIdx + 1).join('\n');
  }

  return { id, className, pBlock, rBlock };
}

function parseYamlBlock(block) {
  if (!block.trim()) return {};
  try {
    return parse(block) || {};
  } catch {
    return {};
  }
}

async function getTaskById(id) {
  const out = await runOntology(['get', id, '--quiet']);
  const { id: gotId, className, pBlock, rBlock } = splitGetSections(out);
  if (!gotId || className !== 'Task') {
    throw new Error(`Instance ${id} is not a Task`);
  }

  const props = parseYamlBlock(pBlock);
  const rel = parseYamlBlock(rBlock);
  const components = props.components || {};
  const workunit = components.workunit || {};

  return {
    id: gotId,
    className,
    components,
    workunit,
    relations: rel,
    raw: out
  };
}

async function loadTasks() {
  const ids = await listTaskIds();
  const tasks = [];

  for (const id of ids) {
    tasks.push(await getTaskById(id));
  }

  return tasks;
}

function topoSortTasks(tasks) {
  const idSet = new Set(tasks.map((t) => t.id));
  const inDegree = new Map();
  const children = new Map();

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    children.set(task.id, []);
  }

  for (const task of tasks) {
    const parents = asArray(task.workunit.dependsOn).filter((id) => idSet.has(id));
    inDegree.set(task.id, parents.length);
    for (const parentId of parents) {
      children.get(parentId).push(task.id);
    }
  }

  const queue = [...tasks.map((t) => t.id).filter((id) => inDegree.get(id) === 0)].sort();
  const sorted = [];

  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);
    for (const childId of children.get(id) || []) {
      const next = (inDegree.get(childId) || 0) - 1;
      inDegree.set(childId, next);
      if (next === 0) {
        queue.push(childId);
        queue.sort();
      }
    }
  }

  if (sorted.length !== tasks.length) {
    return tasks.map((t) => t.id).sort();
  }

  return sorted;
}

function estimateDurationDays(workunit) {
  const o = toDateOrNull(workunit.estimateOptimistic);
  const l = toDateOrNull(workunit.estimateLikely);
  if (o && l) {
    const d = Math.max(1, Math.round((l.getTime() - o.getTime()) / (24 * 60 * 60 * 1000)));
    return d;
  }
  return 1;
}

function shortestChain(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map(tasks.map((t) => [t.id, []]));
  const inDegree = new Map(tasks.map((t) => [t.id, 0]));

  for (const task of tasks) {
    for (const parentId of asArray(task.workunit.dependsOn)) {
      if (!byId.has(parentId)) continue;
      children.get(parentId).push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
    }
  }

  const roots = tasks.map((t) => t.id).filter((id) => (inDegree.get(id) || 0) === 0);
  if (roots.length === 0) return [];

  const dist = new Map(tasks.map((t) => [t.id, Number.POSITIVE_INFINITY]));
  const prev = new Map();

  for (const r of roots) {
    dist.set(r, estimateDurationDays(byId.get(r).workunit));
  }

  const ordered = topoSortTasks(tasks);
  for (const id of ordered) {
    const base = dist.get(id);
    if (!Number.isFinite(base)) continue;
    for (const childId of children.get(id) || []) {
      const cand = base + estimateDurationDays(byId.get(childId).workunit);
      if (cand < dist.get(childId)) {
        dist.set(childId, cand);
        prev.set(childId, id);
      }
    }
  }

  const leaves = tasks.map((t) => t.id).filter((id) => (children.get(id) || []).length === 0);
  if (leaves.length === 0) return [roots.sort()[0]];

  let bestLeaf = leaves[0];
  for (const leaf of leaves) {
    const current = dist.get(bestLeaf);
    const value = dist.get(leaf);
    if ((Number.isFinite(value) && value < current) || !Number.isFinite(current)) {
      bestLeaf = leaf;
    }
  }

  const path = [];
  let cursor = bestLeaf;
  while (cursor) {
    path.push(cursor);
    cursor = prev.get(cursor);
  }

  return path.reverse();
}

function buildDependencyMaps(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dependents = new Map(tasks.map((t) => [t.id, []]));

  for (const task of tasks) {
    for (const parentId of asArray(task.workunit.dependsOn)) {
      if (!byId.has(parentId)) continue;
      dependents.get(parentId).push(task.id);
    }
  }

  return { byId, dependents };
}

function scoreTask(task, ctx, now, memo, stack) {
  if (memo.has(task.id)) return memo.get(task.id);
  if (stack.has(task.id)) return 0;

  stack.add(task.id);
  const wu = task.workunit || {};
  let score = 0;

  if (wu.important && wu.urgent) score += 18;
  else if (wu.important) score += 9;
  else if (wu.urgent) score += 3;

  if (wu.important && wu.urgent) score += 4;
  score += (Number(wu.weight) || 0) * 2;

  const due = toDateOrNull(wu.due);
  if (due) {
    const daysToDue = (due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    const daysOverdue = Math.max(0, -daysToDue);
    let duePressure = 0;

    if (daysOverdue > 0) {
      duePressure = 12 + (daysOverdue ** 1.8) * 5;
    } else {
      duePressure = 12 * (1 / (1 + Math.exp(0.7 * daysToDue))) * 1.5;
    }

    if (wu.urgent) duePressure *= 1.4;
    score += duePressure;
  }

  if (!due && (wu.estimateOptimistic || wu.estimateLikely || wu.estimatePessimistic)) {
    const likely = toDateOrNull(wu.estimateLikely);
    const pessimistic = toDateOrNull(wu.estimatePessimistic);

    if (likely) {
      const daysToLikely = (likely.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
      if (daysToLikely >= 0 && daysToLikely <= 14) {
        score += 6 * (1 - (daysToLikely / 14)) ** 2;
      }
    }

    if (likely && pessimistic) {
      const overrunRisk = (pessimistic.getTime() - likely.getTime()) / (24 * 60 * 60 * 1000);
      score += Math.min(8, overrunRisk * 0.8);
    }
  }

  const dependents = ctx.dependents.get(task.id) || [];
  if (dependents.length > 0) {
    let maxBlockedScore = 0;
    for (const depId of dependents) {
      const depTask = ctx.byId.get(depId);
      if (!depTask) continue;
      maxBlockedScore = Math.max(maxBlockedScore, scoreTask(depTask, ctx, now, memo, stack));
    }
    score = Math.max(score, maxBlockedScore * 0.95);
  }

  const dependencies = asArray(wu.dependsOn);
  const isBlocked = dependencies.some((depId) => {
    const depTask = ctx.byId.get(depId);
    const depStatus = depTask?.workunit?.status;
    return depTask && depStatus !== 'success';
  });
  if (isBlocked) score += -7;

  const tagCoefficients = {
    '#today': 14,
    '#blocked': -8,
    '#research': 2,
    '#someday': -10,
    '#critical': 12
  };
  for (const tag of asArray(wu.tags)) {
    const coeff = tagCoefficients[tag];
    if (typeof coeff === 'number') score += coeff;
  }

  score += asArray(wu.stakeholders).length * 0.8;

  if (wu.status === 'running') score += 5;
  else if (wu.status === 'success' || wu.status === 'fail') score -= 20;

  const entryDate = extractEntryDate(task);
  if (entryDate) {
    const ageDays = Math.max(0, (now.getTime() - entryDate.getTime()) / (24 * 60 * 60 * 1000));
    score += 1.2 * Math.sqrt(ageDays);
  }

  stack.delete(task.id);
  memo.set(task.id, score);
  return score;
}

function priorityGlyph(wu) {
  const p = [];
  if (wu.urgent) p.push('U');
  if (wu.important) p.push('I');
  return p.length ? p.join('') : '-';
}

async function resolveTaskId(idOrPrefix) {
  const ids = await listTaskIds();
  const exact = ids.find((id) => id === idOrPrefix);
  if (exact) return exact;

  const candidates = ids.filter((id) => id.startsWith(idOrPrefix));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new Error(`No Task found for id/prefix: ${idOrPrefix}`);
  }

  throw new Error(`Ambiguous prefix '${idOrPrefix}'. Matches: ${candidates.map(shortId).join(', ')}`);
}

async function cmdTree(args) {
  const crit = args.includes('--crit');
  const tasks = await loadTasks();
  const byId = new Map(tasks.map((t) => [t.id, t]));

  let orderedIds = topoSortTasks(tasks);
  if (crit) {
    const chain = shortestChain(tasks);
    const chainSet = new Set(chain);
    orderedIds = orderedIds.filter((id) => chainSet.has(id));
    orderedIds.sort((a, b) => chain.indexOf(a) - chain.indexOf(b));
  }

  const rows = orderedIds.map((id) => {
    const task = byId.get(id);
    const parents = asArray(task.workunit.dependsOn).map(shortId).join(', ');
    return [shortId(id), String(task.workunit.summary || '').replace(/\|/g, '\\|'), parents || '-'];
  });

  console.log(formatMarkdownTable(['id', 'desc', 'parents'], rows));
}

async function cmdNext(args) {
  let limit = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-l' || arg === '--limit') && args[i + 1]) {
      limit = Number(args[i + 1]);
      i += 1;
    }
  }

  const now = new Date();
  const tasks = await loadTasks();
  const ctx = buildDependencyMaps(tasks);
  const memo = new Map();

  const candidates = tasks
    .filter((t) => !['success', 'fail'].includes(String(t.workunit.status || '')))
    .map((task) => ({
      task,
      nextScore: scoreTask(task, ctx, now, memo, new Set())
    }))
    .sort((a, b) => {
      if (b.nextScore !== a.nextScore) return b.nextScore - a.nextScore;
      const aw = Number(a.task.workunit.weight) || 0;
      const bw = Number(b.task.workunit.weight) || 0;
      if (bw !== aw) return bw - aw;
      return a.task.id.localeCompare(b.task.id);
    });

  const finalRows = (limit && limit > 0 ? candidates.slice(0, limit) : candidates).map(({ task }) => {
    const wu = task.workunit;
    const ageDate = extractEntryDate(task);
    const depsCount = (ctx.dependents.get(task.id) || []).length;
    const deps = depsCount > 0 ? String(depsCount) : '-';

    return [
      shortId(task.id),
      ageDate ? formatRelative(ageDate, now).replace('in ', '') : '-',
      deps,
      priorityGlyph(wu),
      asArray(wu.tags).join(', '),
      formatRelative(wu.due, now),
      wu.worker || '-',
      String(wu.summary || '').replace(/\|/g, '\\|')
    ];
  });

  console.log(formatMarkdownTable(['id', 'age', 'deps', 'p', 'tags', 'due', 'worker', 'summary'], finalRows));
}

async function cmdView(args) {
  const idArg = args[0];
  if (!idArg) {
    throw new Error('Usage: task view <id-or-prefix>');
  }

  const id = await resolveTaskId(idArg);
  const task = await getTaskById(id);
  const doc = {
    apiVersion: 'agent/v1',
    kind: 'Ontology',
    spec: {
      classes: [
        {
          _class: 'Task',
          _id: id,
          components: task.components,
          ...(Object.keys(task.relations || {}).length ? { relations: task.relations } : {})
        }
      ]
    }
  };

  process.stdout.write(stringify(doc));
}

async function cmdTake(args) {
  const idArg = args[0];
  const worker = args[1];

  if (!idArg || !worker) {
    throw new Error('Usage: task take <id-or-prefix> <worker>');
  }

  const id = await resolveTaskId(idArg);
  const task = await getTaskById(id);
  const currentWorker = String(task.workunit.worker || '').trim();

  if (!currentWorker) {
    await runOntology(['set', `${id}:Task`, `workunit.worker=${worker}`]);
    console.log('you acquired the task lock');
    return;
  }

  if (currentWorker === worker) {
    await runOntology(['set', `${id}:Task`, `workunit.worker=${worker}`]);
    console.log('you already hold the task lock');
    return;
  }

  console.log(`you may not have it, because another worker "${currentWorker}" currently has the the task lock`);
}

async function cmdRelease(args) {
  const idArg = args[0];
  const worker = args[1];

  if (!idArg || !worker) {
    throw new Error('Usage: task release <id-or-prefix> <worker>');
  }

  const id = await resolveTaskId(idArg);
  const task = await getTaskById(id);
  const currentWorker = String(task.workunit.worker || '').trim();

  if (currentWorker === worker) {
    await runOntology(['set', `${id}:Task`, 'workunit.worker=']);
    console.log('you released the task lock');
    return;
  }

  console.log(`you do not hold the lock, another worker "${currentWorker}" does`);
}

function buildTaskBody(wu) {
  const summary = wu.summary || '';
  const description = wu.description || '';
  const journal = asArray(wu.journal);

  let body = `# ${summary}\n\n${description}\n\n# journal\n`;
  for (const entry of journal) {
    body += `- ${entry}\n`;
  }
  return body.trim();
}

async function cmdIndex() {
  const dbDir = join(TASK_CLI_ROOT, 'db');
  const lastrunPath = join(dbDir, '.lastrun');
  const indexedFilesPath = join(dbDir, '.indexed-files');
  const memoDbPath = join(dbDir, 'tasks');
  const memoYamlPath = `${memoDbPath}.yaml`;
  const memoBlobPath = `${memoDbPath}.memo`;

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const storagePath = getOntologyStoragePath();
  const taskDir = join(storagePath, 'Task');

  const resetMemoDb = () => {
    if (existsSync(memoYamlPath)) rmSync(memoYamlPath);
    if (existsSync(memoBlobPath)) rmSync(memoBlobPath);
  };

  const loadIndexedFiles = () => {
    if (!existsSync(indexedFilesPath)) return new Set();
    const content = readFileSync(indexedFilesPath, 'utf8');
    const items = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return new Set(items);
  };

  const saveIndexedFiles = (items) => {
    const ordered = [...items].sort();
    writeFileSync(indexedFilesPath, ordered.join('\n') + (ordered.length ? '\n' : ''), 'utf8');
  };

  const loadLastRunTime = () => {
    if (!existsSync(lastrunPath)) return 0;
    try {
      return Number(readFileSync(lastrunPath, 'utf8').trim()) || 0;
    } catch {
      return 0;
    }
  };

  const saveLastRunTime = () => {
    writeFileSync(lastrunPath, String(Date.now()), 'utf8');
  };

  if (!existsSync(taskDir)) {
    console.log('No Task directory found; nothing to index.');
    resetMemoDb();
    saveIndexedFiles(new Set());
    saveLastRunTime();
    return;
  }

  const files = readdirSync(taskDir).filter((f) => f.endsWith('.md'));
  const currentFiles = files.map((file) => join(taskDir, file));
  const currentFileSet = new Set(currentFiles);

  const indexedFiles = loadIndexedFiles();
  const deletedIndexedFiles = [...indexedFiles].filter((filePath) => !currentFileSet.has(filePath));
  const shouldRebuild = deletedIndexedFiles.length > 0;
  const deletedOps = deletedIndexedFiles.map((filePath) => ({
    action: 'deleting',
    filePath,
    id: extractIdFromTaskFilePath(filePath)
  }));

  let toIndex;
  if (shouldRebuild) {
    resetMemoDb();
    toIndex = currentFiles;
  } else {
    const lastRunTime = loadLastRunTime();
    toIndex = currentFiles.filter((filePath) => {
      try {
        return statSync(filePath).mtimeMs > lastRunTime;
      } catch {
        return false;
      }
    });
  }

  if (toIndex.length === 0) {
    if (shouldRebuild) {
      for (const op of deletedOps) {
        const target = op.id || op.filePath;
        console.log(`${colorizeIndexAction(op.action)} ${target}`);
      }
      saveIndexedFiles(new Set());
      saveLastRunTime();
    } else {
      console.log('All tasks up to date; nothing to index.');
      saveLastRunTime();
    }
    return;
  }

  const docs = [];
  const indexedThisRun = new Set();
  const indexedOps = [];
  for (const filePath of toIndex) {
    const id = extractIdFromTaskFilePath(filePath);
    if (!id) continue;

    let task;
    try {
      task = await getTaskById(id);
    } catch {
      continue;
    }

    const wu = task.workunit || {};

    const metadata = {
      id: wu.id || id,
      important: wu.important ?? false,
      urgent: wu.urgent ?? false,
      weight: wu.weight ?? 0,
      tags: asArray(wu.tags),
      stakeholders: asArray(wu.stakeholders),
      status: wu.status || 'idle',
      worker: wu.worker || '',
      due: wu.due || '',
      estimateOptimistic: wu.estimateOptimistic || '',
      estimateLikely: wu.estimateLikely || '',
      estimatePessimistic: wu.estimatePessimistic || '',
      dependsOn: asArray(wu.dependsOn),
      correlations: asArray(wu.correlations)
    };

    const body = buildTaskBody(wu);
    docs.push({ metadata, body });
    indexedThisRun.add(filePath);
    indexedOps.push({
      action: indexedFiles.has(filePath) ? 'updating' : 'adding',
      id,
      filePath
    });
  }

  if (docs.length === 0) {
    if (shouldRebuild) {
      for (const op of deletedOps) {
        const target = op.id || op.filePath;
        console.log(`${colorizeIndexAction(op.action)} ${target}`);
      }
      resetMemoDb();
      saveIndexedFiles(new Set());
    } else {
      console.log('No valid tasks found to index.');
    }
    saveLastRunTime();
    return;
  }

  const yamlContent = docs.map((d) => stringify(d)).join('---\n');
  const tmpFile = join(TASK_CLI_ROOT, '.memo-input.yaml');
  writeFileSync(tmpFile, yamlContent, 'utf8');

  const proc = Bun.spawn(['memo', '-f', memoDbPath, 'save', tmpFile], {
    cwd: TASK_CLI_ROOT,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    throw new Error(`memo save failed: ${stderr || stdout}`.trim());
  }

  if (shouldRebuild) {
    saveIndexedFiles(indexedThisRun);
  } else {
    for (const filePath of indexedThisRun) {
      indexedFiles.add(filePath);
    }
    saveIndexedFiles(indexedFiles);
  }
  saveLastRunTime();

  for (const op of deletedOps) {
    const target = op.id || op.filePath;
    console.log(`${colorizeIndexAction(op.action)} ${target}`);
  }
  for (const op of indexedOps) {
    console.log(`${colorizeIndexAction(op.action)} ${op.id}`);
  }
}

function generateRandomSha1() {
  const content = `${Date.now()}|${Math.random()}|${process.hrtime.bigint()}`;
  return createHash('sha1').update(content).digest('hex');
}

async function generateUniqueTaskId() {
  const existingIds = await listTaskIds();
  const existingSet = new Set(existingIds);
  
  for (let attempts = 0; attempts < 100; attempts++) {
    const candidate = generateRandomSha1();
    if (!existingSet.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('Failed to generate unique task ID after 100 attempts');
}

function validateDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return { valid: true, value: null };

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return {
        valid: false,
        error: `${fieldName} is not a valid date. Supported formats: YYYY-MM-DD or ISO-8601 datetime (e.g. 2026-07-01T15:30:00Z)`
      };
    }
    return { valid: true, value: value.toISOString() };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

    if (dateOnlyPattern.test(trimmed)) {
      return { valid: true, value: trimmed };
    }

    if (isoPattern.test(trimmed)) {
      const parsed = toDateOrNull(trimmed);
      if (parsed) return { valid: true, value: trimmed };
    }

    return {
      valid: false,
      error: `${fieldName} is not a valid date. Supported formats: YYYY-MM-DD or ISO-8601 datetime (e.g. 2026-07-01T15:30:00Z)`
    };
  }

  const d = toDateOrNull(value);
  if (!d) {
    return {
      valid: false,
      error: `${fieldName} is not a valid date. Supported formats: YYYY-MM-DD or ISO-8601 datetime (e.g. 2026-07-01T15:30:00Z)`
    };
  }

  return { valid: true, value: value };
}

async function validateTaskInput(input) {
  const errors = [];
  const warnings = [];

  // Check required fields
  if (typeof input.important !== 'boolean') {
    errors.push('important: required boolean field');
  }
  if (typeof input.urgent !== 'boolean') {
    errors.push('urgent: required boolean field');
  }
  if (!input.summary || typeof input.summary !== 'string' || !input.summary.trim()) {
    errors.push('summary: required non-empty string');
  }
  if (!input.description || typeof input.description !== 'string' || !input.description.trim()) {
    errors.push('description: required non-empty string');
  }

  // Validate weight (0-1000)
  if (input.weight !== undefined) {
    const w = Number(input.weight);
    if (!Number.isInteger(w) || w < 0 || w > 1000) {
      errors.push('weight: must be an integer between 0 and 1000');
    }
  }

  // Validate status enum
  const validStatuses = ['idle', 'running', 'success', 'fail'];
  const status = input.status || 'idle';
  if (!validStatuses.includes(status)) {
    errors.push(`status: must be one of ${validStatuses.join(', ')}`);
  }

  // Validate worker requirement based on status
  if (status !== 'idle' && (!input.worker || !String(input.worker).trim())) {
    errors.push('worker: required when status is not idle');
  }

  // Validate tags (must start with #)
  const tags = asArray(input.tags);
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.startsWith('#')) {
      errors.push(`tags: each tag must be a string starting with #, got: ${tag}`);
    }
  }

  // Validate stakeholders (must start with @)
  const stakeholders = asArray(input.stakeholders);
  for (const sh of stakeholders) {
    if (typeof sh !== 'string' || !sh.startsWith('@')) {
      errors.push(`stakeholders: each must be a string starting with @, got: ${sh}`);
    }
  }

  // Validate dates
  for (const field of ['due', 'estimateOptimistic', 'estimateLikely', 'estimatePessimistic']) {
    const result = validateDate(input[field], field);
    if (!result.valid) {
      errors.push(result.error);
    } else if (result.value !== null && result.value !== undefined) {
      input[field] = result.value;
    }
  }

  // Validate id - if provided, must exist (update mode)
  let isUpdate = false;
  let existingTask = null;
  if (input.id && String(input.id).trim()) {
    const taskIds = await listTaskIds();
    const fullId = taskIds.find((tid) => tid === input.id || tid.startsWith(input.id));
    if (!fullId) {
      errors.push(`id: task with id '${input.id}' does not exist (for updates, id must exist)`);
    } else {
      isUpdate = true;
      existingTask = await getTaskById(fullId);
      input.id = fullId; // Expand to full id
    }
  }

  // Validate dependsOn - all referenced IDs must exist
  const dependsOn = asArray(input.dependsOn);
  if (dependsOn.length > 0) {
    const taskIds = await listTaskIds();
    for (const depId of dependsOn) {
      const found = taskIds.find((tid) => tid === depId || tid.startsWith(depId));
      if (!found) {
        errors.push(`dependsOn: referenced task '${depId}' does not exist`);
      }
    }
  }

  return { errors, warnings, isUpdate, existingTask };
}

async function cmdUpsert(args) {
  const filePath = args[0];
  if (!filePath) {
    throw new Error('Usage: task upsert <file.yaml>');
  }

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  let input;
  try {
    const content = readFileSync(filePath, 'utf8');
    input = parse(content);
  } catch (e) {
    throw new Error(`Failed to parse YAML: ${e.message}`);
  }

  if (!input || typeof input !== 'object') {
    throw new Error('Invalid YAML: expected an object');
  }

  // Validate input
  const { errors, warnings, isUpdate, existingTask } = await validateTaskInput(input);

  if (warnings.length > 0) {
    for (const w of warnings) console.warn(`warning: ${w}`);
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  // Generate ID for insert or use existing
  const taskId = isUpdate ? input.id : await generateUniqueTaskId();

  const hasNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
  const hasNumber = (value) => typeof value === 'number' && Number.isFinite(value);
  const nonEmptyArray = (value) => {
    const arr = asArray(value);
    return arr.length > 0 ? arr : null;
  };

  const tags = nonEmptyArray(input.tags);
  const stakeholders = nonEmptyArray(input.stakeholders);
  const dependsOn = nonEmptyArray(input.dependsOn);
  const correlations = nonEmptyArray(input.correlations);
  const journal = nonEmptyArray(input.journal);

  // Prepare normalized data for ontology import format
  const importDoc = {
    _class: 'Task',
    _id: taskId,
    components: {
      workunit: {
        id: taskId,
        important: input.important,
        urgent: input.urgent,
        ...(hasNumber(input.weight) ? { weight: input.weight } : {}),
        ...(tags ? { tags } : {}),
        ...(stakeholders ? { stakeholders } : {}),
        status: input.status || 'idle',
        summary: input.summary.trim(),
        description: input.description.trim(),
        ...(hasNonEmptyString(input.worker) ? { worker: input.worker.trim() } : {}),
        ...(hasNonEmptyString(input.due) ? { due: input.due.trim() } : {}),
        ...(hasNonEmptyString(input.estimateOptimistic) ? { estimateOptimistic: input.estimateOptimistic.trim() } : {}),
        ...(hasNonEmptyString(input.estimateLikely) ? { estimateLikely: input.estimateLikely.trim() } : {}),
        ...(hasNonEmptyString(input.estimatePessimistic) ? { estimatePessimistic: input.estimatePessimistic.trim() } : {}),
        ...(dependsOn ? { dependsOn } : {}),
        ...(correlations ? { correlations } : {}),
        ...(journal ? { journal } : {})
      }
    }
  };

  // Write a temporary file for ontology import
  const tmpDir = join(TASK_CLI_ROOT, '.tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, `import-${taskId}.yaml`);

  writeFileSync(tmpFile, stringify(importDoc));

  try {
    await runOntology(['import', tmpFile, '--force']);
    console.log(`${isUpdate ? 'Updated' : 'Created'} task: ${shortId(taskId)} (${taskId})`);

    // Auto-trigger index
    console.log('Indexing...');
    await cmdIndex();
  } finally {
    // Clean up temp file
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(tmpFile);
    } catch {}
  }
}

function printUsage() {
  console.log(`task - Task ontology helper\n\nUsage:\n  task tree [--crit]\n  task next [-l|--limit <n>]\n  task view <id-or-prefix>\n  task take <id-or-prefix> <worker>\n  task release <id-or-prefix> <worker>\n  task index\n  task upsert <file.yaml>`);
}

async function main() {
  const { command, rest } = parseArgs(process.argv.slice(2));

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  switch (command) {
    case 'tree':
      await cmdTree(rest);
      return;
    case 'next':
      await cmdNext(rest);
      return;
    case 'view':
      await cmdView(rest);
      return;
    case 'take':
      await cmdTake(rest);
      return;
    case 'release':
      await cmdRelease(rest);
      return;
    case 'index':
      await cmdIndex();
      return;
    case 'upsert':
      await cmdUpsert(rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((err) => {
  console.error(`task: ${err.message}`);
  process.exit(1);
});
