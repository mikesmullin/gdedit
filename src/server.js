/**
 * Bun Server Entry Point
 * Serves static files, API endpoints, and WebSocket for chat
 */
import { resolve, dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { createAPI } from './lib/api.js';

// Resolve paths relative to this file
const __dirname = dirname(new URL(import.meta.url).pathname);
const projectRoot = resolve(__dirname, '..');
const publicDir = resolve(projectRoot, 'public');
const configPath = resolve(projectRoot, 'config.yaml');

// Load configuration
const config = loadServerConfig(configPath);
const storagePath = resolveStoragePath(config, projectRoot);

console.log('📂 Storage path:', storagePath);
console.log('📁 Public dir:', publicDir);

// Create API handler
const api = createAPI(storagePath);

// Active chat processes (for abort functionality)
const activeProcesses = new Map();

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
    return { storage: { path: '../ontology/storage' }, server: { port: 3000 } };
  }
  return parseYaml(readFileSync(path, 'utf8'));
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
    // Special config endpoint
    if (path === '/api/config') {
      return new Response(JSON.stringify(config), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
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
  const { type, tabId, content, agent, history } = data;

  if (type === 'abort') {
    const proc = activeProcesses.get(tabId);
    if (proc) {
      proc.kill();
      activeProcesses.delete(tabId);
    }
    return;
  }

  if (type !== 'chat') return;

  // Get chat config
  const chatConfig = config.chat || {};
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
  
  writeFileSync(bufferPath, bufferContent);

  // Substitute variables in command
  const finalCommand = command
    .replace(/\$BUFFER/g, bufferPath)
    .replace(/\$AGENT/g, agentName);

  console.log('🤖 Executing chat command:', finalCommand);

  try {
    // Execute shell command with stderr merged to capture JSONL output
    const proc = Bun.spawn(['sh', '-c', finalCommand], {
      stdout: 'pipe',
      stderr: 'pipe'
    });

    // Store process for potential abort
    activeProcesses.set(tabId, proc);

    // Read stdout and stderr concurrently for JSONL streaming
    const readStream = async (reader, isStderr = false) => {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = new TextDecoder().decode(value);
        buffer += chunk;
        
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
      }
      
      // Process any remaining content
      if (buffer.trim()) {
        ws.send(JSON.stringify({
          type: 'jsonl',
          tabId: tabId,
          content: buffer,
          isStderr: isStderr
        }));
      }
    };

    // Read both streams
    await Promise.all([
      readStream(proc.stdout.getReader(), false),
      readStream(proc.stderr.getReader(), true)
    ]);

    // Wait for process to complete
    await proc.exited;

    // Send done signal
    ws.send(JSON.stringify({
      type: 'done',
      tabId: tabId,
      exitCode: proc.exitCode
    }));

    // Cleanup process reference (keep temp files for debugging)
    activeProcesses.delete(tabId);

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
    }
  }
});

console.log(`🚀 Server running at http://${host}:${port}`);
console.log('📊 Game Data Editor ready!');
console.log('💬 Chat WebSocket available at ws://' + host + ':' + port + '/ws/chat');
