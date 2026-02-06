/**
 * Column Management Components
 * Phase 3: Column grouping, reordering, sorting, freezing
 */

/**
 * Column grouping - Group columns by component in visibility menu
 */
function columnGrouping() {
  return {
    expandedGroups: {},
    
    init() {
      const groups = this.getColumnGroups();
      if (groups.length > 0) {
        this.expandedGroups[groups[0].name] = true;
      }
    },
    
    getColumnGroups() {
      const store = Alpine.store('editor');
      const groups = new Map();
      groups.set('_system', { name: '_system', label: 'System', columns: [] });
      
      for (const col of store.columns) {
        const [localName] = col.id.split('.');
        if (!groups.has(localName)) {
          groups.set(localName, { name: localName, label: localName, columns: [] });
        }
        groups.get(localName).columns.push(col);
      }
      return [...groups.values()].filter(g => g.columns.length > 0);
    },
    
    toggleGroup(groupName) {
      this.expandedGroups[groupName] = !this.expandedGroups[groupName];
    },
    
    isGroupExpanded(groupName) {
      return this.expandedGroups[groupName] || false;
    },
    
    toggleGroupVisibility(groupName, visible) {
      const store = Alpine.store('editor');
      for (const col of store.columns) {
        const [localName] = col.id.split('.');
        if (localName === groupName) col.visible = visible;
      }
    },
    
    isGroupFullyVisible(groupName) {
      const store = Alpine.store('editor');
      const groupCols = store.columns.filter(c => c.id.split('.')[0] === groupName);
      return groupCols.length > 0 && groupCols.every(c => c.visible);
    },
    
    isGroupPartiallyVisible(groupName) {
      const store = Alpine.store('editor');
      const groupCols = store.columns.filter(c => c.id.split('.')[0] === groupName);
      const visibleCount = groupCols.filter(c => c.visible).length;
      return visibleCount > 0 && visibleCount < groupCols.length;
    }
  };
}

/**
 * Column management - Reordering, sorting, freezing
 */
function columnManager() {
  return {
    sortColumn: null,
    sortDirection: 'asc',
    frozenColumns: ['_id', '_class'],
    draggedColumn: null,
    dragOverColumn: null,
    
    init() {
      try {
        const frozen = localStorage.getItem('gdedit-frozen-columns');
        if (frozen) this.frozenColumns = JSON.parse(frozen);
      } catch { /* use defaults */ }
    },
    
    // Sorting
    toggleSort(colId) {
      if (this.sortColumn === colId) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortColumn = colId;
        this.sortDirection = 'asc';
      }
      Alpine.store('editor').sortColumn = this.sortColumn;
      Alpine.store('editor').sortDirection = this.sortDirection;
    },
    
    getSortIcon(colId) {
      if (this.sortColumn !== colId) return '';
      return this.sortDirection === 'asc' ? '↑' : '↓';
    },
    
    // Column freezing
    isFrozen(colId) { return this.frozenColumns.includes(colId); },
    
    toggleFreeze(colId) {
      const idx = this.frozenColumns.indexOf(colId);
      if (idx >= 0) { this.frozenColumns.splice(idx, 1); }
      else { this.frozenColumns.push(colId); }
      localStorage.setItem('gdedit-frozen-columns', JSON.stringify(this.frozenColumns));
    },
    
    // Column reordering via drag
    startDrag(e, colId) {
      this.draggedColumn = colId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', colId);
    },
    
    onDragOver(e, colId) {
      e.preventDefault();
      if (this.draggedColumn && this.draggedColumn !== colId) {
        this.dragOverColumn = colId;
      }
    },
    
    onDragLeave() { this.dragOverColumn = null; },
    
    onDrop(e, targetColId) {
      e.preventDefault();
      if (!this.draggedColumn || this.draggedColumn === targetColId) return;
      
      const store = Alpine.store('editor');
      const columns = [...store.columns];
      const fromIdx = columns.findIndex(c => c.id === this.draggedColumn);
      const toIdx = columns.findIndex(c => c.id === targetColId);
      
      if (fromIdx >= 0 && toIdx >= 0) {
        const [moved] = columns.splice(fromIdx, 1);
        columns.splice(toIdx, 0, moved);
        store.columns = columns;
        localStorage.setItem('gdedit-column-order', JSON.stringify(columns.map(c => c.id)));
      }
      this.draggedColumn = null;
      this.dragOverColumn = null;
    },
    
    onDragEnd() {
      this.draggedColumn = null;
      this.dragOverColumn = null;
    }
  };
}

/**
 * Hierarchical column menu - Column visibility with search
 */
function hierarchicalColumnMenu() {
  return {
    isOpen: false,
    expandedComponents: {},
    searchTerm: '',
    
    toggle() { this.isOpen = !this.isOpen; },
    close() { this.isOpen = false; this.searchTerm = ''; },
    
    toggleComponent(name) {
      this.expandedComponents[name] = !this.expandedComponents[name];
    },
    
    isComponentExpanded(name) {
      return this.expandedComponents[name] || false;
    },
    
    getHierarchy() {
      const store = Alpine.store('editor');
      const hierarchy = new Map();
      
      for (const col of store.columns) {
        const [localName] = col.id.split('.');
        if (!hierarchy.has(localName)) {
          hierarchy.set(localName, { name: localName, columns: [] });
        }
        // Apply search filter
        if (this.searchTerm) {
          const term = this.searchTerm.toLowerCase();
          if (!col.id.toLowerCase().includes(term)) continue;
        }
        hierarchy.get(localName).columns.push(col);
      }
      return [...hierarchy.values()].filter(h => h.columns.length > 0);
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
    
    showAllInComponent(componentName) {
      Alpine.store('editor').columns.forEach(col => {
        if (col.id.startsWith(componentName + '.')) col.visible = true;
      });
    },
    
    hideAllInComponent(componentName) {
      Alpine.store('editor').columns.forEach(col => {
        if (col.id.startsWith(componentName + '.')) col.visible = false;
      });
    },
    
    getComponentVisibleCount(componentName) {
      return Alpine.store('editor').columns.filter(c => 
        c.id.startsWith(componentName + '.') && c.visible
      ).length;
    },
    
    getComponentTotalCount(componentName) {
      return Alpine.store('editor').columns.filter(c => 
        c.id.startsWith(componentName + '.')
      ).length;
    },
    
    get visibleColumnsCount() {
      return Alpine.store('editor').columns.filter(c => c.visible).length;
    },
    
    get totalColumnsCount() {
      return Alpine.store('editor').columns.length;
    }
  };
}

// Initialize GDEditNav if not exists
window.GDEditNav = window.GDEditNav || {};
Object.assign(window.GDEditNav, {
  columnGrouping,
  columnManager,
  hierarchicalColumnMenu
});
