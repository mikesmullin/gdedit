/**
 * API Routes Handler
 * HTTP API for ontology data operations
 */
import { resolve, dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createStore } from './store.js';
import { 
  saveInstance, 
  deleteInstance, 
  updateInstanceProperty,
  createNewInstance 
} from './operations.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeInstanceComponents(baseComponents, providedComponents) {
  const merged = isPlainObject(baseComponents)
    ? JSON.parse(JSON.stringify(baseComponents))
    : {};

  if (!isPlainObject(providedComponents)) return merged;

  for (const [localName, props] of Object.entries(providedComponents)) {
    if (!isPlainObject(props)) continue;
    if (!isPlainObject(merged[localName])) merged[localName] = {};

    for (const [propName, propValue] of Object.entries(props)) {
      merged[localName][propName] = propValue;
    }
  }

  return merged;
}

/**
 * Create API handler
 * @param {string} storagePath - Path to storage directory
 * @returns {object} API handler
 */
export function createAPI(storagePath) {
  const store = createStore(storagePath);
  store.load();
  
  // Config path for saving views
  const configPath = resolve(dirname(new URL(import.meta.url).pathname), '../../config.yaml');

  return {
    /**
     * Handle API request
     * @param {Request} req - Request object
     * @returns {Response} Response object
     */
    async handle(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      try {
        // Config CRUD endpoints
        if (path === '/api/config') {
          return handleConfig(req, method, configPath);
        }

        // Schema endpoints
        if (path === '/api/schema' && method === 'GET') {
          return jsonResponse(store.getSchema());
        }
        if (path === '/api/schema' && method === 'PATCH') {
          return handleSchemaPatch(req, store, storagePath);
        }

        // Classes endpoints
        if (path === '/api/classes') {
          return jsonResponse(store.getClasses());
        }

        // Columns for a class
        if (path.startsWith('/api/classes/') && path.endsWith('/columns')) {
          const className = path.split('/')[3];
          return jsonResponse(store.getColumns(className));
        }

        // Relations for a class
        if (path.startsWith('/api/classes/') && path.endsWith('/relations')) {
          const className = path.split('/')[3];
          return jsonResponse(store.getRelations(className));
        }

        // Instances endpoints
        if (path === '/api/instances' || path.startsWith('/api/instances/')) {
          return handleInstances(req, path, method, store, storagePath);
        }

        // Reload data
        if (path === '/api/reload' && method === 'POST') {
          store.load();
          return jsonResponse({ success: true, message: 'Data reloaded' });
        }

        // Views endpoint - save views to config
        if (path === '/api/views' && method === 'POST') {
          return handleSaveViews(req, configPath);
        }

        return notFound();
      } catch (error) {
        return errorResponse(error.message);
      }
    },

    store
  };
}

const DEFAULT_CONFIG = {
  revision: 0,
  storage: { path: '/workspace/ontology/storage' },
  server: { port: 3000, host: 'localhost' },
  ui: {
    pageSize: 20,
    defaultView: '',
    autoSave: true,
    autoSaveInterval: 30000,
    graphState: {
      fitEnabled: false,
      forceEnabled: false
    },
    filterState: {
      views: { selected: [], pinned: [] },
      classes: { selected: [], pinned: [] },
      components: { selected: [], pinned: [] }
    }
  },
  views: [],
  chat: {
    enabled: true,
    defaultAgent: 'ontologist',
    command: 'cat $BUFFER | subd -i -v -j -t $AGENT go',
    agents: {},
    models: [],
    modes: []
  }
};

async function handleConfig(req, method, configPath) {
  if (method === 'GET') {
    return jsonResponse(readConfig(configPath));
  }

  if (method === 'POST') {
    if (existsSync(configPath)) {
      return errorResponse('Config already exists; use PUT or PATCH', 409);
    }
    const body = await req.json();
    const nextConfig = normalizeConfig(body);
    writeConfig(configPath, nextConfig);
    return jsonResponse(nextConfig, 201);
  }

  if (method === 'PUT') {
    const current = readConfig(configPath);
    const body = await req.json();
    const bodyRevision = Number(body?.revision);
    if (!Number.isInteger(bodyRevision)) {
      return errorResponse('Missing or invalid revision', 400, {
        code: 'REVISION_REQUIRED',
        expectedRevision: current.revision
      });
    }
    if (bodyRevision !== current.revision) {
      return errorResponse('Revision mismatch', 409, {
        code: 'REVISION_MISMATCH',
        expectedRevision: current.revision
      });
    }

    const nextConfig = normalizeConfig(body);
    nextConfig.revision = current.revision + 1;
    writeConfig(configPath, nextConfig);
    return jsonResponse(nextConfig);
  }

  if (method === 'PATCH') {
    const current = readConfig(configPath);
    const body = await req.json();
    const bodyRevision = Number(body?.revision);
    if (!Number.isInteger(bodyRevision)) {
      return errorResponse('Missing or invalid revision', 400, {
        code: 'REVISION_REQUIRED',
        expectedRevision: current.revision
      });
    }
    if (bodyRevision !== current.revision) {
      return errorResponse('Revision mismatch', 409, {
        code: 'REVISION_MISMATCH',
        expectedRevision: current.revision
      });
    }

    const merged = mergeDeep(current, body || {});
    const nextConfig = normalizeConfig(merged);
    nextConfig.revision = current.revision + 1;
    writeConfig(configPath, nextConfig);
    return jsonResponse(nextConfig);
  }

  if (method === 'DELETE') {
    const reset = normalizeConfig(DEFAULT_CONFIG);
    reset.revision = 0;
    writeConfig(configPath, reset);
    return jsonResponse(reset);
  }

  return errorResponse('Method not allowed', 405);
}

function readConfig(configPath) {
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  const config = parseYaml(readFileSync(configPath, 'utf8')) || {};
  return normalizeConfig(config);
}

function writeConfig(configPath, config) {
  writeFileSync(configPath, stringifyYaml(config));
}

function normalizeConfig(config) {
  const merged = mergeDeep(DEFAULT_CONFIG, config || {});
  const safeViews = Array.isArray(merged.views) ? merged.views : DEFAULT_CONFIG.views;
  const safeChat = isObject(merged.chat) ? merged.chat : DEFAULT_CONFIG.chat;
  const safeUi = isObject(merged.ui) ? merged.ui : DEFAULT_CONFIG.ui;
  const safeGraphState = isObject(safeUi.graphState) ? safeUi.graphState : DEFAULT_CONFIG.ui.graphState;
  const safeFilterState = isObject(safeUi.filterState) ? safeUi.filterState : DEFAULT_CONFIG.ui.filterState;

  return {
    revision: Math.max(0, Number.isInteger(Number(merged.revision)) ? Number(merged.revision) : 0),
    storage: {
      path: String(merged.storage?.path || DEFAULT_CONFIG.storage.path)
    },
    server: {
      host: String(merged.server?.host || DEFAULT_CONFIG.server.host),
      port: Number(merged.server?.port) || DEFAULT_CONFIG.server.port
    },
    ui: {
      pageSize: Number(safeUi.pageSize) || DEFAULT_CONFIG.ui.pageSize,
      defaultView: String(safeUi.defaultView || DEFAULT_CONFIG.ui.defaultView),
      autoSave: Boolean(safeUi.autoSave),
      autoSaveInterval: Number(safeUi.autoSaveInterval) || DEFAULT_CONFIG.ui.autoSaveInterval,
      graphState: {
        fitEnabled: safeGraphState.fitEnabled === true,
        forceEnabled: safeGraphState.forceEnabled === true
      },
      filterState: {
        views: {
          selected: normalizeStringArray(safeFilterState.views?.selected),
          pinned: normalizeStringArray(safeFilterState.views?.pinned)
        },
        classes: {
          selected: normalizeStringArray(safeFilterState.classes?.selected),
          pinned: normalizeStringArray(safeFilterState.classes?.pinned)
        },
        components: {
          selected: normalizeStringArray(safeFilterState.components?.selected),
          pinned: normalizeStringArray(safeFilterState.components?.pinned)
        }
      }
    },
    views: safeViews,
    chat: {
      enabled: safeChat.enabled !== false,
      defaultAgent: String(safeChat.defaultAgent || DEFAULT_CONFIG.chat.defaultAgent),
      command: String(safeChat.command || DEFAULT_CONFIG.chat.command),
      agents: isObject(safeChat.agents) ? safeChat.agents : {},
      models: Array.isArray(safeChat.models) ? safeChat.models : [],
      modes: Array.isArray(safeChat.modes) ? safeChat.modes : []
    }
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function handleSchemaPatch(req, store, storagePath) {
  const body = await req.json().catch(() => ({}));
  const changes = Array.isArray(body?.changes) ? body.changes : [];

  if (!changes.length) {
    return errorResponse('Schema changes are required', 400);
  }

  try {
    const currentSchema = store.getSchema() || {};
    const nextSchema = applySchemaChanges(currentSchema, changes);
    writeGeneratedSchema(storagePath, nextSchema);
    store.load();
    return jsonResponse(store.getSchema());
  } catch (error) {
    return errorResponse(error.message || 'Failed to apply schema changes', 400);
  }
}

function applySchemaChanges(schema, changes) {
  const next = JSON.parse(JSON.stringify(schema || {}));
  next.classes = next.classes || {};
  next.components = next.components || {};
  next.relations = next.relations || {};

  for (const change of changes) {
    if (!change || typeof change !== 'object') continue;

    if (change.type === 'addClass') {
      const className = String(change.className || '').trim();
      const classComponents = Array.isArray(change.components) ? change.components : [];
      if (!className) throw new Error('Class name is required');
      if (next.classes[className]) throw new Error(`Class already exists: ${className}`);

      if (!classComponents.length) {
        throw new Error('Class must include at least one component');
      }

      const mappedComponents = {};
      for (const entry of classComponents) {
        const componentClass = typeof entry === 'string'
          ? String(entry).trim()
          : String(entry?.componentClass || '').trim();
        const localName = typeof entry === 'string'
          ? toLocalComponentName(componentClass)
          : String(entry?.localName || toLocalComponentName(componentClass)).trim();

        if (!componentClass) throw new Error('Component class is required for class composition');
        if (!next.components[componentClass]) {
          throw new Error(`Component not found: ${componentClass}`);
        }
        if (!localName) throw new Error(`Local name is required for component: ${componentClass}`);
        mappedComponents[localName] = componentClass;
      }

      next.classes[className] = { components: mappedComponents };
      continue;
    }

    if (change.type === 'addComponent') {
      const componentName = String(change.componentName || '').trim();
      const properties = Array.isArray(change.properties) ? change.properties : [];
      const targetClass = String(change.targetClass || '').trim();
      const localName = String(change.localName || componentName).trim();

      if (!componentName) throw new Error('Component name is required');
      if (next.components[componentName]) throw new Error(`Component already exists: ${componentName}`);
      if (!properties.length) throw new Error('Component must include at least one property');

      const propertyMap = {};
      for (const prop of properties) {
        const propertyName = String(prop?.name || '').trim();
        const propertyType = String(prop?.type || 'string').trim() || 'string';
        const required = Boolean(prop?.required);

        if (!propertyName) throw new Error('Property name is required');
        if (propertyMap[propertyName]) throw new Error(`Duplicate property: ${propertyName}`);

        propertyMap[propertyName] = {
          type: propertyType,
          required
        };
      }

      next.components[componentName] = { properties: propertyMap };

      // Optional backward-compatible convenience: map new component directly into a class
      if (targetClass) {
        if (!localName) throw new Error('Local component name is required when targetClass is provided');
        if (!next.classes[targetClass]) throw new Error(`Target class not found: ${targetClass}`);

        const cls = next.classes[targetClass];
        cls.components = cls.components || {};
        cls.components[localName] = componentName;
      }
      continue;
    }
  }

  return next;
}

function toLocalComponentName(componentClass) {
  if (!componentClass) return '';
  return componentClass.charAt(0).toLowerCase() + componentClass.slice(1).replace(/Component$/, '');
}

function writeGeneratedSchema(storagePath, schema) {
  const generatedPath = join(storagePath, '_gdedit_schema.generated.yaml');
  const doc = {
    apiVersion: 'agent/v1',
    kind: 'Ontology',
    metadata: { namespace: 'gdedit/generated' },
    schema,
    spec: { classes: [] }
  };
  writeFileSync(generatedPath, stringifyYaml(doc));
}

function mergeDeep(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source || {})) {
    if (isObject(source[key]) && isObject(target[key])) {
      result[key] = mergeDeep(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Handle instance CRUD operations
 */
async function handleInstances(req, path, method, store, storagePath) {
  const parts = path.split('/').filter(Boolean);
  
  // GET /api/instances - list all
  if (parts.length === 2 && method === 'GET') {
    const url = new URL(req.url);
    const className = url.searchParams.get('class');
    return jsonResponse(store.getInstances(className));
  }

  // GET /api/instances/:id - get one
  if (parts.length === 3 && method === 'GET') {
    const instance = store.getInstance(parts[2]);
    if (!instance) return notFound();
    return jsonResponse(instance);
  }

  // POST /api/instances - create new
  if (parts.length === 2 && method === 'POST') {
    const body = await req.json();
    const { className, id, components } = body;
    
    // Check for duplicate ID
    const existing = store.getInstance(id);
    if (existing) {
      return errorResponse(`Instance with ID "${id}" already exists`, 409);
    }
    
    const columns = store.getColumns(className);
    const instance = createNewInstance(className, id, columns);
    instance.components = mergeInstanceComponents(instance.components, components);
    saveInstance(storagePath, instance);
    store.load();
    return jsonResponse(instance, 201);
  }

  // PUT /api/instances/:id - update
  if (parts.length === 3 && method === 'PUT') {
    const instance = store.getInstance(parts[2]);
    if (!instance) return notFound();
    
    const body = await req.json();
    const updated = { ...instance, ...body };
    saveInstance(storagePath, updated);
    store.load();
    return jsonResponse(updated);
  }

  // PATCH /api/instances/:id - partial update
  if (parts.length === 3 && method === 'PATCH') {
    const instance = store.getInstance(parts[2]);
    if (!instance) return notFound();
    
    const body = await req.json();
    const { columnId, value } = body;
    const updated = updateInstanceProperty({ ...instance }, columnId, value);
    saveInstance(storagePath, updated);
    store.load();
    return jsonResponse(updated);
  }

  // DELETE /api/instances/:id
  if (parts.length === 3 && method === 'DELETE') {
    const instance = store.getInstance(parts[2]);
    if (!instance) return notFound();
    
    deleteInstance(storagePath, instance);
    store.load();
    return jsonResponse({ success: true });
  }

  return notFound();
}

/**
 * Handle saving views to config file
 */
async function handleSaveViews(req, configPath) {
  try {
    const body = await req.json();
    const { views } = body;
    
    if (!Array.isArray(views)) {
      return errorResponse('Views must be an array', 400);
    }

    const current = readConfig(configPath);
    const bodyRevision = Number(body?.revision);
    if (!Number.isInteger(bodyRevision)) {
      return errorResponse('Missing or invalid revision', 400, {
        code: 'REVISION_REQUIRED',
        expectedRevision: current.revision
      });
    }
    if (bodyRevision !== current.revision) {
      return errorResponse('Revision mismatch', 409, {
        code: 'REVISION_MISMATCH',
        expectedRevision: current.revision
      });
    }

    const nextConfig = normalizeConfig({ ...current, views, revision: current.revision + 1 });
    writeConfig(configPath, nextConfig);

    return jsonResponse(nextConfig);
  } catch (error) {
    return errorResponse('Failed to save views: ' + error.message, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function notFound() {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

function errorResponse(message, status = 500, extra = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
