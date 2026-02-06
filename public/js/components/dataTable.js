/**
 * Data Table Component
 * Main data grid with sorting, filtering, selection
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

    visibleColumns() {
      return Alpine.store('editor').columns.filter(c => c.visible);
    },

    filteredInstances() {
      const store = Alpine.store('editor');
      let instances = store.instances || [];
      
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

    paginatedInstances() {
      const store = Alpine.store('editor');
      let filtered = this.filteredInstances();
      
      // Apply sorting
      if (store.sortColumn) {
        filtered = [...filtered].sort((a, b) => {
          let aVal, bVal;
          
          if (store.sortColumn === '_id') {
            aVal = a._id;
            bVal = b._id;
          } else if (store.sortColumn === '_class') {
            aVal = a._class;
            bVal = b._class;
          } else {
            const [ln, prop] = store.sortColumn.split('.');
            aVal = a.components?.[ln]?.[prop] ?? '';
            bVal = b.components?.[ln]?.[prop] ?? '';
          }
          
          // Handle numbers
          const aNum = Number(aVal);
          const bNum = Number(bVal);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return store.sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
          }
          
          // String comparison
          const aStr = String(aVal).toLowerCase();
          const bStr = String(bVal).toLowerCase();
          if (store.sortDirection === 'asc') {
            return aStr.localeCompare(bStr);
          }
          return bStr.localeCompare(aStr);
        });
      }
      
      const start = (store.currentPage - 1) * store.pageSize;
      const end = start + store.pageSize;
      return filtered.slice(start, end);
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
        store.selectedRows = this.paginatedInstances().map(i => i._id);
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
      const filtered = this.filteredInstances();
      
      for (const inst of filtered.slice(0, 100)) {
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
 * Cell widget base component
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
