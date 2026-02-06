/**
 * API Routes Handler
 * HTTP API for ontology data operations
 */
import { createStore } from './store.js';
import { 
  saveInstance, 
  deleteInstance, 
  updateInstanceProperty,
  createNewInstance 
} from './operations.js';

/**
 * Create API handler
 * @param {string} storagePath - Path to storage directory
 * @returns {object} API handler
 */
export function createAPI(storagePath) {
  const store = createStore(storagePath);
  store.load();

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
        // Schema endpoints
        if (path === '/api/schema') {
          return jsonResponse(store.getSchema());
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

        return notFound();
      } catch (error) {
        return errorResponse(error.message);
      }
    },

    store
  };
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
    const { className, id } = body;
    
    // Check for duplicate ID
    const existing = store.getInstance(id);
    if (existing) {
      return errorResponse(`Instance with ID "${id}" already exists`, 409);
    }
    
    const columns = store.getColumns(className);
    const instance = createNewInstance(className, id, columns);
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

function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
