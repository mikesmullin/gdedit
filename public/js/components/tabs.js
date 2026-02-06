/**
 * Navigation Components - Tab Management & Views
 * Phase 3: Tier 3/4 tabs, pinning, view editor
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
  
  return [...paths.entries()].map(([path, info]) => ({ path, ...info }));
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
      this.filterColumnsByComponent();
    },
    
    filterColumnsByComponent() {
      const store = Alpine.store('editor');
      if (!this.selectedComponent) {
        store.columns.forEach(c => c.visible = true);
        return;
      }
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
            this.childData.push({ _parentId: inst._id, _index: i, _path: path, ...value[i] });
          }
        } else if (typeof value === 'object') {
          this.childData.push({ _parentId: inst._id, _index: null, _path: path, ...value });
        }
      }
    },
    
    get hasNestedData() { return this.nestedPaths.length > 0; },
    
    get childColumns() {
      if (this.childData.length === 0) return [];
      const keys = new Set();
      for (const item of this.childData) {
        Object.keys(item).forEach(k => { if (!k.startsWith('_')) keys.add(k); });
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
    
    init() { this.loadPinnedTabs(); },
    
    loadPinnedTabs() {
      try {
        this.pinnedTabs = JSON.parse(localStorage.getItem('gdedit-pinned-tabs') || '[]');
      } catch { this.pinnedTabs = []; }
    },
    
    savePinnedTabs() {
      localStorage.setItem('gdedit-pinned-tabs', JSON.stringify(this.pinnedTabs));
    },
    
    isPinned(tabId) { return this.pinnedTabs.includes(tabId); },
    
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
      return this.pinnedTabs.filter(p => p.startsWith(`${type}:`)).map(p => p.split(':')[1]);
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
      name: '', icon: '📊', color: '#3b82f6',
      classes: [], columnPresets: {},
      defaultSort: { column: '_id', direction: 'asc' },
      readOnly: false
    },
    availableIcons: ['📊', '🎮', '👥', '🖥️', '⚙️', '📦', '🎨', '🔧', '📁', '🌟', '💼', '🎯'],
    isCreatingNew: false,
    
    openCreateView() {
      this.isCreatingNew = true;
      this.editingView = null;
      this.viewForm = {
        name: '', icon: '📊', color: '#3b82f6',
        classes: [], columnPresets: {},
        defaultSort: { column: '_id', direction: 'asc' },
        readOnly: false
      };
      this.showViewEditor = true;
    },
    
    openEditView(view) {
      this.isCreatingNew = false;
      this.editingView = view;
      this.viewForm = {
        name: view.name, icon: view.icon || '📊', color: view.color || '#3b82f6',
        classes: [...(view.classes || [])],
        columnPresets: { ...(view.columnPresets || {}) },
        defaultSort: view.defaultSort || { column: '_id', direction: 'asc' },
        readOnly: view.readOnly || false
      };
      this.showViewEditor = true;
    },
    
    closeViewEditor() { this.showViewEditor = false; this.editingView = null; },
    
    toggleClass(cls) {
      const idx = this.viewForm.classes.indexOf(cls);
      if (idx >= 0) { this.viewForm.classes.splice(idx, 1); }
      else { this.viewForm.classes.push(cls); }
    },
    
    isClassSelected(cls) { return this.viewForm.classes.includes(cls); },
    
    async saveView() {
      if (!this.viewForm.name.trim()) { alert('View name is required'); return; }
      
      const store = Alpine.store('editor');
      const views = [...store.views];
      const viewData = {
        name: this.viewForm.name.trim(), icon: this.viewForm.icon,
        color: this.viewForm.color, classes: this.viewForm.classes,
        columnPresets: this.viewForm.columnPresets,
        defaultSort: this.viewForm.defaultSort, readOnly: this.viewForm.readOnly
      };
      
      if (this.isCreatingNew) { views.push(viewData); }
      else {
        const idx = views.findIndex(v => v.name === this.editingView.name);
        if (idx >= 0) views[idx] = viewData;
      }
      
      try {
        await fetch('/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ views })
        });
      } catch (e) { console.error('Failed to save view:', e); }
      
      store.views = views;
      this.closeViewEditor();
      window.dispatchEvent(new CustomEvent('gdedit:toast', { 
        detail: this.isCreatingNew ? 'View created' : 'View updated' 
      }));
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
      } catch (e) { console.error('Failed to save views:', e); }
      
      store.views = views;
      const appEl = document.querySelector('[x-data="app()"]');
      if (appEl?._x_dataStack?.[0]?.currentView?.name === this.editingView.name) {
        appEl._x_dataStack[0].setView(views[0]);
      }
      
      this.closeViewEditor();
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'View deleted' }));
    }
  };
}

// Initialize GDEditNav if not exists
window.GDEditNav = window.GDEditNav || {};
Object.assign(window.GDEditNav, {
  componentSubTabs,
  childTabs,
  tabPinning,
  viewEditor,
  getUniqueComponents,
  getNestedDataPaths
});
