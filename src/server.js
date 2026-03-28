/**
 * Bun Server Entry Point
 * Serves static files, API endpoints, and WebSocket for chat
 */
import { resolve, dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch, copyFileSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { homedir } from 'os';
import { spawn } from 'node:child_process';
import { createAPI } from './lib/api.js';
import { expandPathsInObject } from './lib/config.js';

// Resolve paths relative to this file
const __dirname = dirname(new URL(import.meta.url).pathname);
const projectRoot = resolve(__dirname, '..');
const publicDir = resolve(projectRoot, 'public');
const configPath = resolve(projectRoot, 'config.yaml');

ensureBootstrapFile(
  resolve(projectRoot, 'config.yaml.example'),
  configPath,
  'config.yaml'
);
ensureBootstrapFile(
  resolve(projectRoot, 'sandbox', '.agent', 'templates', 'ontologist.yaml.example'),
  resolve(projectRoot, 'sandbox', '.agent', 'templates', 'ontologist.yaml'),
  'sandbox/.agent/templates/ontologist.yaml'
);

// Load configuration
const config = loadServerConfig(configPath);
const storagePath = resolveStoragePath(config, projectRoot);

console.log('📂 Storage path:', storagePath);
console.log('📁 Public dir:', publicDir);

// Create API handler
const api = createAPI(storagePath);

// Active chat processes (for abort functionality)
// Map<tabId, { proc, killAttempts }>
const activeProcesses = new Map();
const tabSessions = new Map();
const wsClientIds = new WeakMap();
let nextWsClientId = 1;

// Connected WebSocket clients for broadcasting
const connectedClients = new Set();

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * Load server configuration
 */
function loadServerConfig(path) {
  if (!existsSync(path)) {
    console.warn('Config file not found, using defaults');
    return expandPathsInObject({ storage: { path: '../ontology/storage' }, server: { port: 3000 } });
  }
  const config = parseYaml(readFileSync(path, 'utf8'));
  return expandPathsInObject(config);
}

function ensureBootstrapFile(examplePath, targetPath, label) {
  if (existsSync(targetPath)) return;
  if (!existsSync(examplePath)) {
    console.warn(`Missing ${label} and no example found at ${examplePath}`);
    return;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(examplePath, targetPath);
  console.log(`🧩 Bootstrapped ${label} from ${examplePath}`);
}

/**
 * Resolve storage path relative to project root
 */
function resolveStoragePath(cfg, root) {
  const storagePath = cfg.storage?.path || '../ontology/storage';
  return resolve(root, storagePath);
}

/**
 * Serve static file
 */
async function serveStatic(filePath) {
  if (!existsSync(filePath)) return null;
  
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  
  const file = Bun.file(filePath);
  return new Response(file, {
    headers: { 'Content-Type': mimeType }
  });
}

/**
 * Main request handler
 */
async function handleRequest(req, server) {
  const url = new URL(req.url);
  const path = url.pathname;

  // WebSocket upgrade for chat
  if (path === '/ws/chat') {
    const upgraded = server.upgrade(req);
    if (!upgraded) {
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
    return undefined;
  }

  // API routes
  if (path.startsWith('/api/')) {
    return api.handle(req);
  }

  // Static files
  let filePath = join(publicDir, path);
  
  // Default to index.html for root
  if (path === '/') {
    filePath = join(publicDir, 'index.html');
  }

  const staticResponse = await serveStatic(filePath);
  if (staticResponse) return staticResponse;

  // 404
  return new Response('Not Found', { status: 404 });
}

/**
 * Handle chat WebSocket message
 */
async function handleChatMessage(ws, data) {
  const { type, tabId, content, agent, selection, sessionId } = data;
  const clientId = wsClientIds.get(ws) || 'anon';
  const scopedTabId = `${clientId}:${tabId}`;

  const runtimeConfig = loadServerConfig(configPath);
  const chatConfig = runtimeConfig.chat || {};
  const defaultAgent = chatConfig.defaultAgent || 'default';
  const sandboxDir = resolve(projectRoot, 'sandbox');
  if (!existsSync(sandboxDir)) {
    mkdirSync(sandboxDir, { recursive: true });
  }

  function shellEscape(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
  }

  function parseSummaryLine(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1] || '';
    const match = last.match(/^(\S+)\s+(\S+)\s+(\S+)$/);
    if (!match) return null;
    return {
      sessionId: match[1],
      status: match[2],
      sessionFile: match[3]
    };
  }

  function resolveSessionPath(sessionFile) {
    const relative = String(sessionFile || '').trim();
    if (!relative) return null;
    if (relative.startsWith('/')) return relative;
    return resolve(sandboxDir, relative);
  }

  async function executeWasmCommand(finalCommand) {
    const proc = spawn('sh', ['-c', finalCommand], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: sandboxDir
    });

    activeProcesses.set(scopedTabId, { proc, killAttempts: 0 });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const code = await new Promise((resolve) => {
      proc.on('close', resolve);
    });

    activeProcesses.delete(scopedTabId);
    return { code, stdout, stderr };
  }

  function normalizeAgentName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function mergeCollaborators(existing, additions) {
    const seen = new Set();
    const merged = [];

    for (const item of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(additions) ? additions : [])]) {
      const name = normalizeAgentName(item);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      merged.push(name);
    }

    return merged.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  function upsertSessionCollaborators(absSessionPath, collaborators = [], fallbackName = '') {
    const doc = parseYaml(readFileSync(absSessionPath, 'utf8')) || {};
    doc.metadata = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};

    const primaryName = normalizeAgentName(doc.metadata.name || fallbackName);
    doc.metadata.collaborators = mergeCollaborators(doc.metadata.collaborators, [...collaborators, primaryName]);

    writeFileSync(absSessionPath, stringifyYaml(doc));
    return doc;
  }

  if (type === 'session-update') {
    try {
      const session = data?.session || {};
      const tracked = tabSessions.get(scopedTabId) || {};
      let sessionPath = resolveSessionPath(data?.sessionFile || tracked.sessionFile);

      if (!sessionPath) {
        const tmpDir = resolve(projectRoot, 'tmp', `chat-${tabId}`);
        if (!existsSync(tmpDir)) {
          mkdirSync(tmpDir, { recursive: true });
        }
        sessionPath = join(tmpDir, 'session.yaml');
      }

      const normalized = {
        apiVersion: session?.apiVersion || 'daemon/v1',
        kind: session?.kind || 'AgentSession',
        metadata: {
          ...(session?.metadata || {}),
          updated_at: new Date().toISOString(),
          source: 'gdedit-web'
        },
        spec: {
          system_prompt: session?.spec?.system_prompt || '',
          messages: Array.isArray(session?.spec?.messages) ? session.spec.messages : []
        }
      };

      writeFileSync(sessionPath, stringifyYaml(normalized));

      if (tracked.sessionId || session?.metadata?.id) {
        tabSessions.set(scopedTabId, {
          ...tracked,
          sessionId: tracked.sessionId || session?.metadata?.id || null,
          sessionFile: tracked.sessionFile || data?.sessionFile || null,
          sessionStatus: session?.metadata?.status || tracked.sessionStatus || 'IDLE',
          collaborators: mergeCollaborators(tracked.collaborators, session?.metadata?.collaborators)
        });
      }

      ws.send(JSON.stringify({ type: 'session-saved', tabId }));
    } catch (error) {
      console.error('Failed to persist session snapshot:', error);
      ws.send(JSON.stringify({
        type: 'error',
        tabId,
        content: `Failed to save session: ${error.message}`
      }));
    }
    return;
  }

  if (type === 'abort') {
    const entry = activeProcesses.get(scopedTabId);
    if (entry && entry.proc) {
      entry.killAttempts = (entry.killAttempts || 0) + 1;
      const pid = entry.proc.pid;
      const signal = entry.killAttempts === 1 ? 'SIGINT' : 'SIGKILL';
      
      console.log(`🛑 Stop attempt ${entry.killAttempts} for tab ${tabId}: sending ${signal} to process group (pid: ${pid})`);
      
      try {
        // Kill entire process group (negative PID) - works cross-platform with detached spawn
        process.kill(-pid, signal);
      } catch (e) {
        console.error(`Failed to send ${signal} to process group:`, e.message);
        // Fallback: try direct kill
        try {
          entry.proc.kill(signal);
        } catch (e2) {
          console.error('Fallback kill also failed:', e2.message);
        }
      }
      
      ws.send(JSON.stringify({
        type: 'stop-ack',
        tabId: tabId,
        attempt: entry.killAttempts,
        signal: signal
      }));
    } else {
      // No active process, send done to reset client state
      ws.send(JSON.stringify({
        type: 'stop-ack',
        tabId: tabId,
        attempt: 0,
        signal: null,
        noProcess: true
      }));
    }
    return;
  }

  if (type !== 'chat-start' && type !== 'chat-continue' && type !== 'chat') return;

  try {
    const tracked = tabSessions.get(scopedTabId) || {};
    const agentName = agent || defaultAgent;
    const now = Date.now().toString();
    const promptText = typeof content === 'string' ? content.trim() : '';
    const hasPrompt = promptText.length > 0;

    function buildUserEntry(promptContent) {
      const text = String(promptContent || '').trim();
      return {
        role: 'user',
        verbatim: { content: text, timestamp: now },
        meta: { sent: false, visible: true }
      };
    }

    function formatCurrentSelection(sel) {
      if (!Array.isArray(sel) || sel.length === 0) return '';
      return sel.map((item) => `- ${item.id}:${item.class}`).join('\n');
    }

    function upsertCurrentSelectionTag(systemPrompt, sel) {
      const basePrompt = String(systemPrompt || '');
      const selectionText = formatCurrentSelection(sel);
      const tagRegex = /<currentSelection>[\s\S]*?<\/currentSelection>/;
      const replacement = selectionText
        ? `<currentSelection>\n${selectionText}\n</currentSelection>`
        : '<currentSelection></currentSelection>';

      if (tagRegex.test(basePrompt)) {
        return basePrompt.replace(tagRegex, replacement);
      }

      const separator = basePrompt.endsWith('\n') || basePrompt.length === 0 ? '' : '\n';
      return `${basePrompt}${separator}\n${replacement}`;
    }

    function injectUserMessage(absSessionPath, promptContent, sel, collaborators = [], fallbackName = '') {
      const doc = parseYaml(readFileSync(absSessionPath, 'utf8')) || {};
      doc.metadata = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
      const primaryName = normalizeAgentName(doc.metadata.name || fallbackName);
      doc.metadata.collaborators = mergeCollaborators(doc.metadata.collaborators, [...collaborators, primaryName]);
      if (!doc.spec) doc.spec = {};
      doc.spec.system_prompt = upsertCurrentSelectionTag(doc.spec.system_prompt, sel);
      if (!Array.isArray(doc.spec.messages)) doc.spec.messages = [];
      doc.spec.messages.push(buildUserEntry(promptContent));
      writeFileSync(absSessionPath, stringifyYaml(doc));
    }

    async function runWasm1Turn(sid) {
      const cmd = `wasm1 -s ${shellEscape(sid)}`;
      console.log('🤖 Running turn:', cmd);
      return await executeWasmCommand(cmd);
    }

    async function finishWithSnapshot(result, collaborators = [], fallbackName = '') {
      const { code, stdout, stderr } = result;
      const summary = parseSummaryLine(stdout);
      if (!summary) {
        ws.send(JSON.stringify({
          type: 'error',
          tabId,
          content: code === 0
            ? 'Chat run completed without a readable session summary.'
            : (stderr?.trim() || `Chat run failed (exit ${code}).`)
        }));
        ws.send(JSON.stringify({ type: 'done', tabId, exitCode: code }));
        return;
      }

      const absPath = resolveSessionPath(summary.sessionFile);
      if (!absPath || !existsSync(absPath)) {
        ws.send(JSON.stringify({ type: 'error', tabId, content: `Session file not found: ${summary.sessionFile}` }));
        ws.send(JSON.stringify({ type: 'done', tabId, exitCode: code }));
        return;
      }

      const sessionDoc = upsertSessionCollaborators(absPath, collaborators, fallbackName);
      const trackedSession = tabSessions.get(scopedTabId) || {};
      tabSessions.set(scopedTabId, {
        ...trackedSession,
        sessionId: summary.sessionId,
        sessionFile: summary.sessionFile,
        sessionStatus: summary.status,
        collaborators: sessionDoc?.metadata?.collaborators || trackedSession.collaborators || []
      });

      ws.send(JSON.stringify({
        type: 'session-snapshot',
        tabId,
        sessionId: summary.sessionId,
        sessionFile: summary.sessionFile,
        sessionStatus: summary.status,
        session: sessionDoc,
        exitCode: code
      }));

      if (code !== 0 && stderr?.trim()) {
        ws.send(JSON.stringify({ type: 'error', tabId, content: stderr.trim() }));
      }

      ws.send(JSON.stringify({ type: 'done', tabId, exitCode: code }));
    }

    // Reuse tracked session so repeated sends continue the same session
    const existingSessionId = (type === 'chat-continue' ? sessionId : null) || tracked.sessionId;
    const existingSessionFile = tracked.sessionFile;

    if (existingSessionId && existingSessionFile) {
      // --- Continue existing session ---
      const absFile = resolveSessionPath(existingSessionFile);
      if (!absFile || !existsSync(absFile)) {
        ws.send(JSON.stringify({ type: 'error', tabId, content: `Tracked session file not found: ${existingSessionFile || '(missing)'}` }));
        ws.send(JSON.stringify({ type: 'done', tabId, exitCode: 1 }));
        return;
      }
      const persistedCollaborators = mergeCollaborators(tracked.collaborators, []);
      const requestedCollaborators = agent ? [agentName] : [];
      if (hasPrompt) {
        injectUserMessage(absFile, promptText, selection, mergeCollaborators(persistedCollaborators, requestedCollaborators), agentName);
      }
      const result = await runWasm1Turn(existingSessionId);
      await finishWithSnapshot(result, mergeCollaborators(persistedCollaborators, requestedCollaborators), agentName);
    } else {
      // --- New session ---
      const createCmd = `wasm1 -t ${shellEscape(agentName)}`;
      console.log('🤖 Creating session:', createCmd);
      const createResult = await executeWasmCommand(createCmd);
      const createSummary = parseSummaryLine(createResult.stdout);

      if (!createSummary) {
        ws.send(JSON.stringify({
          type: 'error',
          tabId,
          content: createResult.stderr?.trim() || `Failed to create session (exit ${createResult.code}).`
        }));
        ws.send(JSON.stringify({ type: 'done', tabId, exitCode: createResult.code }));
        return;
      }

      const absFile = resolveSessionPath(createSummary.sessionFile);
      if (!absFile || !existsSync(absFile)) {
        ws.send(JSON.stringify({ type: 'error', tabId, content: `Session file not found after creation: ${createSummary.sessionFile}` }));
        ws.send(JSON.stringify({ type: 'done', tabId, exitCode: createResult.code }));
        return;
      }

      // Track session immediately so abort/continue work
      const initialSessionDoc = upsertSessionCollaborators(absFile, [agentName], agentName);
      tabSessions.set(scopedTabId, {
        sessionId: createSummary.sessionId,
        sessionFile: createSummary.sessionFile,
        sessionStatus: createSummary.status,
        collaborators: initialSessionDoc?.metadata?.collaborators || [normalizeAgentName(agentName)]
      });

      if (!hasPrompt) {
        // No prompt — return created session without running a turn
        const sessionDoc = upsertSessionCollaborators(absFile, [agentName], agentName);
        ws.send(JSON.stringify({
          type: 'session-snapshot',
          tabId,
          sessionId: createSummary.sessionId,
          sessionFile: createSummary.sessionFile,
          sessionStatus: createSummary.status,
          session: sessionDoc,
          exitCode: createResult.code
        }));
        ws.send(JSON.stringify({ type: 'done', tabId, exitCode: createResult.code }));
        return;
      }

      injectUserMessage(absFile, promptText, selection, [agentName], agentName);
      const result = await runWasm1Turn(createSummary.sessionId);
      await finishWithSnapshot(result, [agentName], agentName);
    }
  } catch (error) {
    console.error('Chat command error:', error);
    ws.send(JSON.stringify({ type: 'error', tabId, content: error.message }));
    ws.send(JSON.stringify({ type: 'done', tabId, exitCode: 1 }));
  }
}

// Start server
const port = config.server?.port || 3000;
const host = config.server?.host || 'localhost';

const server = Bun.serve({
  port,
  hostname: host,
  fetch: handleRequest,
  websocket: {
    open(ws) {
      const clientId = `c${nextWsClientId++}`;
      wsClientIds.set(ws, clientId);
      console.log('🔌 Chat WebSocket connected');
      connectedClients.add(ws);
    },
    message(ws, message) {
      try {
        const data = JSON.parse(message);
        handleChatMessage(ws, data);
      } catch (e) {
        console.error('Invalid WebSocket message:', e);
      }
    },
    close(ws) {
      const clientId = wsClientIds.get(ws);
      if (clientId) {
        const prefix = `${clientId}:`;
        for (const key of tabSessions.keys()) {
          if (key.startsWith(prefix)) tabSessions.delete(key);
        }
        for (const key of activeProcesses.keys()) {
          if (key.startsWith(prefix)) activeProcesses.delete(key);
        }
      }
      console.log('🔌 Chat WebSocket disconnected');
      connectedClients.delete(ws);
    }
  }
});

// File watcher for hot-reload
let reloadTimeout = null;
const DEBOUNCE_MS = 300; // Debounce rapid file changes

function broadcastReload() {
  const message = JSON.stringify({ type: 'storage-changed' });
  for (const client of connectedClients) {
    try {
      client.send(message);
    } catch (e) {
      // Client may have disconnected
      connectedClients.delete(client);
    }
  }
}

// Watch storage directory for changes
if (existsSync(storagePath)) {
  watch(storagePath, { recursive: true }, (eventType, filename) => {
    // Watch for .md and .yml files (ontology uses .md with YAML frontmatter)
    if (!filename?.endsWith('.md') && !filename?.endsWith('.yml')) return;
    
    console.log(`📁 Storage change detected: ${eventType} ${filename}`);
    
    // Debounce to avoid multiple reloads for rapid changes
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
      console.log('🔄 Triggering hot-reload...');
      api.store.load(); // Reload data on server
      broadcastReload(); // Notify all clients
    }, DEBOUNCE_MS);
  });
  console.log('👁️  Watching storage directory for changes (recursive)');
}

console.log(`🚀 Server running at http://${host}:${port}`);
console.log('📊 Data Editor ready!');
console.log('💬 Chat WebSocket available at ws://' + host + ':' + port + '/ws/chat');
