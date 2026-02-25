/**
 * Bun Server Entry Point
 * Serves static files, API endpoints, and WebSocket for chat
 */
import { resolve, dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch, copyFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
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
  const { type, tabId, content, agent, history, selection } = data;

  if (type === 'abort') {
    const entry = activeProcesses.get(tabId);
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

  if (type !== 'chat') return;

  // Get chat config (reload from disk so settings updates apply immediately)
  const runtimeConfig = loadServerConfig(configPath);
  const chatConfig = runtimeConfig.chat || {};
  const command = chatConfig.command || 'echo "No chat command configured"';
  const defaultAgent = chatConfig.defaultAgent || 'default';
  
  // Determine agent to use
  const agentName = agent || defaultAgent;

  // Create temp file with session history + new user input
  // Use local tmp directory that persists
  const tmpDir = resolve(projectRoot, 'tmp', `chat-${tabId}`);
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }
  const bufferPath = join(tmpDir, 'input.txt');
  
  // Build buffer content: previous history + new user prompt
  let bufferContent = '';
  
  // Include previous session history if provided
  if (history && Array.isArray(history) && history.length > 0) {
    bufferContent = history.join('\n') + '\n';
  }
  
  // Add the new user prompt
  bufferContent += content;
  
  // Add selection context
  bufferContent += '\n\n';
  if (selection && Array.isArray(selection) && selection.length > 0) {
    bufferContent += `The user has currently selected ${selection.length} item${selection.length > 1 ? 's' : ''} in the editor:\n`;
    for (const item of selection) {
      bufferContent += `- ${item.id}:${item.class}\n`;
    }
  } else {
    bufferContent += 'The user has not currently selected any items in the editor.\n';
  }
  
  writeFileSync(bufferPath, bufferContent);

  // Ensure sandbox directory exists for command execution
  const sandboxDir = resolve(projectRoot, 'sandbox');
  if (!existsSync(sandboxDir)) {
    mkdirSync(sandboxDir, { recursive: true });
  }

  // Substitute variables in command
  const finalCommand = command
    .replace(/\$BUFFER/g, bufferPath)
    .replace(/\$AGENT/g, agentName);

  console.log('🤖 Executing chat command:', finalCommand);
  console.log('📁 Working directory:', sandboxDir);

  try {
    // Execute shell command from sandbox directory
    // Use detached: true to create a new process group (cross-platform)
    // This allows killing all child processes with process.kill(-pid, signal)
    const proc = spawn('sh', ['-c', finalCommand], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: sandboxDir
    });

    // Store process for potential abort (with kill attempt tracking)
    activeProcesses.set(tabId, { proc, killAttempts: 0 });
    console.log(`📌 Process started for tab ${tabId}, pid: ${proc.pid}`);

    // Read streams using Node.js stream API
    const readStream = (stream, isStderr = false) => {
      let buffer = '';
      
      stream.on('data', (chunk) => {
        buffer += chunk.toString();
        
        // Process complete lines (JSONL format)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.trim()) {
            // Send each JSONL line to client
            ws.send(JSON.stringify({
              type: 'jsonl',
              tabId: tabId,
              content: line,
              isStderr: isStderr
            }));
          }
        }
      });
      
      stream.on('end', () => {
        // Process any remaining content
        if (buffer.trim()) {
          ws.send(JSON.stringify({
            type: 'jsonl',
            tabId: tabId,
            content: buffer,
            isStderr: isStderr
          }));
        }
      });
    };

    // Start reading both streams
    readStream(proc.stdout, false);
    readStream(proc.stderr, true);

    // Wait for process to complete
    await new Promise((resolve) => {
      proc.on('close', (code) => {
        // Send done signal
        ws.send(JSON.stringify({
          type: 'done',
          tabId: tabId,
          exitCode: code
        }));

        // Cleanup process reference
        activeProcesses.delete(tabId);
        resolve();
      });
    });

  } catch (error) {
    console.error('Chat command error:', error);
    ws.send(JSON.stringify({
      type: 'error',
      tabId: tabId,
      content: error.message
    }));
    activeProcesses.delete(tabId);
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
