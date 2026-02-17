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
    selectedCell: { rowId: null, colId: null },
    selectionAnchorRowId: null,
    tableInteractionsInitialized: false,

    init() {
      this.initTableInteractions();
    },

    initTableInteractions() {
      if (this.tableInteractionsInitialized) return;
      this.tableInteractionsInitialized = true;

      // Load column widths
      try {
        this.columnWidths = JSON.parse(localStorage.getItem('gdedit-column-widths') || '{}');
      } catch { this.columnWidths = {}; }

      // Mouse event handlers for resize
      document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      document.addEventListener('mouseup', () => this.handleMouseUp());
      document.addEventListener('keydown', (e) => this.handleTableKeydown(e));
    },

    syncInspectorSelection(store) {
      if (store.autoSelect !== true) return;
      store.inspectorSelectedRows = [...(store.selectedRows || [])];
      store.inspectorSelectedEntityId = store.selectedEntityId || store.inspectorSelectedRows[0] || null;
    },

    getNavigableColumns() {
      return ['_id', '_class', ...this.visibleColumns().map((col) => col.id), '_relations'];
    },

    getVisibleRows() {
      return this.paginatedInstances();
    },

    ensureSelectedCell() {
      const rows = this.getVisibleRows();
      const cols = this.getNavigableColumns();
      if (!rows.length || !cols.length) return null;

      if (!this.selectedCell.rowId || !this.selectedCell.colId) {
        this.setSelectedCell(rows[0]._id, cols[0], { updateSelection: true });
      }

      return this.selectedCell;
    },

    handleCellPointerDown(event, rowId, colId) {
      const interactiveTarget = event.target instanceof Element
        ? event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')
        : null;
      const isSameCell = this.isCellSelected(rowId, colId);
      const hasModifier = event.ctrlKey || event.metaKey || event.shiftKey;

      if (interactiveTarget && !isSameCell) {
        event.preventDefault();
        event.stopPropagation();
      }

      this.applyRowSelectionFromPointer(event, rowId);

      this.setSelectedCell(rowId, colId, { updateSelection: !hasModifier });
    },

    applyRowSelectionFromPointer(event, rowId) {
      const store = Alpine.store('editor');
      const isAdditiveClick = event.ctrlKey || event.metaKey;
      const isRangeClick = event.shiftKey;
      const currentSelection = [...(store.selectedRows || [])];
      const isAlreadySelected = currentSelection.includes(rowId);

      if ((isAdditiveClick || isRangeClick) && isAlreadySelected) {
        store.selectedRows = currentSelection.filter((id) => id !== rowId);
        store.selectedEntityId = store.selectedRows[0] || null;
        if (this.selectionAnchorRowId === rowId) {
          this.selectionAnchorRowId = store.selectedEntityId || store.selectedRows[0] || null;
        }
        this.syncInspectorSelection(store);
        return;
      }

      if (isRangeClick) {
        const rows = this.getVisibleRows();
        const anchorId = this.selectionAnchorRowId || store.selectedEntityId || store.selectedRows?.[0] || rowId;
        const anchorIndex = rows.findIndex((row) => row._id === anchorId);
        const targetIndex = rows.findIndex((row) => row._id === rowId);

        if (anchorIndex >= 0 && targetIndex >= 0) {
          const from = Math.min(anchorIndex, targetIndex);
          const to = Math.max(anchorIndex, targetIndex);
          const rangeIds = rows.slice(from, to + 1).map((row) => row._id);
          const merged = new Set([...(store.selectedRows || []), ...rangeIds]);
          store.selectedRows = [...merged];
        } else {
          const merged = new Set([...(store.selectedRows || []), rowId]);
          store.selectedRows = [...merged];
        }

        store.selectedEntityId = rowId;
        this.syncInspectorSelection(store);
        return;
      }

      if (isAdditiveClick) {
        const merged = new Set([...(store.selectedRows || []), rowId]);
        store.selectedRows = [...merged];
        store.selectedEntityId = rowId;
        this.selectionAnchorRowId = rowId;
        this.syncInspectorSelection(store);
      }
    },

    setSelectedCell(rowId, colId, { updateSelection = true } = {}) {
      this.selectedCell = { rowId, colId };
      if (!updateSelection) return;

      const store = Alpine.store('editor');
      store.selectedRows = [rowId];
      store.selectedEntityId = rowId;
      this.selectionAnchorRowId = rowId;
      this.syncInspectorSelection(store);

      if (store.autoScroll !== false) {
        this.scrollSelectedCellIntoView();
      }
    },

    getSelectedCellElement() {
      if (!this.selectedCell.rowId || !this.selectedCell.colId) return null;
      const rowId = CSS.escape(String(this.selectedCell.rowId));
      const colId = CSS.escape(String(this.selectedCell.colId));
      return this.$el.querySelector(`[data-row-id="${rowId}"][data-col-id="${colId}"]`);
    },

    scrollSelectedCellIntoView() {
      const selectedCellEl = this.getSelectedCellElement();
      if (!selectedCellEl) return;
      selectedCellEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    },

    focusSelectedCellInput() {
      const selectedCellEl = this.getSelectedCellElement();
      if (!selectedCellEl) return;
      const input = selectedCellEl.querySelector('input, textarea, select, [contenteditable="true"]');
      if (input && typeof input.focus === 'function') {
        input.focus();
      }
    },

    blurActiveEditorIfInsideTable() {
      const activeEl = document.activeElement;
      if (!activeEl || !this.$el.contains(activeEl)) return false;
      if (typeof activeEl.blur === 'function') {
        activeEl.blur();
        return true;
      }
      return false;
    },

    handleTableKeydown(event) {
      const store = Alpine.store('editor');
      if (store.viewMode !== 'table') return;

      const isArrowKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key);
      const isEnter = event.key === 'Enter';
      const isEscape = event.key === 'Escape';
      if (!isArrowKey && !isEnter && !isEscape) return;

      const activeEl = document.activeElement;
      const activeTag = activeEl?.tagName?.toLowerCase();
      const isFormControl = ['input', 'textarea', 'select'].includes(activeTag);

      if (isEscape) {
        if (this.blurActiveEditorIfInsideTable()) {
          event.preventDefault();
          return;
        }
      }

      if (isEnter) {
        if (isFormControl) return;
        event.preventDefault();
        this.ensureSelectedCell();
        this.focusSelectedCellInput();
        return;
      }

      if (isArrowKey && isFormControl) return;

      const rows = this.getVisibleRows();
      const cols = this.getNavigableColumns();
      if (!rows.length || !cols.length) return;

      event.preventDefault();
      const current = this.ensureSelectedCell() || { rowId: rows[0]._id, colId: cols[0] };

      let rowIndex = rows.findIndex((r) => r._id === current.rowId);
      if (rowIndex < 0) rowIndex = 0;
      let colIndex = cols.indexOf(current.colId);
      if (colIndex < 0) colIndex = 0;

      if (event.key === 'ArrowUp') rowIndex = Math.max(0, rowIndex - 1);
      if (event.key === 'ArrowDown') rowIndex = Math.min(rows.length - 1, rowIndex + 1);
      if (event.key === 'ArrowLeft') colIndex = Math.max(0, colIndex - 1);
      if (event.key === 'ArrowRight') colIndex = Math.min(cols.length - 1, colIndex + 1);

      this.setSelectedCell(rows[rowIndex]._id, cols[colIndex], { updateSelection: true });
    },

    isCellSelected(rowId, colId) {
      return this.selectedCell.rowId === rowId && this.selectedCell.colId === colId;
    },

    getCellHighlightStyle(rowId, colId) {
      const store = Alpine.store('editor');
      const alpha = Number.isFinite(Number(store.highlightAlpha)) ? Math.min(1, Math.max(0, Number(store.highlightAlpha))) : 0.35;
      const secondaryAlpha = Math.min(1, alpha * 0.75);

      if (this.isCellSelected(rowId, colId)) {
        return `background-color: rgba(59, 130, 246, ${alpha});`;
      }

      const rowMatch = store.highlightRows !== false && this.selectedCell.rowId === rowId;
      const colMatch = store.highlightCols !== false && this.selectedCell.colId === colId;
      if (rowMatch || colMatch) {
        return `background-color: rgba(59, 130, 246, ${secondaryAlpha});`;
      }

      return '';
    },

    visibleColumns() {
      return Alpine.store('editor').columns.filter(c => c.visible);
    },

    filteredInstances() {
      const store = Alpine.store('editor');
      let instances = store.instances || [];
      
      if (Array.isArray(store.selectedClasses) && store.selectedClasses.length > 0) {
        instances = instances.filter(i => store.selectedClasses.includes(i._class));
      } else if (store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      
      if (store.searchQuery) {
        instances = window.GDEdit?.applyGlobalFilter?.(instances, store.searchQuery, store.searchMode) || this.basicFilter(instances, store.searchQuery);
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
      store.selectedEntityId = store.selectedRows[0] || null;
      this.syncInspectorSelection(store);
    },

    toggleSelectAll(event) {
      const store = Alpine.store('editor');
      if (event.target.checked) {
        store.selectedRows = this.paginatedInstances().map(i => i._id);
      } else {
        store.selectedRows = [];
      }
      store.selectedEntityId = store.selectedRows[0] || null;
      this.syncInspectorSelection(store);
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

    get targetInstances() {
      if (Array.isArray(this.instance)) return this.instance.filter(Boolean);
      return this.instance ? [this.instance] : [];
    },

    _getRawValue(target) {
      const [localName, property] = this.col.id.split('.');
      return target?.components?.[localName]?.[property];
    },

    _valuesEqual(a, b) {
      if (a === b) return true;
      if (Number.isNaN(a) && Number.isNaN(b)) return true;
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    },

    get valueSet() {
      return this.targetInstances.map((target) => this._getRawValue(target));
    },

    get isMixed() {
      const values = this.valueSet;
      if (values.length <= 1) return false;
      const first = values[0];
      for (let i = 1; i < values.length; i += 1) {
        if (!this._valuesEqual(first, values[i])) return true;
      }
      return false;
    },

    getValue() {
      if (!this.targetInstances.length) return undefined;
      if (this.isMixed) return undefined;
      return this.valueSet[0];
    },

    async setValueFromInput(rawValue, parser = null) {
      const text = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
      if (this.isMixed && (text === '' || text === '--' || text === '—' || text === '— mixed —' || text === '-- mixed --')) return;

      const value = typeof parser === 'function' ? parser(rawValue) : rawValue;
      await this.setValue(value);
    },

    async setValue(value) {
      if (!this.targetInstances.length) return;

      // Validate before saving
      this.validationErrors = window.GDEdit?.validateType?.(value, this.col.type, this.col.required) || [];
      
      if (this.validationErrors.some(e => e.type === 'error')) {
        return; // Don't save invalid data
      }

      const results = await Promise.all(this.targetInstances.map(async (target) => {
        const res = await fetch(`/api/instances/${target._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId: this.col.id, value })
        });
        return { target, ok: res.ok };
      }));

      const allSucceeded = results.every((result) => result.ok);
      if (!allSucceeded) return;

      const [localName, property] = this.col.id.split('.');
      for (const { target } of results) {
        if (!target.components) target.components = {};
        if (!target.components[localName]) target.components[localName] = {};
        target.components[localName][property] = value;
      }
      this.validationErrors = [];
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
