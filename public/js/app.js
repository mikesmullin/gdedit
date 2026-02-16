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
    selectedClass: null,
    selectedRows: [],
    selectedEntityId: null,
    searchQuery: '',
    currentPage: 1,
    pageSize: 20,
    currentView: null,
    views: [],
    showAddModal: false,
    showBulkAddModal: false,
    columnWidths: {},
    // Phase 3 additions
    selectedComponent: null,
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
      for (const node of mutation.addedNodes) {
        if (hasLucideNode(node)) {
          scheduleLucideRender();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
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

    async init() {
      await this.loadConfig();
      await this.loadData();
      this.loading = false;
      this.connected = true;
    },

    async loadConfig() {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        this.views = normalizeViewIcons(config.views || [{ name: 'All', icon: 'layout-grid', classes: [] }]);
        this.currentView = this.views[0];
        Alpine.store('editor').views = this.views;
        Alpine.store('editor').pageSize = config.ui?.pageSize || 20;
        scheduleLucideRender();
      } catch (e) {
        console.error('Failed to load config:', e);
        this.views = normalizeViewIcons([{ name: 'All', icon: 'layout-grid', classes: [] }]);
        this.currentView = this.views[0];
      }
    },

    async loadData() {
      try {
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
        }, 0);
        
        if (this.selectedClass) {
          await this.loadColumns(this.selectedClass);
        }
      } catch (e) {
        console.error('Failed to load data:', e);
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
    },

    selectClass(cls) {
      this.selectedClass = cls;
      Alpine.store('editor').selectedClass = cls;
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
