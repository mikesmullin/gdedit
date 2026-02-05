/**
 * Main App Alpine.js Component
 * Root application state and initialization
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
    views: []
  });
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
      await fetch('/api/reload', { method: 'POST' });
      await this.loadData();
      this.loading = false;
      this.lastSaved = new Date().toLocaleTimeString();
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

/**
 * Toolbar component
 */
function toolbar() {
  return {
    showAddModal: false,
    searchTimeout: null,

    get visibleColumnsCount() {
      return Alpine.store('editor').columns.filter(c => c.visible).length;
    },

    get totalColumnsCount() {
      return Alpine.store('editor').columns.length;
    },

    get paginationInfo() {
      const store = Alpine.store('editor');
      const filtered = this.getFilteredInstances();
      return `${filtered.length} of ${store.instances.length} entities`;
    },

    getFilteredInstances() {
      const store = Alpine.store('editor');
      let instances = store.instances;
      
      if (store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      
      if (store.searchQuery) {
        const query = store.searchQuery.toLowerCase();
        instances = instances.filter(i => {
          const idMatch = i._id.toLowerCase().includes(query);
          const classMatch = i._class.toLowerCase().includes(query);
          const componentMatch = JSON.stringify(i.components || {}).toLowerCase().includes(query);
          return idMatch || classMatch || componentMatch;
        });
      }
      
      return instances;
    },

    toggleColumn(colId) {
      const store = Alpine.store('editor');
      const col = store.columns.find(c => c.id === colId);
      if (col) col.visible = !col.visible;
    },

    showAllColumns() {
      Alpine.store('editor').columns.forEach(c => c.visible = true);
    },

    hideAllColumns() {
      Alpine.store('editor').columns.forEach(c => c.visible = false);
    },

    debounceSearch() {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        Alpine.store('editor').currentPage = 1;
      }, 300);
    },

    async deleteSelected() {
      const store = Alpine.store('editor');
      if (store.selectedRows.length === 0) return;
      
      if (!confirm(`Delete ${store.selectedRows.length} selected row(s)?`)) return;
      
      for (const id of store.selectedRows) {
        await fetch(`/api/instances/${id}`, { method: 'DELETE' });
      }
      
      store.selectedRows = [];
      await this.$root.reload();
    }
  };
}

/**
 * Data table component
 */
function dataTable() {
  return {
    get visibleColumns() {
      return Alpine.store('editor').columns.filter(c => c.visible);
    },

    get filteredInstances() {
      const store = Alpine.store('editor');
      let instances = store.instances;
      
      if (store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      
      if (store.searchQuery) {
        const query = store.searchQuery.toLowerCase();
        instances = instances.filter(i => {
          const idMatch = i._id.toLowerCase().includes(query);
          const classMatch = i._class.toLowerCase().includes(query);
          const componentMatch = JSON.stringify(i.components || {}).toLowerCase().includes(query);
          return idMatch || classMatch || componentMatch;
        });
      }
      
      return instances;
    },

    get paginatedInstances() {
      const store = Alpine.store('editor');
      const start = (store.currentPage - 1) * store.pageSize;
      const end = start + store.pageSize;
      return this.filteredInstances.slice(start, end);
    },

    isSelected(id) {
      return Alpine.store('editor').selectedRows.includes(id);
    },

    toggleSelect(id) {
      const store = Alpine.store('editor');
      const idx = store.selectedRows.indexOf(id);
      if (idx >= 0) {
        store.selectedRows.splice(idx, 1);
      } else {
        store.selectedRows.push(id);
      }
    },

    toggleSelectAll(event) {
      const store = Alpine.store('editor');
      if (event.target.checked) {
        store.selectedRows = this.paginatedInstances.map(i => i._id);
      } else {
        store.selectedRows = [];
      }
    }
  };
}

/**
 * Cell widget component
 */
function cellWidget(instance, col) {
  return {
    instance,
    col,

    getValue() {
      const [localName, property] = this.col.id.split('.');
      return this.instance.components?.[localName]?.[property];
    },

    async setValue(value) {
      const res = await fetch(`/api/instances/${this.instance._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: this.col.id, value })
      });
      
      if (res.ok) {
        const [localName, property] = this.col.id.split('.');
        if (!this.instance.components) this.instance.components = {};
        if (!this.instance.components[localName]) this.instance.components[localName] = {};
        this.instance.components[localName][property] = value;
      }
    },

    formatDate(value) {
      if (!value) return '';
      try {
        return new Date(value).toISOString().split('T')[0];
      } catch {
        return value;
      }
    }
  };
}

/**
 * Pagination component
 */
function pagination() {
  return {
    inputPage: 1,

    get currentPage() {
      return Alpine.store('editor').currentPage;
    },

    set currentPage(val) {
      Alpine.store('editor').currentPage = val;
      this.inputPage = val;
    },

    get pageSize() {
      return Alpine.store('editor').pageSize;
    },

    get totalItems() {
      const store = Alpine.store('editor');
      let instances = store.instances;
      if (store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      return instances.length;
    },

    get totalPages() {
      return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
    },

    get startIndex() {
      return (this.currentPage - 1) * this.pageSize;
    },

    get endIndex() {
      return this.startIndex + this.pageSize;
    },

    goToFirst() {
      this.currentPage = 1;
    },

    goToPrev() {
      if (this.currentPage > 1) this.currentPage--;
    },

    goToNext() {
      if (this.currentPage < this.totalPages) this.currentPage++;
    },

    goToLast() {
      this.currentPage = this.totalPages;
    },

    goToPage(page) {
      const p = Math.max(1, Math.min(this.totalPages, parseInt(page) || 1));
      this.currentPage = p;
    }
  };
}

/**
 * Add modal component
 */
function addModal() {
  return {
    get showAddModal() {
      return Alpine.store('editor').showAddModal || false;
    },
    set showAddModal(val) {
      Alpine.store('editor').showAddModal = val;
    },
    newClass: '',
    newId: '',

    async createRow() {
      if (!this.newClass || !this.newId) return;
      
      const res = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ className: this.newClass, id: this.newId })
      });
      
      if (res.ok) {
        this.showAddModal = false;
        this.newClass = '';
        this.newId = '';
        // Trigger reload
        await fetch('/api/reload', { method: 'POST' });
        window.location.reload();
      }
    }
  };
}
