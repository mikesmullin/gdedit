/**
 * Main App - Alpine.js Entry Point
 * Core application state and initialization
 * 
 * Components loaded via script tags:
 * - utils.js        - GDEdit global utilities
 * - toolbar.js      - Search and actions
 * - dataTable.js    - Data grid and cell widget base
 * - widgets.js      - Type-specific cell editors
 * - pagination.js   - Page navigation
 * - modals.js       - Add/Bulk add dialogs
 * - clipboard.js    - Copy/paste operations
 * - fileDialog.js   - Open/save file dialogs
 * - validation.js   - Data validation
 * - navigation.js   - Tier tabs, view editor, column management
 */

// Global store initialization
document.addEventListener('alpine:init', () => {
  Alpine.store('editor', {
    instances: [],
    classes: [],
    columns: [],
    schema: {},
    configSnapshot: null,
    configRevision: null,
    configLoaded: false,
    dataLoaded: false,
    selectedClass: null,
    selectedClasses: [],
    selectedRows: [],
    selectedEntityId: null,
    searchQuery: '',
    currentPage: 1,
    pageSize: 20,
    currentView: null,
    selectedViews: [],
    pinnedViews: [],
    views: [],
    showAddModal: false,
    showBulkAddModal: false,
    columnWidths: {},
    // Phase 3 additions
    selectedComponent: null,
    selectedComponents: [],
    pinnedComponents: [],
    pinnedClasses: [],
    sortColumn: null,
    sortDirection: 'asc',
    // Phase 5 additions
    viewMode: 'table' // 'table' | 'graph' | 'schema'
  });
});

let lucideRenderPending = false;
const LEGACY_VIEW_ICON_MAP = {
  '📊': 'layout-grid',
  '🎮': 'gamepad-2',
  '👥': 'users',
  '🖥️': 'monitor',
  '⚙️': 'settings',
  '📦': 'package',
  '🎨': 'palette',
  '🔧': 'wrench',
  '📁': 'folder',
  '🌟': 'star',
  '💼': 'briefcase',
  '🎯': 'target'
};

const VALID_VIEW_MODES = new Set(['table', 'graph', 'schema']);

function getViewModeFromHash(hash = window.location.hash) {
  const value = String(hash || '').trim().toLowerCase();
  const match = value.match(/^#\/(table|graph|schema)$/);
  return match ? match[1] : null;
}

function setHashFromViewMode(mode, { replace = true } = {}) {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (!VALID_VIEW_MODES.has(normalizedMode)) return;

  const nextHash = `#/${normalizedMode}`;
  if (window.location.hash === nextHash) return;

  if (replace) {
    window.history.replaceState(null, '', nextHash);
  } else {
    window.location.hash = nextHash;
  }
}

function renderLucideIcons() {
  if (!window.lucide?.createIcons) return;
  window.lucide.createIcons();
}

function scheduleLucideRender() {
  if (lucideRenderPending) return;
  lucideRenderPending = true;

  requestAnimationFrame(() => {
    lucideRenderPending = false;
    renderLucideIcons();
  });
}

function hasLucideNode(node) {
  if (!(node instanceof Element)) return false;
  if (node.matches('[data-lucide]:not(svg)')) return true;
  return Boolean(node.querySelector('[data-lucide]:not(svg)'));
}

function normalizeViewIcons(views) {
  return (views || []).map((view) => ({
    ...view,
    icon: LEGACY_VIEW_ICON_MAP[view.icon] || view.icon || 'layout-grid'
  }));
}

document.addEventListener('DOMContentLoaded', () => {
  scheduleLucideRender();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'data-lucide' &&
        mutation.target instanceof Element &&
        mutation.target.matches('[data-lucide]:not(svg)')
      ) {
        scheduleLucideRender();
        return;
      }

      for (const node of mutation.addedNodes) {
        if (hasLucideNode(node)) {
          scheduleLucideRender();
          return;
        }
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-lucide']
  });
});

// Toast notifications
window.addEventListener('gdedit:toast', (e) => {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = e.detail;
    toast.classList.remove('opacity-0');
    toast.classList.add('opacity-100');
    setTimeout(() => {
      toast.classList.remove('opacity-100');
      toast.classList.add('opacity-0');
    }, 3000);
  }
});

// Reload handler
window.addEventListener('gdedit:reload', async () => {
  const appEl = document.querySelector('[x-data="app()"]');
  if (appEl && appEl._x_dataStack) {
    await appEl._x_dataStack[0].loadConfig();
    await appEl._x_dataStack[0].loadData();
  }
});

/**
 * Main app component
 */
function app() {
  return {
    loading: true,
    connected: false,
    lastSaved: null,
    views: [],
    currentView: null,
    selectedClass: null,
    onHashChangeBound: null,

    async init() {
      const store = Alpine.store('editor');
      const modeFromHash = getViewModeFromHash();
      if (modeFromHash) {
        store.viewMode = modeFromHash;
      } else {
        setHashFromViewMode(store.viewMode, { replace: true });
      }

      this.onHashChangeBound = () => this.onHashChange();
      window.addEventListener('hashchange', this.onHashChangeBound);
      this.$watch('$store.editor.viewMode', (mode) => {
        setHashFromViewMode(mode, { replace: true });
      });

      await this.loadConfig();
      await this.loadData();
      this.loading = false;
      this.connected = true;
    },

    onHashChange() {
      const modeFromHash = getViewModeFromHash();
      if (!modeFromHash) return;

      const store = Alpine.store('editor');
      if (store.viewMode !== modeFromHash) {
        store.viewMode = modeFromHash;
      }
    },

    async loadConfig() {
      const store = Alpine.store('editor');
      store.configLoaded = false;
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        const filterState = config.ui?.filterState || {};
        const viewSelected = Array.isArray(filterState.views?.selected) ? filterState.views.selected : [];
        const viewPinned = Array.isArray(filterState.views?.pinned) ? filterState.views.pinned : [];
        const classSelected = Array.isArray(filterState.classes?.selected) ? filterState.classes.selected : [];
        const classPinned = Array.isArray(filterState.classes?.pinned) ? filterState.classes.pinned : [];
        const componentSelected = Array.isArray(filterState.components?.selected) ? filterState.components.selected : [];
        const componentPinned = Array.isArray(filterState.components?.pinned) ? filterState.components.pinned : [];

        this.views = normalizeViewIcons(config.views || []);
        this.currentView = null;
        store.views = this.views;
        store.currentView = this.currentView;
        store.selectedViews = viewSelected;
        store.pinnedViews = viewPinned;
        store.selectedClasses = classSelected;
        store.pinnedClasses = classPinned;
        store.selectedComponents = componentSelected;
        store.pinnedComponents = componentPinned;
        store.pageSize = config.ui?.pageSize || 20;
        store.configSnapshot = config;
        store.configRevision = Number.isInteger(Number(config?.revision)) ? Number(config.revision) : 0;
        store.configLoaded = true;
        scheduleLucideRender();
      } catch (e) {
        console.error('Failed to load config:', e);
        this.views = [];
        this.currentView = null;
        store.views = this.views;
        store.currentView = this.currentView;
        store.selectedViews = [];
        store.pinnedViews = [];
        store.selectedClasses = [];
        store.pinnedClasses = [];
        store.selectedComponents = [];
        store.pinnedComponents = [];
        store.configSnapshot = null;
        store.configRevision = null;
        store.configLoaded = true;
      }
    },

    async loadData() {
      try {
        Alpine.store('editor').dataLoaded = false;
        const [classesRes, instancesRes, schemaRes] = await Promise.all([
          fetch('/api/classes'),
          fetch('/api/instances'),
          fetch('/api/schema')
        ]);
        
        const classes = await classesRes.json();
        const instances = await instancesRes.json();
        const schema = await schemaRes.json();
        
        const store = Alpine.store('editor');
        // Force reactivity by clearing first, then setting new values
        store.instances = [];
        store.classes = classes;
        store.schema = schema;
        // Use nextTick equivalent to ensure Alpine processes the empty state first
        setTimeout(() => {
          store.instances = instances;
          store.dataLoaded = true;
        }, 0);
        
        if (this.selectedClass) {
          await this.loadColumns(this.selectedClass);
        }
      } catch (e) {
        console.error('Failed to load data:', e);
        Alpine.store('editor').dataLoaded = true;
      }
    },

    async loadColumns(className) {
      if (!className) {
        Alpine.store('editor').columns = [];
        return;
      }
      try {
        const res = await fetch(`/api/classes/${className}/columns`);
        const columns = await res.json();
        Alpine.store('editor').columns = columns.map(c => ({ ...c, visible: true }));
      } catch (e) {
        console.error('Failed to load columns:', e);
      }
    },

    async reload() {
      this.loading = true;
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Reloading data...' }));
      await fetch('/api/reload', { method: 'POST' });
      await this.loadConfig();
      await this.loadData();
      // Force column reload to ensure table re-renders with fresh data
      if (this.selectedClass) {
        await this.loadColumns(this.selectedClass);
      }
      this.loading = false;
      this.lastSaved = new Date().toLocaleTimeString();
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Data reloaded' }));
    },

    setView(view) {
      this.currentView = view;
      Alpine.store('editor').currentView = view;
      Alpine.store('editor').selectedViews = view ? [view.name] : [];
    },

    selectClass(cls) {
      this.selectedClass = cls;
      Alpine.store('editor').selectedClass = cls;
      Alpine.store('editor').selectedClasses = cls ? [cls] : [];
      Alpine.store('editor').selectedRows = [];
      Alpine.store('editor').selectedEntityId = null;
      Alpine.store('editor').currentPage = 1;
      this.loadColumns(cls);
    },

    get filteredClasses() {
      const store = Alpine.store('editor');
      if (!this.currentView?.classes?.length) {
        return store.classes;
      }
      return store.classes.filter(c => this.currentView.classes.includes(c));
    }
  };
}
