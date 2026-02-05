/**
 * Bun Server Entry Point
 * Serves static files and API endpoints
 */
import { resolve, dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
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
async function handleRequest(req) {
  const url = new URL(req.url);
  const path = url.pathname;

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

// Start server
const port = config.server?.port || 3000;
const host = config.server?.host || 'localhost';

const server = Bun.serve({
  port,
  hostname: host,
  fetch: handleRequest
});

console.log(`🚀 Server running at http://${host}:${port}`);
console.log('📊 Game Data Editor ready!');
