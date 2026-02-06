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
    sortDirection: 'asc'
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
        this.views = config.views || [{ name: 'All', icon: '📊', classes: [] }];
        this.currentView = this.views[0];
        Alpine.store('editor').views = this.views;
        Alpine.store('editor').pageSize = config.ui?.pageSize || 20;
      } catch (e) {
        console.error('Failed to load config:', e);
        this.views = [{ name: 'All', icon: '📊', classes: [] }];
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
        
        Alpine.store('editor').classes = classes;
        Alpine.store('editor').instances = instances;
        Alpine.store('editor').schema = schema;
        
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
      this.loading = false;
      this.lastSaved = new Date().toLocaleTimeString();
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: '✓ Data reloaded' }));
    },

    setView(view) {
      this.currentView = view;
      Alpine.store('editor').currentView = view;
    },

    selectClass(cls) {
      this.selectedClass = cls;
      Alpine.store('editor').selectedClass = cls;
      Alpine.store('editor').selectedRows = [];
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
