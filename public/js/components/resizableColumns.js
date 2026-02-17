/**
 * Resizable Columns Component
 * Column width management and resizing
 */

const MIN_COLUMN_WIDTH = 60;
const DEFAULT_COLUMN_WIDTH = 150;

/**
 * Get stored column widths from config
 */
function getStoredWidths() {
  const store = Alpine.store('editor');
  return store.configSnapshot?.ui?.columnWidths || {};
}

/**
 * Save column widths to config
 */
function saveWidths(widths) {
  // Queue persistence
  if (window.resizableColumnsPersistTimer) {
    clearTimeout(window.resizableColumnsPersistTimer);
  }
  window.resizableColumnsPersistTimer = setTimeout(() => {
    window.resizableColumnsPersistTimer = null;
    void persistColumnWidths(widths);
  }, 200);
}

async function persistColumnWidths(widths, maxRetries = 3) {
  let attempts = 0;
  while (attempts <= maxRetries) {
    attempts += 1;

    const store = Alpine.store('editor');
    if (!store.configLoaded || !Number.isInteger(store.configRevision)) {
      const cfgRes = await fetch('/api/config');
      const cfg = await cfgRes.json();
      store.configSnapshot = cfg;
      store.configRevision = Number.isInteger(Number(cfg?.revision)) ? Number(cfg.revision) : 0;
      store.configLoaded = true;
    }

    const payload = {
      revision: store.configRevision,
      ui: {
        columnWidths: widths
      }
    };

    const res = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const cfg = await res.json();
      store.configSnapshot = cfg;
      store.configRevision = Number.isInteger(Number(cfg?.revision)) ? Number(cfg.revision) : store.configRevision;
      store.configLoaded = true;
      return;
    }

    const details = await res.json().catch(() => ({}));
    const isRevisionMismatch = res.status === 409 && details?.code === 'REVISION_MISMATCH';
    if (!isRevisionMismatch) {
      console.error('Failed to persist column widths:', details?.error || 'Unknown error');
      return;
    }

    // Revision mismatch, refresh and retry
    if (attempts <= maxRetries) {
      store.configLoaded = false;
      await new Promise(resolve => setTimeout(resolve, 100 * attempts));
    }
  }
}

/**
 * Calculate auto-fit width based on content
 */
function calculateAutoWidth(columnId, instances) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = '14px system-ui, sans-serif';

  let maxWidth = ctx.measureText(columnId).width + 32; // header padding

  for (const inst of instances.slice(0, 100)) { // Sample first 100
    let value = '';
    if (columnId === '_id') {
      value = inst._id;
    } else if (columnId === '_class') {
      value = inst._class;
    } else {
      const [localName, prop] = columnId.split('.');
      value = String(inst.components?.[localName]?.[prop] ?? '');
    }
    
    const width = ctx.measureText(value).width + 24; // cell padding
    maxWidth = Math.max(maxWidth, width);
  }

  return Math.min(Math.max(maxWidth, MIN_COLUMN_WIDTH), 400);
}

/**
 * Resizable columns component for Alpine.js
 */
function resizableColumns() {
  return {
    columnWidths: {},
    resizing: null,
    startX: 0,
    startWidth: 0,

    init() {
      // Load initial widths when config is loaded
      this.loadWidths();
      
      // Listen for mouse events
      document.addEventListener('mousemove', this.handleMouseMove.bind(this));
      document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    },

    loadWidths() {
      const store = Alpine.store('editor');
      if (store.configLoaded) {
        this.columnWidths = getStoredWidths();
      } else {
        // Watch for config load
        const unwatch = this.$watch('$store.editor.configLoaded', (loaded) => {
          if (loaded) {
            this.columnWidths = getStoredWidths();
            unwatch();
          }
        });
      }
    },

    getColumnWidth(columnId) {
      return this.columnWidths[columnId] || DEFAULT_COLUMN_WIDTH;
    },

    getColumnStyle(columnId) {
      const width = this.getColumnWidth(columnId);
      return `width: ${width}px; min-width: ${width}px; max-width: ${width}px;`;
    },

    startResize(event, columnId) {
      event.preventDefault();
      this.resizing = columnId;
      this.startX = event.clientX;
      this.startWidth = this.getColumnWidth(columnId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },

    handleMouseMove(event) {
      if (!this.resizing) return;
      
      const delta = event.clientX - this.startX;
      const newWidth = Math.max(MIN_COLUMN_WIDTH, this.startWidth + delta);
      this.columnWidths[this.resizing] = newWidth;
    },

    handleMouseUp() {
      if (!this.resizing) return;
      
      saveWidths(this.columnWidths);
      this.resizing = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },

    autoFitColumn(columnId) {
      const store = Alpine.store('editor');
      const width = calculateAutoWidth(columnId, store.instances);
      this.columnWidths[columnId] = width;
      saveWidths(this.columnWidths);
    },

    autoFitAllColumns() {
      const store = Alpine.store('editor');
      
      // Fixed columns
      this.columnWidths['_id'] = calculateAutoWidth('_id', store.instances);
      this.columnWidths['_class'] = calculateAutoWidth('_class', store.instances);
      
      // Dynamic columns
      for (const col of store.columns) {
        this.columnWidths[col.id] = calculateAutoWidth(col.id, store.instances);
      }
      
      saveWidths(this.columnWidths);
    },

    resetColumnWidths() {
      this.columnWidths = {};
      saveWidths({});
    }
  };
}

/**
 * Column resize handle template helper
 */
function resizeHandleClass() {
  return 'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors';
}
