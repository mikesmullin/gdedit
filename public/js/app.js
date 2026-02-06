/**
 * Main App Alpine.js Component
 * Root application state and initialization
 */

// Import components (loaded via script tags)
// Components: bulkAdd, clipboard, fileDialog, resizableColumns, queryParser, validation

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
    columnWidths: {}
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

/**
 * Toolbar component
 */
function toolbar() {
  return {
    showAddModal: false,
    searchTimeout: null,
    searchHistory: [],
    showSearchHistory: false,

    init() {
      // Load search history from localStorage
      try {
        this.searchHistory = JSON.parse(localStorage.getItem('gdedit-search-history') || '[]');
      } catch { this.searchHistory = []; }
    },

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
        instances = window.GDEdit?.applyFilter?.(instances, store.searchQuery) || this.basicFilter(instances, store.searchQuery);
      }
      
      return instances;
    },

    basicFilter(instances, query) {
      const q = query.toLowerCase();
      return instances.filter(i => {
        const idMatch = i._id.toLowerCase().includes(q);
        const classMatch = i._class.toLowerCase().includes(q);
        const componentMatch = JSON.stringify(i.components || {}).toLowerCase().includes(q);
        return idMatch || classMatch || componentMatch;
      });
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

    submitSearch() {
      const query = Alpine.store('editor').searchQuery;
      if (query && !this.searchHistory.includes(query)) {
        this.searchHistory.unshift(query);
        if (this.searchHistory.length > 20) this.searchHistory.pop();
        localStorage.setItem('gdedit-search-history', JSON.stringify(this.searchHistory));
      }
      this.showSearchHistory = false;
    },

    selectHistoryItem(item) {
      Alpine.store('editor').searchQuery = item;
      this.showSearchHistory = false;
      Alpine.store('editor').currentPage = 1;
    },

    clearSearch() {
      Alpine.store('editor').searchQuery = '';
      Alpine.store('editor').currentPage = 1;
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
    columnWidths: {},
    resizing: null,
    startX: 0,
    startWidth: 0,

    init() {
      // Load column widths
      try {
        this.columnWidths = JSON.parse(localStorage.getItem('gdedit-column-widths') || '{}');
      } catch { this.columnWidths = {}; }

      // Mouse event handlers for resize
      document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      document.addEventListener('mouseup', () => this.handleMouseUp());
    },

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
        instances = window.GDEdit?.applyFilter?.(instances, store.searchQuery) || this.basicFilter(instances, store.searchQuery);
      }
      
      return instances;
    },

    basicFilter(instances, query) {
      const q = query.toLowerCase();
      return instances.filter(i => {
        const idMatch = i._id.toLowerCase().includes(q);
        const classMatch = i._class.toLowerCase().includes(q);
        const componentMatch = JSON.stringify(i.components || {}).toLowerCase().includes(q);
        return idMatch || classMatch || componentMatch;
      });
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
    },

    // Column resize methods
    getColumnWidth(colId) {
      return this.columnWidths[colId] || 150;
    },

    getColumnStyle(colId) {
      const w = this.getColumnWidth(colId);
      return `width: ${w}px; min-width: ${w}px; max-width: ${w}px;`;
    },

    startResize(e, colId) {
      e.preventDefault();
      this.resizing = colId;
      this.startX = e.clientX;
      this.startWidth = this.getColumnWidth(colId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },

    handleMouseMove(e) {
      if (!this.resizing) return;
      const delta = e.clientX - this.startX;
      const newWidth = Math.max(60, this.startWidth + delta);
      this.columnWidths[this.resizing] = newWidth;
    },

    handleMouseUp() {
      if (!this.resizing) return;
      localStorage.setItem('gdedit-column-widths', JSON.stringify(this.columnWidths));
      this.resizing = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },

    autoFitColumn(colId) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.font = '14px system-ui, sans-serif';
      
      let maxWidth = ctx.measureText(colId).width + 40;
      
      for (const inst of this.filteredInstances.slice(0, 100)) {
        let val = '';
        if (colId === '_id') val = inst._id;
        else if (colId === '_class') val = inst._class;
        else {
          const [ln, prop] = colId.split('.');
          val = String(inst.components?.[ln]?.[prop] ?? '');
        }
        maxWidth = Math.max(maxWidth, ctx.measureText(val).width + 24);
      }
      
      this.columnWidths[colId] = Math.min(Math.max(maxWidth, 60), 400);
      localStorage.setItem('gdedit-column-widths', JSON.stringify(this.columnWidths));
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
    validationErrors: [],

    getValue() {
      const [localName, property] = this.col.id.split('.');
      return this.instance.components?.[localName]?.[property];
    },

    async setValue(value) {
      // Validate before saving
      this.validationErrors = window.GDEdit?.validateType?.(value, this.col.type, this.col.required) || [];
      
      if (this.validationErrors.some(e => e.type === 'error')) {
        return; // Don't save invalid data
      }

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
        this.validationErrors = [];
      }
    },

    formatDate(value) {
      if (!value) return '';
      try {
        return new Date(value).toISOString().split('T')[0];
      } catch {
        return value;
      }
    },

    get hasError() {
      return this.validationErrors.some(e => e.type === 'error');
    },

    get validationClass() {
      if (this.hasError) return 'ring-2 ring-red-500';
      if (this.validationErrors.length > 0) return 'ring-2 ring-yellow-500';
      return '';
    },

    get validationTitle() {
      return this.validationErrors.map(e => e.message).join(', ');
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

    init() {
      // Pre-select current class
      this.$watch('showAddModal', (val) => {
        if (val && Alpine.store('editor').selectedClass) {
          this.newClass = Alpine.store('editor').selectedClass;
        }
      });
    },

    async createRow() {
      if (!this.newClass || !this.newId) return;
      
      const res = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ className: this.newClass, id: this.newId })
      });
      
      if (res.ok) {
        this.showAddModal = false;
        this.newId = '';
        await fetch('/api/reload', { method: 'POST' });
        window.dispatchEvent(new CustomEvent('gdedit:reload'));
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Row created' }));
      } else {
        const err = await res.json();
        alert('Failed to create: ' + (err.error || 'Unknown error'));
      }
    }
  };
}

/**
 * Bulk add modal component
 */
function bulkAddModal() {
  return {
    selectedClass: '',
    rowCount: 5,
    customCount: 10,
    useCustomCount: false,
    nameTemplate: '$t-$i',
    startIndex: 1,
    generatedIds: [],
    isCreating: false,
    presetCounts: [1, 5, 10, 25],

    get showBulkAddModal() {
      return Alpine.store('editor').showBulkAddModal || false;
    },
    set showBulkAddModal(val) {
      Alpine.store('editor').showBulkAddModal = val;
    },

    init() {
      this.$watch('selectedClass', () => this.updatePreview());
      this.$watch('rowCount', () => this.updatePreview());
      this.$watch('customCount', () => this.updatePreview());
      this.$watch('useCustomCount', () => this.updatePreview());
      this.$watch('nameTemplate', () => this.updatePreview());
      this.$watch('startIndex', () => this.updatePreview());
      
      // Watch for modal open to initialize
      this.$watch('showBulkAddModal', (val) => {
        if (val) {
          this.selectedClass = Alpine.store('editor').selectedClass || '';
          this.updatePreview();
        }
      });
    },

    open() {
      this.selectedClass = Alpine.store('editor').selectedClass || '';
      this.showBulkAddModal = true;
      this.updatePreview();
    },

    close() {
      this.showBulkAddModal = false;
      this.isCreating = false;
    },

    get actualCount() {
      return this.useCustomCount ? this.customCount : this.rowCount;
    },

    updatePreview() {
      if (!this.selectedClass || !this.nameTemplate) {
        this.generatedIds = [];
        return;
      }
      
      const count = Math.min(this.actualCount, 100);
      this.generatedIds = [];
      for (let i = 0; i < count; i++) {
        const id = this.nameTemplate
          .replace(/\$t/g, this.selectedClass.toLowerCase())
          .replace(/\$i/g, String(this.startIndex + i).padStart(3, '0'));
        this.generatedIds.push(id);
      }
    },

    selectPreset(count) {
      this.useCustomCount = false;
      this.rowCount = count;
    },

    async createRows() {
      if (!this.selectedClass || this.generatedIds.length === 0) return;
      
      this.isCreating = true;
      let created = 0;

      try {
        for (const id of this.generatedIds) {
          const res = await fetch('/api/instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ className: this.selectedClass, id })
          });
          if (res.ok) created++;
        }

        this.close();
        await fetch('/api/reload', { method: 'POST' });
        window.dispatchEvent(new CustomEvent('gdedit:reload'));
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Created ${created} rows` }));
      } catch (e) {
        alert('Failed to create rows: ' + e.message);
      } finally {
        this.isCreating = false;
      }
    }
  };
}

/**
 * Clipboard component
 */
function clipboard() {
  return {
    showPastePad: false,
    pasteContent: '',
    pastePreview: null,

    async copyTable() {
      const store = Alpine.store('editor');
      const table = document.querySelector('[x-data="dataTable()"]');
      const instances = table?._x_dataStack?.[0]?.filteredInstances || store.instances;
      const columns = store.columns.filter(c => c.visible);
      
      const headers = ['_id', '_class', ...columns.map(c => c.id)];
      const rows = [headers.join('\t')];
      
      for (const inst of instances) {
        const cells = [inst._id, inst._class];
        for (const col of columns) {
          const [ln, prop] = col.id.split('.');
          cells.push(String(inst.components?.[ln]?.[prop] ?? ''));
        }
        rows.push(cells.join('\t'));
      }
      
      await navigator.clipboard.writeText(rows.join('\n'));
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Copied ${instances.length} rows` }));
    },

    async copySelectedRows() {
      const store = Alpine.store('editor');
      if (store.selectedRows.length === 0) return;

      const columns = store.columns.filter(c => c.visible);
      const instances = store.instances.filter(i => store.selectedRows.includes(i._id));
      
      const headers = ['_id', '_class', ...columns.map(c => c.id)];
      const rows = [headers.join('\t')];
      
      for (const inst of instances) {
        const cells = [inst._id, inst._class];
        for (const col of columns) {
          const [ln, prop] = col.id.split('.');
          cells.push(String(inst.components?.[ln]?.[prop] ?? ''));
        }
        rows.push(cells.join('\t'));
      }
      
      await navigator.clipboard.writeText(rows.join('\n'));
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Copied ${instances.length} selected rows` }));
    },

    async copyColumn(colId) {
      const store = Alpine.store('editor');
      const table = document.querySelector('[x-data="dataTable()"]');
      const instances = table?._x_dataStack?.[0]?.filteredInstances || store.instances;
      
      const values = instances.map(inst => {
        if (colId === '_id') return inst._id;
        if (colId === '_class') return inst._class;
        const [ln, prop] = colId.split('.');
        return String(inst.components?.[ln]?.[prop] ?? '');
      });
      
      await navigator.clipboard.writeText(values.join('\n'));
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Copied ${values.length} values` }));
    },

    openPastePad() {
      this.pasteContent = '';
      this.pastePreview = null;
      this.showPastePad = true;
    },

    closePastePad() {
      this.showPastePad = false;
    },

    updatePastePreview() {
      if (!this.pasteContent) {
        this.pastePreview = null;
        return;
      }
      
      const lines = this.pasteContent.trim().split('\n');
      const delimiter = lines[0].includes('\t') ? '\t' : ',';
      const rows = lines.map(l => l.split(delimiter));
      
      this.pastePreview = {
        format: delimiter === '\t' ? 'TSV' : 'CSV',
        rowCount: rows.length - 1,
        headers: rows[0],
        preview: rows.slice(1, 4)
      };
    },

    async executePaste() {
      const store = Alpine.store('editor');
      if (!this.pasteContent || !store.selectedClass) {
        alert('Please select a class before pasting');
        return;
      }
      
      const lines = this.pasteContent.trim().split('\n');
      const delimiter = lines[0].includes('\t') ? '\t' : ',';
      const rows = lines.map(l => l.split(delimiter));
      const headers = rows[0];
      const columns = store.columns;
      let created = 0;
      
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const idIdx = headers.findIndex(h => h === '_id' || h === 'id');
        const id = idIdx >= 0 ? row[idIdx] : `${store.selectedClass.toLowerCase()}-paste-${i}`;
        
        const res = await fetch('/api/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ className: store.selectedClass, id })
        });
        
        if (res.ok) {
          for (let j = 0; j < headers.length; j++) {
            if (headers[j] === '_id' || headers[j] === 'id' || headers[j] === '_class') continue;
            const col = columns.find(c => c.id === headers[j]);
            if (col && row[j]) {
              await fetch(`/api/instances/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ columnId: headers[j], value: row[j] })
              });
            }
          }
          created++;
        }
      }
      
      this.closePastePad();
      await fetch('/api/reload', { method: 'POST' });
      window.dispatchEvent(new CustomEvent('gdedit:reload'));
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Created ${created} rows from paste` }));
    }
  };
}

/**
 * File dialog component
 */
function fileDialog() {
  return {
    showOpenDialog: false,
    showSaveDialog: false,
    openFile: null,
    openPreview: null,
    saveFormat: 'csv',
    saveFilename: 'export',
    exportVisibleOnly: true,

    openOpenDialog() {
      this.showOpenDialog = true;
      this.openFile = null;
      this.openPreview = null;
    },

    closeOpenDialog() {
      this.showOpenDialog = false;
    },

    async handleFileSelect(event) {
      const file = event.target.files[0];
      if (!file) return;
      this.openFile = file;
      
      try {
        const content = await file.text();
        const ext = file.name.split('.').pop().toLowerCase();
        
        if (ext === 'json') {
          const data = JSON.parse(content);
          this.openPreview = {
            format: 'JSON',
            rows: Array.isArray(data) ? data.length : 1
          };
        } else {
          const delimiter = ext === 'tsv' ? '\t' : ',';
          const lines = content.trim().split('\n');
          const rows = lines.map(l => l.split(delimiter));
          this.openPreview = {
            format: ext.toUpperCase(),
            rows: rows.length - 1,
            headers: rows[0]
          };
        }
      } catch (e) {
        this.openPreview = { error: e.message };
      }
    },

    async importFile() {
      const store = Alpine.store('editor');
      if (!this.openFile || !store.selectedClass) {
        alert('Please select a class before importing');
        return;
      }

      const content = await this.openFile.text();
      const ext = this.openFile.name.split('.').pop().toLowerCase();
      const columns = store.columns;
      let created = 0;
      
      if (ext === 'json') {
        const data = JSON.parse(content);
        const items = Array.isArray(data) ? data : [data];
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const id = item._id || item.id || `${store.selectedClass.toLowerCase()}-import-${i}`;
          
          const res = await fetch('/api/instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ className: store.selectedClass, id })
          });
          
          if (res.ok && item.components) {
            for (const [ln, props] of Object.entries(item.components)) {
              for (const [prop, value] of Object.entries(props)) {
                await fetch(`/api/instances/${id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ columnId: `${ln}.${prop}`, value })
                });
              }
            }
            created++;
          }
        }
      } else {
        const delimiter = ext === 'tsv' ? '\t' : ',';
        const lines = content.trim().split('\n');
        const rows = lines.map(l => l.split(delimiter));
        const headers = rows[0];
        
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const idIdx = headers.findIndex(h => h === '_id' || h === 'id');
          const id = idIdx >= 0 ? row[idIdx] : `${store.selectedClass.toLowerCase()}-import-${i}`;
          
          const res = await fetch('/api/instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ className: store.selectedClass, id })
          });
          
          if (res.ok) {
            for (let j = 0; j < headers.length; j++) {
              if (headers[j] === '_id' || headers[j] === 'id' || headers[j] === '_class') continue;
              const col = columns.find(c => c.id === headers[j]);
              if (col && row[j]) {
                await fetch(`/api/instances/${id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ columnId: headers[j], value: row[j] })
                });
              }
            }
            created++;
          }
        }
      }
      
      this.closeOpenDialog();
      await fetch('/api/reload', { method: 'POST' });
      window.dispatchEvent(new CustomEvent('gdedit:reload'));
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Imported ${created} rows` }));
    },

    openSaveDialog() {
      const store = Alpine.store('editor');
      this.saveFilename = store.selectedClass || 'export';
      this.showSaveDialog = true;
    },

    closeSaveDialog() {
      this.showSaveDialog = false;
    },

    exportData() {
      const store = Alpine.store('editor');
      let instances = store.instances;
      
      if (this.exportVisibleOnly && store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      
      const columns = store.columns.filter(c => c.visible);
      const filename = `${this.saveFilename}.${this.saveFormat}`;
      let content, mimeType;
      
      if (this.saveFormat === 'json') {
        const clean = instances.map(i => {
          const copy = { ...i };
          delete copy._source;
          return copy;
        });
        content = JSON.stringify(clean, null, 2);
        mimeType = 'application/json';
      } else {
        const headers = ['_id', '_class', ...columns.map(c => c.id)];
        const rows = [headers.join(',')];
        
        for (const inst of instances) {
          const cells = [
            this.escapeCSV(inst._id),
            this.escapeCSV(inst._class),
            ...columns.map(col => {
              const [ln, prop] = col.id.split('.');
              return this.escapeCSV(inst.components?.[ln]?.[prop] ?? '');
            })
          ];
          rows.push(cells.join(','));
        }
        
        content = rows.join('\n');
        mimeType = 'text/csv';
      }
      
      // Download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.closeSaveDialog();
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Exported to ${filename}` }));
    },

    escapeCSV(value) {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }
  };
}

/**
 * Validation manager component
 */
function validationManager() {
  return {
    showValidationPanel: false,
    validationSummary: [],

    validateAll() {
      const store = Alpine.store('editor');
      this.validationSummary = [];

      for (const instance of store.instances) {
        const errors = [];
        
        for (const col of store.columns) {
          const [ln, prop] = col.id.split('.');
          const value = instance.components?.[ln]?.[prop];
          const typeErrors = window.GDEdit?.validateType?.(value, col.type, col.required) || [];
          
          for (const err of typeErrors) {
            errors.push({ field: col.id, ...err });
          }
        }
        
        if (errors.length > 0) {
          this.validationSummary.push({
            instanceId: instance._id,
            instanceClass: instance._class,
            errors
          });
        }
      }

      this.showValidationPanel = this.validationSummary.length > 0;
      
      if (this.validationSummary.length === 0) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'All data is valid!' }));
      }
      
      return this.validationSummary;
    },

    closeValidationPanel() {
      this.showValidationPanel = false;
    }
  };
}

// Global namespace for utility functions
window.GDEdit = {
  applyFilter(instances, query) {
    if (!query) return instances;
    const q = query.toLowerCase();
    
    // Check for DSL patterns
    const classMatch = query.match(/^:([^.:\s]*)(?:\.([^:]+))?:\s*(.*)$/);
    if (classMatch) {
      const [, cls, prop, val] = classMatch;
      return instances.filter(i => {
        if (cls && i._class !== cls) return false;
        if (prop && val) {
          const [ln, p] = prop.split('.');
          const v = i.components?.[ln]?.[p];
          return String(v).toLowerCase() === val.toLowerCase() || v === (val === 'true' ? true : val === 'false' ? false : val);
        }
        return true;
      });
    }
    
    const relMatch = query.match(/-\[:([^\]]+)\]->:\s*(.*)$/);
    if (relMatch) {
      const [, rel, target] = relMatch;
      return instances.filter(i => {
        const rels = i.relations?.[rel];
        if (!rels) return false;
        if (!target) return rels.length > 0;
        return rels.some(r => (typeof r === 'string' ? r : r._to) === target);
      });
    }
    
    // Basic text search
    return instances.filter(i => {
      if (i._id.toLowerCase().includes(q)) return true;
      if (i._class.toLowerCase().includes(q)) return true;
      if (JSON.stringify(i.components || {}).toLowerCase().includes(q)) return true;
      return false;
    });
  },
  
  validateType(value, type, required = false) {
    const errors = [];
    
    if (required && (value === null || value === undefined || value === '')) {
      errors.push({ message: 'Field is required', type: 'error' });
      return errors;
    }
    
    if (value === null || value === undefined || value === '') return errors;
    
    switch (type) {
      case 'int':
      case 'integer':
        if (!Number.isInteger(Number(value))) {
          errors.push({ message: 'Expected integer', type: 'error' });
        }
        break;
      case 'float':
      case 'double':
      case 'number':
        if (isNaN(Number(value))) {
          errors.push({ message: 'Expected number', type: 'error' });
        }
        break;
      case 'bool':
      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors.push({ message: 'Expected boolean', type: 'error' });
        }
        break;
      case 'date':
        if (isNaN(Date.parse(value))) {
          errors.push({ message: 'Invalid date', type: 'error' });
        }
        break;
    }
    
    return errors;
  }
};
