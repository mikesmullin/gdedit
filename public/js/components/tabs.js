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

function getViewByName(views, name) {
  return (views || []).find((view) => view.name === name) || null;
}

function isAllViewName(name) {
  return String(name || '').trim().toLowerCase() === 'all';
}

function getSelectedViewClasses(store) {
  const allClasses = store.classes || [];
  const selectedViewNames = store.selectedViews || [];
  const allViews = store.views || [];

  if (!selectedViewNames.length) return allClasses;

  const selectedViews = selectedViewNames
    .map((name) => getViewByName(allViews, name))
    .filter(Boolean);

  if (!selectedViews.length) return allClasses;
  if (selectedViews.some((view) => !Array.isArray(view.classes) || view.classes.length === 0)) {
    return allClasses;
  }

  const union = new Set();
  for (const view of selectedViews) {
    for (const cls of (view.classes || [])) union.add(cls);
  }

  return allClasses.filter((cls) => union.has(cls));
}

function filterBySelectedClasses(instances, store) {
  if (Array.isArray(store.selectedClasses) && store.selectedClasses.length > 0) {
    return instances.filter((i) => store.selectedClasses.includes(i._class));
  }
  if (store.selectedClass) {
    return instances.filter((i) => i._class === store.selectedClass);
  }
  return instances;
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getEditorStore() {
  return Alpine.store('editor');
}

function updateConfigCache(config) {
  const store = getEditorStore();
  const revision = Number(config?.revision);
  if (Number.isInteger(revision) && revision >= 0) {
    store.configRevision = revision;
  }
  if (config && typeof config === 'object') {
    store.configSnapshot = config;
    store.configLoaded = true;
  }
}

async function refreshConfigCache() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  updateConfigCache(cfg);
  return cfg;
}

function getConfigSnapshot() {
  return getEditorStore().configSnapshot || null;
}

async function patchConfigWithRevision(patch, maxRetries = 1) {
  let attempts = 0;

  while (attempts <= maxRetries) {
    attempts += 1;

    const store = getEditorStore();
    if (!store.configLoaded || !Number.isInteger(store.configRevision)) {
      await refreshConfigCache();
    }

    const payload = {
      ...patch,
      revision: store.configRevision
    };

    const res = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const cfg = await res.json();
      updateConfigCache(cfg);
      return cfg;
    }

    const details = await res.json().catch(() => ({}));
    const isRevisionMismatch = res.status === 409 && details?.code === 'REVISION_MISMATCH';
    if (!isRevisionMismatch) {
      throw new Error(details?.error || 'Failed to patch config');
    }

    if (Number.isInteger(details?.expectedRevision)) {
      store.configRevision = details.expectedRevision;
    } else {
      await refreshConfigCache();
    }
  }

  throw new Error('Failed to patch config after revision retries');
}

async function saveViewsWithRevision(views, maxRetries = 1) {
  let attempts = 0;

  while (attempts <= maxRetries) {
    attempts += 1;

    const store = getEditorStore();
    if (!store.configLoaded || !Number.isInteger(store.configRevision)) {
      await refreshConfigCache();
    }

    const res = await fetch('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ views, revision: store.configRevision })
    });

    if (res.ok) {
      const cfg = await res.json();
      updateConfigCache(cfg);
      return cfg;
    }

    const details = await res.json().catch(() => ({}));
    const isRevisionMismatch = res.status === 409 && details?.code === 'REVISION_MISMATCH';
    if (!isRevisionMismatch) {
      throw new Error(details?.error || 'Failed to save views');
    }

    if (Number.isInteger(details?.expectedRevision)) {
      store.configRevision = details.expectedRevision;
    } else {
      await refreshConfigCache();
    }
  }

  throw new Error('Failed to save views after revision retries');
}

async function persistFilterState(partialState) {
  try {
    await patchConfigWithRevision({ ui: { filterState: partialState } }, 1);
  } catch (error) {
    console.error('Failed to persist filter state:', error);
  }
}

function getStore() {
  return Alpine.store('editor');
}

function getAvailableViewNames() {
  const store = getStore();
  return (store.views || [])
    .map((view) => view?.name)
    .filter((name) => typeof name === 'string' && !isAllViewName(name));
}

function getAvailableClassNames() {
  return getSelectedViewClasses(getStore());
}

function getAvailableComponentNames() {
  const store = getStore();
  const schemaClasses = store.schema?.classes || {};
  const classNames = (store.selectedClasses && store.selectedClasses.length > 0)
    ? store.selectedClasses
    : Object.keys(schemaClasses);

  const components = new Set();
  for (const className of classNames) {
    const cls = schemaClasses[className];
    if (!cls?.components) continue;
    Object.keys(cls.components).forEach((localName) => components.add(localName));
  }

  return [...components].sort();
}

function orderedVisibleNames(selected, pinned, available) {
  const availableSet = new Set(available);
  const pinnedValid = (pinned || []).filter((name) => availableSet.has(name));
  const selectedValid = (selected || []).filter((name) => availableSet.has(name));
  const visible = [...pinnedValid];
  for (const name of selectedValid) {
    if (!visible.includes(name)) visible.push(name);
  }
  return { selectedValid, pinnedValid, visible };
}

function arraysEqualShallow(a = [], b = []) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function setArrayIfChanged(store, key, next) {
  const prev = Array.isArray(store[key]) ? store[key] : [];
  if (arraysEqualShallow(prev, next)) return false;
  store[key] = [...next];
  return true;
}

function setValueIfChanged(store, key, next) {
  if (store[key] === next) return false;
  store[key] = next;
  return true;
}

function applyComponentColumnVisibility(selectedOverride = null) {
  const store = getStore();
  const selected = Array.isArray(selectedOverride)
    ? selectedOverride
    : (store.selectedComponents || []);

  const columns = Array.isArray(store.columns) ? store.columns : [];
  if (!columns.length) return;

  if (!selected.length) {
    const hasHidden = columns.some((col) => col.visible !== true);
    if (!hasHidden) return;

    store.columns = columns.map((col) => ({
      ...col,
      visible: true
    }));
    return;
  }

  const allowed = new Set(selected.map((name) => String(name || '').trim().toLowerCase()).filter(Boolean));
  let hasChanges = false;
  const nextColumns = columns.map((col) => {
    const [localName] = col.id.split('.');
    const componentClass = String(col.component || '').trim().toLowerCase();
    const localNameKey = String(localName || '').trim().toLowerCase();
    const nextVisible = allowed.has(localNameKey) || (componentClass && allowed.has(componentClass));

    if (col.visible === nextVisible) return col;
    hasChanges = true;
    return {
      ...col,
      visible: nextVisible
    };
  });

  if (!hasChanges) return;
  store.columns = nextColumns;
}

function reconcileGlobalFilterState() {
  const store = getStore();

  let availableViews = [];
  if ((store.views || []).length > 0) {
    availableViews = getAvailableViewNames();
    const viewState = orderedVisibleNames(store.selectedViews || [], store.pinnedViews || [], availableViews);
    setArrayIfChanged(store, 'selectedViews', viewState.selectedValid);
    setArrayIfChanged(store, 'pinnedViews', viewState.pinnedValid);

    const activeView = store.selectedViews.length
      ? getViewByName(store.views || [], store.selectedViews[0])
      : null;
    if ((store.currentView?.name || null) !== (activeView?.name || null)) {
      store.currentView = activeView;
    }
    const appEl = document.querySelector('[x-data="app()"]');
    if (appEl?._x_dataStack?.[0] && (appEl._x_dataStack[0].currentView?.name || null) !== (activeView?.name || null)) {
      appEl._x_dataStack[0].currentView = activeView;
    }
  }

  let availableClasses = [];
  let availableComponents = [];
  if (store.dataLoaded) {
    availableClasses = getAvailableClassNames();
    const classState = orderedVisibleNames(store.selectedClasses || [], store.pinnedClasses || [], availableClasses);
    setArrayIfChanged(store, 'selectedClasses', classState.selectedValid);
    setArrayIfChanged(store, 'pinnedClasses', classState.pinnedValid);
    if (!store.selectedClasses.length) {
      setValueIfChanged(store, 'selectedClass', null);
    } else if (!store.selectedClasses.includes(store.selectedClass)) {
      setValueIfChanged(store, 'selectedClass', store.selectedClasses[0]);
    }

    availableComponents = getAvailableComponentNames();
    const compState = orderedVisibleNames(store.selectedComponents || [], store.pinnedComponents || [], availableComponents);
    // Keep selected/pinned component arrays as user intent state.
    // Do not prune them during reconcile, so transient class/view availability changes
    // cannot clear persisted component intent.
    setValueIfChanged(
      store,
      'selectedComponent',
      compState.selectedValid.length ? compState.selectedValid[0] : null
    );
    applyComponentColumnVisibility(compState.selectedValid);
  }

  return {
    availableViews,
    availableClasses,
    availableComponents,
    visibleViews: orderedVisibleNames(store.selectedViews || [], store.pinnedViews || [], availableViews).visible,
    visibleClasses: orderedVisibleNames(store.selectedClasses || [], store.pinnedClasses || [], availableClasses).visible,
    visibleComponents: orderedVisibleNames(store.selectedComponents || [], store.pinnedComponents || [], availableComponents).visible
  };
}

function persistGlobalFilterState() {
  const store = getStore();
  return persistFilterState({
    views: {
      selected: [...(store.selectedViews || [])],
      pinned: [...(store.pinnedViews || [])]
    },
    classes: {
      selected: [...(store.selectedClasses || [])],
      pinned: [...(store.pinnedClasses || [])]
    },
    components: {
      selected: [...(store.selectedComponents || [])],
      pinned: [...(store.pinnedComponents || [])]
    }
  });
}

/**
 * Tier 1 View Filter - searchable add + multi-select chips + meaningful pinning
 */
function viewFilter() {
  return {
    isOpen: false,
    searchTerm: '',
    isHydrating: false,

    async init() {
      this.isHydrating = true;
      await this.ensureViewsLoaded();
      this.loadPersistedState();
      reconcileGlobalFilterState();
      this.isHydrating = false;

      this.$watch('$store.editor.views', () => reconcileGlobalFilterState());
      this.$watch('$store.editor.dataLoaded', (loaded) => {
        if (!loaded) return;
        reconcileGlobalFilterState();
      });
      this.$watch('$store.editor.configLoaded', (loaded) => {
        if (!loaded) return;
        this.loadPersistedState();
        reconcileGlobalFilterState();
      });

      const store = getStore();
      if (store.configLoaded) {
        this.loadPersistedState();
      }
      if (store.configLoaded || store.dataLoaded) {
        reconcileGlobalFilterState();
      }
    },

    loadPersistedState() {
      try {
        const cfg = getConfigSnapshot();
        if (!cfg) return;
        const persisted = cfg.ui?.filterState?.views || {};

        const selected = sanitizeStringArray(persisted.selected)
          .filter((name) => !isAllViewName(name));
        const pinned = sanitizeStringArray(persisted.pinned)
          .filter((name) => !isAllViewName(name));

        const store = getStore();
        if (selected.length || Array.isArray(persisted.selected)) {
          store.selectedViews = selected;
        }
        if (pinned.length || Array.isArray(persisted.pinned)) {
          store.pinnedViews = pinned;
        }
      } catch (error) {
        console.error('Failed to load persisted view filter state:', error);
      }
    },

    async ensureViewsLoaded() {
      const store = Alpine.store('editor');
      if ((store.views || []).length > 0) return;

      try {
        const cfg = getConfigSnapshot();
        if (!cfg) return;
        const views = Array.isArray(cfg.views) ? cfg.views : [];
        if (!views.length) return;

        store.views = views;
        if (!store.currentView) {
          store.currentView = views.find((view) => !isAllViewName(view?.name)) || null;
        }
        if (!Array.isArray(store.selectedViews)) store.selectedViews = [];
        store.selectedViews = store.selectedViews.filter((name) => !isAllViewName(name));

        const appEl = document.querySelector('[x-data="app()"]');
        if (appEl?._x_dataStack?.[0]) {
          appEl._x_dataStack[0].views = views;
          if (!appEl._x_dataStack[0].currentView) {
            appEl._x_dataStack[0].currentView = store.currentView;
          }
        }
      } catch (error) {
        console.error('Failed to hydrate views for filter:', error);
      }
    },

    allViews() {
      const storeViews = getStore().views || [];
      if (storeViews.length > 0) return storeViews;

      const appEl = document.querySelector('[x-data="app()"]');
      const appViews = appEl?._x_dataStack?.[0]?.views || [];
      return appViews;
    },

    availableViewNames() {
      return getAvailableViewNames();
    },

    selectedViews() {
      return getStore().selectedViews || [];
    },

    pinnedViews() {
      return getStore().pinnedViews || [];
    },

    visibleViewButtons() {
      return orderedVisibleNames(this.selectedViews(), this.pinnedViews(), this.availableViewNames()).visible;
    },

    filteredOptions() {
      const term = this.searchTerm.trim().toLowerCase();
      const names = this.availableViewNames();
      if (!term) return names;
      return names.filter((name) => name.toLowerCase().includes(term));
    },

    orderedButtons() {
      const visible = this.visibleViewButtons();
      const pinned = visible.filter((name) => this.pinnedViews().includes(name));
      const others = visible.filter((name) => !this.pinnedViews().includes(name));
      return [...pinned, ...others]
        .map((name) => getViewByName(this.allViews(), name))
        .filter(Boolean);
    },

    addViewFromDropdown(name) {
      if (!name || !this.availableViewNames().includes(name)) return;

      const store = getStore();
      const selected = [...(store.selectedViews || [])];
      if (!selected.includes(name)) selected.push(name);
      store.selectedViews = selected;
      reconcileGlobalFilterState();
      void persistGlobalFilterState();

      this.searchTerm = '';
      this.isOpen = false;
    },

    onSearchEnter() {
      const exact = this.availableViewNames().find(
        (name) => name.toLowerCase() === this.searchTerm.trim().toLowerCase()
      );
      if (exact) this.addViewFromDropdown(exact);
    },

    toggleViewButton(name) {
      const store = getStore();
      const selected = [...(store.selectedViews || [])];
      const idx = selected.indexOf(name);

      if (idx >= 0) {
        selected.splice(idx, 1);
      } else {
        selected.push(name);
      }
      store.selectedViews = selected;
      reconcileGlobalFilterState();
      void persistGlobalFilterState();
    },

    isSelected(name) {
      return this.selectedViews().includes(name);
    },

    isPinned(name) {
      return this.pinnedViews().includes(name);
    },

    togglePin(name) {
      const store = getStore();
      const nextPinned = [...(store.pinnedViews || [])];
      const idx = nextPinned.indexOf(name);
      if (idx >= 0) {
        nextPinned.splice(idx, 1);
      } else {
        nextPinned.push(name);
      }
      store.pinnedViews = nextPinned;
      reconcileGlobalFilterState();
      void persistGlobalFilterState();
    }
  };
}

/**
 * Tier 3 Component Filter - searchable add + multi-select chips + meaningful pinning
 */
function componentTypeFilter() {
  return {
    isOpen: false,
    searchTerm: '',
    isHydrating: false,
    showComponentEditor: false,
    componentForm: {
      componentName: '',
      properties: [{ name: '', type: 'string', required: false }]
    },

    async init() {
      this.isHydrating = true;
      this.loadPersistedState();
      reconcileGlobalFilterState();
      this.isHydrating = false;

      this.$watch('$store.editor.instances', () => this.reconcileWithAvailable());
      this.$watch('$store.editor.columns', () => this.filterColumnsByComponents());
      this.$watch('$store.editor.selectedClasses', () => this.reconcileWithAvailable());
      this.$watch('$store.editor.currentView', () => this.reconcileWithAvailable());
      this.$watch('$store.editor.dataLoaded', (loaded) => {
        if (!loaded) return;
        if (getStore().configLoaded) {
          this.loadPersistedState();
        }
        this.reconcileWithAvailable();
      });
      this.$watch('$store.editor.configLoaded', (loaded) => {
        if (!loaded) return;
        this.loadPersistedState();
        this.reconcileWithAvailable();
      });

      const store = getStore();
      if (store.configLoaded) {
        this.loadPersistedState();
      }
      if (store.configLoaded || store.dataLoaded) {
        this.reconcileWithAvailable();
      }
    },

    loadPersistedState() {
      try {
        const cfg = getConfigSnapshot();
        if (!cfg) return;
        const persisted = cfg.ui?.filterState?.components || {};

        const selected = sanitizeStringArray(persisted.selected);
        const pinned = sanitizeStringArray(persisted.pinned);

        const store = getStore();
        if (selected.length || Array.isArray(persisted.selected)) {
          store.selectedComponents = selected;
        }
        if (pinned.length || Array.isArray(persisted.pinned)) {
          store.pinnedComponents = pinned;
        }
      } catch (error) {
        console.error('Failed to load persisted component filter state:', error);
      }
    },

    openCreateComponent() {
      this.componentForm = {
        componentName: '',
        properties: [{ name: '', type: 'string', required: false }]
      };
      this.showComponentEditor = true;
    },

    closeComponentEditor() {
      this.showComponentEditor = false;
    },

    propertyTypes() {
      return [
        'string', 'bool', 'int', 'float', 'date', 'ref', 'string[]', 'ref[]', 'object',
        'entity', 'color', 'vector2', 'vector3', 'enum'
      ];
    },

    addPropertyRow() {
      this.componentForm.properties.push({ name: '', type: 'string', required: false });
    },

    removePropertyRow(index) {
      if (this.componentForm.properties.length <= 1) return;
      this.componentForm.properties.splice(index, 1);
    },

    normalizedProperties() {
      return (this.componentForm.properties || [])
        .map((p) => ({
          name: String(p.name || '').trim(),
          type: String(p.type || 'string').trim() || 'string',
          required: Boolean(p.required)
        }))
        .filter((p) => p.name.length > 0);
    },

    async saveComponent() {
      const componentName = String(this.componentForm.componentName || '').trim();
      const properties = this.normalizedProperties();

      if (!componentName || properties.length < 1) return;

      try {
        const res = await fetch('/api/schema', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            changes: [{
              type: 'addComponent',
              componentName,
              properties
            }]
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to add component');
        }

        this.showComponentEditor = false;
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Component added: ${componentName}` }));
        window.dispatchEvent(new CustomEvent('gdedit:reload'));
      } catch (error) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `❌ ${error.message}` }));
      }
    },

    get availableComponents() {
      return getAvailableComponentNames();
    },

    get selectedComponents() {
      return getStore().selectedComponents || [];
    },

    get pinnedComponents() {
      return getStore().pinnedComponents || [];
    },

    get visibleComponentButtons() {
      return orderedVisibleNames(this.selectedComponents, this.pinnedComponents, this.availableComponents).visible;
    },

    get filteredOptions() {
      const term = this.searchTerm.trim().toLowerCase();
      if (!term) return this.availableComponents;
      return this.availableComponents.filter((comp) => comp.toLowerCase().includes(term));
    },

    get orderedButtons() {
      const pinned = this.visibleComponentButtons.filter((comp) => this.pinnedComponents.includes(comp));
      const others = this.visibleComponentButtons.filter((comp) => !this.pinnedComponents.includes(comp));
      return [...pinned, ...others];
    },

    reconcileWithAvailable() {
      const store = getStore();
      if (!store.dataLoaded) return;

      reconcileGlobalFilterState();
    },

    applySelectionToStore(selected, options = {}) {
      const { persist = true } = options;
      const store = getStore();
      store.selectedComponents = [...selected];
      reconcileGlobalFilterState();
      this.filterColumnsByComponents();
      if (persist) this.persistCurrentState();
    },

    filterColumnsByComponents() {
      applyComponentColumnVisibility();
    },

    persistCurrentState() {
      const store = Alpine.store('editor');
      if (this.isHydrating || !store.dataLoaded) return;

      void persistGlobalFilterState();
    },

    addComponentFromDropdown(comp) {
      if (!comp || !this.availableComponents.includes(comp)) return;

      if (!this.visibleComponentButtons.includes(comp)) {
        const store = getStore();
        store.selectedComponents = [...new Set([...(store.selectedComponents || []), comp])];
      } else {
        const store = getStore();
        store.selectedComponents = [...new Set([...(store.selectedComponents || []), comp])];
      }

      reconcileGlobalFilterState();
      void persistGlobalFilterState();

      this.searchTerm = '';
      this.isOpen = false;
    },

    onSearchEnter() {
      const exact = this.availableComponents.find(
        (comp) => comp.toLowerCase() === this.searchTerm.trim().toLowerCase()
      );
      if (exact) this.addComponentFromDropdown(exact);
    },

    toggleComponentButton(comp) {
      const selected = [...this.selectedComponents];
      const idx = selected.indexOf(comp);

      if (idx >= 0) {
        selected.splice(idx, 1);
      } else {
        selected.push(comp);
      }

      this.applySelectionToStore(selected, { persist: true });
    },

    isSelected(comp) {
      return this.selectedComponents.includes(comp);
    },

    isPinned(comp) {
      return this.pinnedComponents.includes(comp);
    },

    togglePin(comp) {
      const store = getStore();
      const nextPinned = [...(store.pinnedComponents || [])];
      const idx = nextPinned.indexOf(comp);
      if (idx >= 0) {
        nextPinned.splice(idx, 1);
      } else {
        nextPinned.push(comp);
      }
      store.pinnedComponents = nextPinned;
      reconcileGlobalFilterState();
      void persistGlobalFilterState();
    },

    get hasComponents() {
      return this.availableComponents.length > 0;
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
      const filtered = filterBySelectedClasses(store.instances, store);
      this.nestedPaths = getNestedDataPaths(filtered, null);
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
      instances = filterBySelectedClasses(instances, store);
      
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
 * Tier 2 Class Type Filter - searchable add + multi-select chips + meaningful pinning
 */
function classTypeFilter() {
  return {
    isOpen: false,
    searchTerm: '',
    isHydrating: false,
    showClassEditor: false,
    classForm: {
      className: '',
      components: []
    },

    async init() {
      this.isHydrating = true;
      this.loadPersistedState();
      reconcileGlobalFilterState();
      this.isHydrating = false;

      this.$watch('$store.editor.classes', () => this.reconcileWithAvailable());
      this.$watch('$store.editor.currentView', () => this.reconcileWithAvailable());
      this.$watch('$store.editor.selectedViews', () => this.reconcileWithAvailable());
      this.$watch('$store.editor.dataLoaded', (loaded) => {
        if (!loaded) return;
        if (getStore().configLoaded) {
          this.loadPersistedState();
        }
        this.reconcileWithAvailable();
      });
      this.$watch('$store.editor.configLoaded', (loaded) => {
        if (!loaded) return;
        this.loadPersistedState();
        this.reconcileWithAvailable();
      });

      const store = getStore();
      if (store.configLoaded) {
        this.loadPersistedState();
      }
      if (store.configLoaded || store.dataLoaded) {
        this.reconcileWithAvailable();
      }
    },

    loadPersistedState() {
      try {
        const cfg = getConfigSnapshot();
        if (!cfg) return;
        const persisted = cfg.ui?.filterState?.classes || {};

        const selected = sanitizeStringArray(persisted.selected);
        const pinned = sanitizeStringArray(persisted.pinned);

        const store = getStore();
        if (selected.length || Array.isArray(persisted.selected)) {
          store.selectedClasses = selected;
        }
        if (pinned.length || Array.isArray(persisted.pinned)) {
          store.pinnedClasses = pinned;
        }
      } catch (error) {
        console.error('Failed to load persisted class filter state:', error);
      }
    },

    openCreateClass() {
      this.classForm = {
        className: '',
        components: []
      };
      this.showClassEditor = true;
    },

    closeClassEditor() {
      this.showClassEditor = false;
    },

    availableComponentClasses() {
      const schema = getStore().schema || {};
      return Object.keys(schema.components || {}).sort();
    },

    toggleClassComponent(componentClass) {
      const selected = this.classForm.components || [];
      const idx = selected.indexOf(componentClass);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(componentClass);
    },

    isClassComponentSelected(componentClass) {
      return (this.classForm.components || []).includes(componentClass);
    },

    async saveClass() {
      const className = String(this.classForm.className || '').trim();
      const components = (this.classForm.components || []).map((componentClass) => ({
        componentClass,
        localName: componentClass.charAt(0).toLowerCase() + componentClass.slice(1).replace(/Component$/, '')
      }));

      if (!className || components.length < 1) return;

      try {
        const res = await fetch('/api/schema', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            changes: [{ type: 'addClass', className, components }]
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to add class');
        }

        this.showClassEditor = false;
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Class added: ${className}` }));
        window.dispatchEvent(new CustomEvent('gdedit:reload'));
      } catch (error) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `❌ ${error.message}` }));
      }
    },

    get availableClasses() {
      const store = Alpine.store('editor');
      return getSelectedViewClasses(store);
    },

    get selectedClasses() {
      return getStore().selectedClasses || [];
    },

    get pinnedClasses() {
      return getStore().pinnedClasses || [];
    },

    get visibleClassButtons() {
      return orderedVisibleNames(this.selectedClasses, this.pinnedClasses, this.availableClasses).visible;
    },

    get filteredOptions() {
      const term = this.searchTerm.trim().toLowerCase();
      if (!term) return this.availableClasses;
      return this.availableClasses.filter((cls) => cls.toLowerCase().includes(term));
    },

    get orderedButtons() {
      const pinned = this.visibleClassButtons.filter((cls) => this.pinnedClasses.includes(cls));
      const others = this.visibleClassButtons.filter((cls) => !this.pinnedClasses.includes(cls));
      return [...pinned, ...others];
    },

    reconcileWithAvailable() {
      const store = getStore();
      if (!store.dataLoaded) return;

      reconcileGlobalFilterState();
    },

    applySelectionToStore(selected, options = {}) {
      const { persist = true } = options;
      const store = getStore();
      store.selectedClasses = [...selected];
      store.currentPage = 1;

      reconcileGlobalFilterState();

      if (persist) this.persistCurrentState();
    },

    persistCurrentState() {
      const store = Alpine.store('editor');
      if (this.isHydrating || !store.dataLoaded) return;

      void persistGlobalFilterState();
    },

    addClassFromDropdown(cls) {
      if (!cls || !this.availableClasses.includes(cls)) return;

      const selected = [...this.selectedClasses];
      if (!selected.includes(cls)) selected.push(cls);
      this.applySelectionToStore(selected, { persist: true });

      this.searchTerm = '';
      this.isOpen = false;
    },

    onSearchEnter() {
      const exact = this.availableClasses.find(
        (cls) => cls.toLowerCase() === this.searchTerm.trim().toLowerCase()
      );
      if (exact) this.addClassFromDropdown(exact);
    },

    toggleClassButton(cls) {
      const selected = [...this.selectedClasses];
      const idx = selected.indexOf(cls);

      if (idx >= 0) {
        selected.splice(idx, 1);
      } else {
        selected.push(cls);
      }

      this.applySelectionToStore(selected);
    },

    isSelected(cls) {
      return this.selectedClasses.includes(cls);
    },

    isPinned(cls) {
      return this.pinnedClasses.includes(cls);
    },

    togglePin(cls) {
      const store = getStore();
      const nextPinned = [...(store.pinnedClasses || [])];
      const idx = nextPinned.indexOf(cls);
      if (idx >= 0) {
        nextPinned.splice(idx, 1);
      } else {
        nextPinned.push(cls);
      }
      store.pinnedClasses = nextPinned;
      reconcileGlobalFilterState();
      void persistGlobalFilterState();
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
      name: '', icon: 'layout-grid', color: '#3b82f6',
      classes: [], columnPresets: {},
      defaultSort: { column: '_id', direction: 'asc' },
      readOnly: false
    },
    availableIcons: ['layout-grid', 'gamepad-2', 'users', 'monitor', 'settings', 'package', 'palette', 'wrench', 'folder', 'star', 'briefcase', 'target'],
    isCreatingNew: false,
    
    openCreateView() {
      this.isCreatingNew = true;
      this.editingView = null;
      this.viewForm = {
        name: '', icon: 'layout-grid', color: '#3b82f6',
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
        name: view.name, icon: view.icon || 'layout-grid', color: view.color || '#3b82f6',
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
        await saveViewsWithRevision(views, 1);
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
        await saveViewsWithRevision(views, 1);
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
  viewFilter,
  classTypeFilter,
  componentTypeFilter,
  childTabs,
  tabPinning,
  viewEditor,
  reconcileGlobalFilterState,
  applyComponentColumnVisibility,
  getSelectedViewClasses,
  getViewByName,
  filterBySelectedClasses,
  getUniqueComponents,
  getNestedDataPaths
});
