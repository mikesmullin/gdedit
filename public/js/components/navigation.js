/**
 * Navigation & Views Components
 * Phase 3: Tier 3/4 tabs, pinning, view editor, column management
 */

/**
 * Get unique components from instances
 */
function getUniqueComponents(instances) {
  const components = new Set();
  for (const inst of instances) {
    if (inst.components) {
      Object.keys(inst.components).forEach(c => components.add(c));
    }
  }
  return [...components].sort();
}

/**
 * Get nested data paths from instances
 */
function getNestedDataPaths(instances, selectedClass) {
  const paths = new Map(); // path -> { count, sampleValue }
  
  const filtered = selectedClass 
    ? instances.filter(i => i._class === selectedClass)
    : instances;
    
  for (const inst of filtered) {
    if (!inst.components) continue;
    
    for (const [comp, props] of Object.entries(inst.components)) {
      for (const [prop, value] of Object.entries(props)) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          const path = `${comp}.${prop}`;
          const existing = paths.get(path) || { count: 0, isArray: true };
          existing.count += value.length;
          paths.set(path, existing);
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          const path = `${comp}.${prop}`;
          const existing = paths.get(path) || { count: 0, isArray: false };
          existing.count++;
          paths.set(path, existing);
        }
      }
    }
  }
  
  return [...paths.entries()].map(([path, info]) => ({
    path,
    ...info
  }));
}

/**
 * Component Sub-Tabs (Tier 3) - Alpine component
 */
function componentSubTabs() {
  return {
    selectedComponent: null,
    components: [],
    
    init() {
      this.updateComponents();
      
      // Watch for data changes
      this.$watch('$store.editor.instances', () => this.updateComponents());
      this.$watch('$store.editor.selectedClass', () => {
        this.selectedComponent = null;
        this.updateComponents();
      });
    },
    
    updateComponents() {
      const store = Alpine.store('editor');
      let instances = store.instances;
      
      if (store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      
      this.components = getUniqueComponents(instances);
    },
    
    selectComponent(comp) {
      this.selectedComponent = comp === this.selectedComponent ? null : comp;
      Alpine.store('editor').selectedComponent = this.selectedComponent;
      
      // Update column visibility based on component
      this.filterColumnsByComponent();
    },
    
    filterColumnsByComponent() {
      const store = Alpine.store('editor');
      
      if (!this.selectedComponent) {
        // Show all columns
        store.columns.forEach(c => c.visible = true);
        return;
      }
      
      // Show only columns matching selected component
      store.columns.forEach(col => {
        const [localName] = col.id.split('.');
        col.visible = localName === this.selectedComponent;
      });
    },
    
    get hasComponents() {
      return this.components.length > 0;
    }
  };
}

/**
 * Child-Tabs (Tier 4) - Navigate nested data hierarchies
 */
function childTabs() {
  return {
    nestedPaths: [],
    selectedPath: null,
    childData: [],
    parentInstance: null,
    
    init() {
      this.updateNestedPaths();
      
      this.$watch('$store.editor.selectedClass', () => {
        this.selectedPath = null;
        this.childData = [];
        this.updateNestedPaths();
      });
    },
    
    updateNestedPaths() {
      const store = Alpine.store('editor');
      this.nestedPaths = getNestedDataPaths(store.instances, store.selectedClass);
    },
    
    selectPath(path) {
      if (this.selectedPath === path) {
        this.selectedPath = null;
        this.childData = [];
        return;
      }
      
      this.selectedPath = path;
      this.loadChildData(path);
    },
    
    loadChildData(path) {
      const store = Alpine.store('editor');
      const [comp, prop] = path.split('.');
      let instances = store.instances;
      
      if (store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      
      this.childData = [];
      
      for (const inst of instances) {
        const value = inst.components?.[comp]?.[prop];
        if (!value) continue;
        
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            this.childData.push({
              _parentId: inst._id,
              _index: i,
              _path: path,
              ...value[i]
            });
          }
        } else if (typeof value === 'object') {
          this.childData.push({
            _parentId: inst._id,
            _index: null,
            _path: path,
            ...value
          });
        }
      }
    },
    
    get hasNestedData() {
      return this.nestedPaths.length > 0;
    },
    
    get childColumns() {
      if (this.childData.length === 0) return [];
      
      const keys = new Set();
      for (const item of this.childData) {
        Object.keys(item).forEach(k => {
          if (!k.startsWith('_')) keys.add(k);
        });
      }
      return [...keys];
    }
  };
}

/**
 * Tab Pinning - Pin frequently used tabs
 */
function tabPinning() {
  return {
    pinnedTabs: [],
    
    init() {
      this.loadPinnedTabs();
    },
    
    loadPinnedTabs() {
      try {
        this.pinnedTabs = JSON.parse(localStorage.getItem('gdedit-pinned-tabs') || '[]');
      } catch {
        this.pinnedTabs = [];
      }
    },
    
    savePinnedTabs() {
      localStorage.setItem('gdedit-pinned-tabs', JSON.stringify(this.pinnedTabs));
    },
    
    isPinned(tabId) {
      return this.pinnedTabs.includes(tabId);
    },
    
    togglePin(tabId, tabType = 'class') {
      const id = `${tabType}:${tabId}`;
      const idx = this.pinnedTabs.indexOf(id);
      
      if (idx >= 0) {
        this.pinnedTabs.splice(idx, 1);
      } else {
        this.pinnedTabs.push(id);
      }
      
      this.savePinnedTabs();
    },
    
    getPinnedOfType(type) {
      return this.pinnedTabs
        .filter(p => p.startsWith(`${type}:`))
        .map(p => p.split(':')[1]);
    }
  };
}

/**
 * View Editor Dialog - Configure activity views
 */
function viewEditor() {
  return {
    showViewEditor: false,
    editingView: null,
    viewForm: {
      name: '',
      icon: '📊',
      color: '#3b82f6',
      classes: [],
      columnPresets: {},
      defaultSort: { column: '_id', direction: 'asc' },
      readOnly: false
    },
    availableIcons: ['📊', '🎮', '👥', '🖥️', '⚙️', '📦', '🎨', '🔧', '📁', '🌟', '💼', '🎯'],
    isCreatingNew: false,
    
    init() {
      // Initialize from store
    },
    
    openCreateView() {
      this.isCreatingNew = true;
      this.editingView = null;
      this.viewForm = {
        name: '',
        icon: '📊',
        color: '#3b82f6',
        classes: [],
        columnPresets: {},
        defaultSort: { column: '_id', direction: 'asc' },
        readOnly: false
      };
      this.showViewEditor = true;
    },
    
    openEditView(view) {
      this.isCreatingNew = false;
      this.editingView = view;
      this.viewForm = {
        name: view.name,
        icon: view.icon || '📊',
        color: view.color || '#3b82f6',
        classes: [...(view.classes || [])],
        columnPresets: { ...(view.columnPresets || {}) },
        defaultSort: view.defaultSort || { column: '_id', direction: 'asc' },
        readOnly: view.readOnly || false
      };
      this.showViewEditor = true;
    },
    
    closeViewEditor() {
      this.showViewEditor = false;
      this.editingView = null;
    },
    
    toggleClass(cls) {
      const idx = this.viewForm.classes.indexOf(cls);
      if (idx >= 0) {
        this.viewForm.classes.splice(idx, 1);
      } else {
        this.viewForm.classes.push(cls);
      }
    },
    
    isClassSelected(cls) {
      return this.viewForm.classes.includes(cls);
    },
    
    async saveView() {
      if (!this.viewForm.name.trim()) {
        alert('View name is required');
        return;
      }
      
      const store = Alpine.store('editor');
      const views = [...store.views];
      
      const viewData = {
        name: this.viewForm.name.trim(),
        icon: this.viewForm.icon,
        color: this.viewForm.color,
        classes: this.viewForm.classes,
        columnPresets: this.viewForm.columnPresets,
        defaultSort: this.viewForm.defaultSort,
        readOnly: this.viewForm.readOnly
      };
      
      if (this.isCreatingNew) {
        views.push(viewData);
      } else {
        const idx = views.findIndex(v => v.name === this.editingView.name);
        if (idx >= 0) {
          views[idx] = viewData;
        }
      }
      
      // Save to server
      try {
        await fetch('/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ views })
        });
        
        store.views = views;
        this.closeViewEditor();
        window.dispatchEvent(new CustomEvent('gdedit:toast', { 
          detail: this.isCreatingNew ? 'View created' : 'View updated' 
        }));
      } catch (e) {
        console.error('Failed to save view:', e);
        // Still update locally
        store.views = views;
        this.closeViewEditor();
      }
    },
    
    async deleteView() {
      if (!this.editingView) return;
      if (!confirm(`Delete view "${this.editingView.name}"?`)) return;
      
      const store = Alpine.store('editor');
      const views = store.views.filter(v => v.name !== this.editingView.name);
      
      try {
        await fetch('/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ views })
        });
      } catch (e) {
        console.error('Failed to save views:', e);
      }
      
      store.views = views;
      
      // If deleted current view, switch to first view
      const appEl = document.querySelector('[x-data="app()"]');
      if (appEl?._x_dataStack?.[0]?.currentView?.name === this.editingView.name) {
        appEl._x_dataStack[0].setView(views[0]);
      }
      
      this.closeViewEditor();
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'View deleted' }));
    },
    
    // Column preset management
    setColumnPreset(className, columns) {
      this.viewForm.columnPresets[className] = columns;
    },
    
    getColumnPreset(className) {
      return this.viewForm.columnPresets[className] || [];
    }
  };
}

/**
 * Column grouping - Group columns by component in visibility menu
 */
function columnGrouping() {
  return {
    expandedGroups: {},
    
    init() {
      // Expand first group by default
      const groups = this.getColumnGroups();
      if (groups.length > 0) {
        this.expandedGroups[groups[0].name] = true;
      }
    },
    
    getColumnGroups() {
      const store = Alpine.store('editor');
      const groups = new Map();
      
      // Add system columns group
      groups.set('_system', {
        name: '_system',
        label: 'System',
        columns: []
      });
      
      for (const col of store.columns) {
        const [localName] = col.id.split('.');
        
        if (!groups.has(localName)) {
          groups.set(localName, {
            name: localName,
            label: localName,
            columns: []
          });
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
        if (localName === groupName) {
          col.visible = visible;
        }
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
      // Load frozen columns from localStorage
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
    isFrozen(colId) {
      return this.frozenColumns.includes(colId);
    },
    
    toggleFreeze(colId) {
      const idx = this.frozenColumns.indexOf(colId);
      if (idx >= 0) {
        this.frozenColumns.splice(idx, 1);
      } else {
        this.frozenColumns.push(colId);
      }
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
    
    onDragLeave() {
      this.dragOverColumn = null;
    },
    
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
        
        // Save column order
        const order = columns.map(c => c.id);
        localStorage.setItem('gdedit-column-order', JSON.stringify(order));
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
 * Hierarchical column menu
 */
function hierarchicalColumnMenu() {
  return {
    isOpen: false,
    expandedComponents: {},
    searchTerm: '',
    
    toggle() {
      this.isOpen = !this.isOpen;
    },
    
    close() {
      this.isOpen = false;
      this.searchTerm = '';
    },
    
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
        const [localName, propName] = col.id.split('.');
        
        if (!hierarchy.has(localName)) {
          hierarchy.set(localName, {
            name: localName,
            columns: []
          });
        }
        
        // Apply search filter
        if (this.searchTerm) {
          const term = this.searchTerm.toLowerCase();
          if (!col.id.toLowerCase().includes(term)) continue;
        }
        
        hierarchy.get(localName).columns.push(col);
      }
      
      // Filter out empty components after search
      return [...hierarchy.values()].filter(h => h.columns.length > 0);
    },
    
    toggleColumn(colId) {
      const store = Alpine.store('editor');
      const col = store.columns.find(c => c.id === colId);
      if (col) col.visible = !col.visible;
    },
    
    showAllInComponent(componentName) {
      const store = Alpine.store('editor');
      store.columns.forEach(col => {
        if (col.id.startsWith(componentName + '.')) {
          col.visible = true;
        }
      });
    },
    
    hideAllInComponent(componentName) {
      const store = Alpine.store('editor');
      store.columns.forEach(col => {
        if (col.id.startsWith(componentName + '.')) {
          col.visible = false;
        }
      });
    },
    
    getComponentVisibleCount(componentName) {
      const store = Alpine.store('editor');
      return store.columns.filter(c => 
        c.id.startsWith(componentName + '.') && c.visible
      ).length;
    },
    
    getComponentTotalCount(componentName) {
      const store = Alpine.store('editor');
      return store.columns.filter(c => 
        c.id.startsWith(componentName + '.')
      ).length;
    }
  };
}

// Export to window for Alpine.js access
window.GDEditNav = {
  componentSubTabs,
  childTabs,
  tabPinning,
  viewEditor,
  columnGrouping,
  columnManager,
  hierarchicalColumnMenu,
  getUniqueComponents,
  getNestedDataPaths
};
