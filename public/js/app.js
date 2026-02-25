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
    configSnapshot: null,
    configRevision: null,
    configLoaded: false,
    dataLoaded: false,
    selectedClass: null,
    selectedClasses: [],
    selectedRows: [],
    selectedEntityId: null,
    inspectorSelectedRows: [],
    inspectorSelectedEntityId: null,
    searchQuery: '',
    searchMode: 'search',
    autoScroll: true,
    autoSelect: true,
    highlightAlpha: 0.35,
    highlightRows: true,
    highlightCols: true,
    currentPage: 1,
    pageSize: 20,
    currentView: null,
    selectedViews: [],
    pinnedViews: [],
    views: [],
    showAddModal: false,
    showBulkAddModal: false,
    columnWidths: {},
    // Phase 3 additions
    selectedComponent: null,
    selectedComponents: [],
    pinnedComponents: [],
    pinnedClasses: [],
    sortColumn: null,
    sortDirection: 'asc',
    // Phase 5 additions
    viewMode: 'table' // 'table' | 'graph' | 'schema' | 'queue' | 'board'
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

const VALID_VIEW_MODES = new Set(['table', 'graph', 'schema', 'queue', 'board']);

function parseHashState(hash = window.location.hash) {
  const value = String(hash || '').trim();
  const match = value.match(/^#\/(table|graph|schema|queue|board)(?:\?(.*))?$/i);
  if (!match) {
    return { mode: null, params: new URLSearchParams() };
  }

  const mode = String(match[1] || '').toLowerCase();
  const params = new URLSearchParams(match[2] || '');
  return { mode, params };
}

function getViewModeFromHash(hash = window.location.hash) {
  return parseHashState(hash).mode;
}

function setHashFromViewMode(mode, { replace = true, selectedId = null } = {}) {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (!VALID_VIEW_MODES.has(normalizedMode)) return;

  const existing = parseHashState(window.location.hash);
  const params = new URLSearchParams(existing.params);
  const sel = selectedId === null ? String(params.get('sel') || '').trim() : String(selectedId || '').trim();

  if (sel) {
    params.set('sel', sel);
  } else {
    params.delete('sel');
  }

  const query = params.toString();
  const nextHash = query ? `#/${normalizedMode}?${query}` : `#/${normalizedMode}`;
  if (window.location.hash === nextHash) return;

  if (replace) {
    window.history.replaceState(null, '', nextHash);
  } else {
    window.location.hash = nextHash;
  }
}

function parseHistoryFromLocation(location = window.location) {
  const hashState = parseHashState(location.hash);
  const mode = hashState.mode || null;
  const selectedFromHash = String(hashState.params.get('sel') || '').trim();
  const searchParams = new URLSearchParams(location.search || '');
  const selectedFromSearch = String(searchParams.get('sel') || '').trim();
  const selectedId = selectedFromHash || selectedFromSearch || null;

  return { mode, selectedId };
}

function buildHistoryUrl(snapshot, currentHref = window.location.href) {
  const url = new URL(currentHref);
  const hashState = parseHashState(url.hash);
  const mode = String(snapshot?.mode || hashState.mode || '').trim().toLowerCase();
  const params = new URLSearchParams(hashState.params);

  if (snapshot?.selectedId) {
    params.set('sel', snapshot.selectedId);
  } else {
    params.delete('sel');
  }

  if (VALID_VIEW_MODES.has(mode)) {
    const hashQuery = params.toString();
    url.hash = hashQuery ? `#/${mode}?${hashQuery}` : `#/${mode}`;
  }

  // Keep selection in hash query; clean legacy search params.
  url.searchParams.delete('sel');
  url.searchParams.delete('page');

  return `${url.pathname}${url.search}${url.hash}`;
}

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
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'data-lucide' &&
        mutation.target instanceof Element &&
        mutation.target.matches('[data-lucide]:not(svg)')
      ) {
        scheduleLucideRender();
        return;
      }

      for (const node of mutation.addedNodes) {
        if (hasLucideNode(node)) {
          scheduleLucideRender();
          return;
        }
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-lucide']
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
    await appEl._x_dataStack[0].loadConfig();
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
    selectedClassesSignature: '',
    onHashChangeBound: null,
    onPopStateBound: null,
    isHydratingSidebarState: false,
    isApplyingHistoryState: false,
    suppressHashSync: false,
    lastHistorySignature: '',

    async init() {
      const store = Alpine.store('editor');
      const locationSnapshot = parseHistoryFromLocation();
      if (locationSnapshot.mode) {
        store.viewMode = locationSnapshot.mode;
      } else {
        setHashFromViewMode(store.viewMode, { replace: true });
      }

      if (locationSnapshot.selectedId) {
        store.selectedRows = [locationSnapshot.selectedId];
        store.selectedEntityId = locationSnapshot.selectedId;
      }

      this.onHashChangeBound = () => this.onHashChange();
      window.addEventListener('hashchange', this.onHashChangeBound);
      this.onPopStateBound = (event) => this.onPopState(event);
      window.addEventListener('popstate', this.onPopStateBound);

      this.$watch('$store.editor.viewMode', (mode) => {
        if (this.isApplyingHistoryState) return;
        const store = Alpine.store('editor');
        setHashFromViewMode(mode, {
          replace: true,
          selectedId: store.selectedEntityId || null
        });
      });

      this.$watch('$store.editor.selectedEntityId', () => {
        if (this.isApplyingHistoryState) return;
        this.recordHistoryState();
      });

      this.$watch('$store.layout.isNavOpen', () => {
        void this.persistSidebarState();
      });
      this.$watch('$store.layout.isInspectorOpen', () => {
        void this.persistSidebarState();
      });
      this.$watch('$store.chat.isOpen', () => {
        void this.persistSidebarState();
      });

      this.$watch('$store.editor.selectedClass', (nextClass) => {
        const normalized = nextClass || null;
        if (this.selectedClass === normalized) return;
        this.selectedClass = normalized;
        const store = Alpine.store('editor');
        const classSet = Array.isArray(store.selectedClasses) && store.selectedClasses.length > 0
          ? [...store.selectedClasses]
          : (normalized ? [normalized] : []);
        void this.loadColumnsForClasses(classSet);
      });

      this.$watch('$store.editor.selectedClasses', (classes) => {
        const normalized = Array.isArray(classes)
          ? [...new Set(classes.filter((name) => typeof name === 'string' && name.trim().length > 0))]
          : [];
        const signature = normalized.join('|');
        if (this.selectedClassesSignature === signature) return;
        this.selectedClassesSignature = signature;

        if (normalized.length > 0) {
          this.selectedClass = normalized[0];
          void this.loadColumnsForClasses(normalized);
          return;
        }

        const fallback = Alpine.store('editor').selectedClass;
        void this.loadColumnsForClasses(fallback ? [fallback] : []);
      });

      this.$watch('$store.editor.autoSelect', (enabled) => {
        if (enabled !== true) return;
        const store = Alpine.store('editor');
        store.inspectorSelectedRows = [...(store.selectedRows || [])];
        store.inspectorSelectedEntityId = store.selectedEntityId || store.inspectorSelectedRows[0] || null;
      });

      await this.loadConfig();
      await this.loadData();
      this.recordHistoryState({ replace: true });
      this.loading = false;
      this.connected = true;

      // Periodic connectivity check
      setInterval(async () => {
        try {
          const res = await fetch('/api/config');
          this.connected = res.ok;
        } catch {
          this.connected = false;
        }
      }, 5000); // Check every 5 seconds
    },

    onHashChange() {
      if (this.suppressHashSync) {
        this.suppressHashSync = false;
        return;
      }

      const modeFromHash = getViewModeFromHash();
      const hashState = parseHashState(window.location.hash);
      const selectedFromHash = String(hashState.params.get('sel') || '').trim() || null;

      const store = Alpine.store('editor');
      if (modeFromHash && store.viewMode !== modeFromHash) {
        store.viewMode = modeFromHash;
      }

      if (selectedFromHash !== null && selectedFromHash !== store.selectedEntityId) {
        store.selectedEntityId = selectedFromHash;
        store.selectedRows = [selectedFromHash];
        if (store.autoSelect === true) {
          store.inspectorSelectedRows = [...store.selectedRows];
          store.inspectorSelectedEntityId = selectedFromHash;
        }
      }
    },

    getHistorySnapshot() {
      const store = Alpine.store('editor');
      return {
        mode: store.viewMode,
        selectedId: store.selectedEntityId || null
      };
    },

    historySignature(snapshot) {
      const selectedId = String(snapshot?.selectedId || '');
      return selectedId;
    },

    applyHistorySnapshot(snapshot) {
      if (!snapshot) return;
      const store = Alpine.store('editor');

      const nextSelectedId = snapshot.selectedId || null;
      store.selectedEntityId = nextSelectedId;
      store.selectedRows = nextSelectedId ? [nextSelectedId] : [];
      if (store.autoSelect === true) {
        store.inspectorSelectedRows = [...store.selectedRows];
        store.inspectorSelectedEntityId = nextSelectedId;
      }
    },

    recordHistoryState({ replace = false } = {}) {
      const snapshot = this.getHistorySnapshot();
      const signature = this.historySignature(snapshot);
      if (!replace && signature === this.lastHistorySignature) return;

      const state = { __gdeditHistory: true, snapshot };
      const url = buildHistoryUrl(snapshot);
      if (replace) {
        window.history.replaceState(state, '', url);
      } else {
        window.history.pushState(state, '', url);
      }

      this.lastHistorySignature = signature;
    },

    onPopState(event) {
      const store = Alpine.store('editor');
      const currentMode = store.viewMode;
      const stateSnapshot = event?.state?.__gdeditHistory ? event.state.snapshot : null;
      const locationSnapshot = parseHistoryFromLocation();
      const snapshot = stateSnapshot || locationSnapshot;

      this.isApplyingHistoryState = true;
      try {
        this.applyHistorySnapshot(snapshot);
      } finally {
        this.isApplyingHistoryState = false;
      }

      // Selection history should not navigate between pages/modes.
      this.suppressHashSync = true;
      setHashFromViewMode(currentMode, {
        replace: true,
        selectedId: snapshot?.selectedId || null
      });

      this.lastHistorySignature = this.historySignature(this.getHistorySnapshot());
    },

    async loadConfig() {
      const store = Alpine.store('editor');
      store.configLoaded = false;
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        const filterState = config.ui?.filterState || {};
        const viewSelected = Array.isArray(filterState.views?.selected) ? filterState.views.selected : [];
        const viewPinned = Array.isArray(filterState.views?.pinned) ? filterState.views.pinned : [];
        const classSelected = Array.isArray(filterState.classes?.selected) ? filterState.classes.selected : [];
        const classPinned = Array.isArray(filterState.classes?.pinned) ? filterState.classes.pinned : [];
        const componentSelected = Array.isArray(filterState.components?.selected) ? filterState.components.selected : [];
        const componentPinned = Array.isArray(filterState.components?.pinned) ? filterState.components.pinned : [];
        const sidebarState = config.ui?.sidebarState || {};

        this.views = normalizeViewIcons(config.views || []);
        this.currentView = null;
        store.views = this.views;
        store.currentView = this.currentView;
        store.selectedViews = viewSelected;
        store.pinnedViews = viewPinned;
        store.selectedClasses = classSelected;
        store.pinnedClasses = classPinned;
        store.selectedComponents = componentSelected;
        store.pinnedComponents = componentPinned;
        store.pageSize = config.ui?.pageSize || 20;
        store.autoScroll = config.ui?.autoScroll !== false;
        store.autoSelect = config.ui?.autoSelect !== false;
        const alpha = Number(config.ui?.highlightAlpha);
        store.highlightAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0.35;
        store.highlightRows = config.ui?.highlightRows !== false;
        store.highlightCols = config.ui?.highlightCols !== false;
        if (store.autoSelect) {
          store.inspectorSelectedRows = [...(store.selectedRows || [])];
          store.inspectorSelectedEntityId = store.selectedEntityId || store.inspectorSelectedRows[0] || null;
        }

        const layoutStore = Alpine.store('layout');
        const chatStore = Alpine.store('chat');
        this.isHydratingSidebarState = true;
        if (layoutStore) {
          layoutStore.isNavOpen = sidebarState.navOpen !== false;
          layoutStore.isInspectorOpen = sidebarState.inspectorOpen !== false;
        }
        if (chatStore) {
          chatStore.isOpen = sidebarState.chatOpen !== false;
        }
        this.isHydratingSidebarState = false;

        store.configSnapshot = config;
        store.configRevision = Number.isInteger(Number(config?.revision)) ? Number(config.revision) : 0;
        store.configLoaded = true;
        scheduleLucideRender();
      } catch (e) {
        console.error('Failed to load config:', e);
        this.views = [];
        this.currentView = null;
        store.views = this.views;
        store.currentView = this.currentView;
        store.selectedViews = [];
        store.pinnedViews = [];
        store.selectedClasses = [];
        store.pinnedClasses = [];
        store.selectedComponents = [];
        store.pinnedComponents = [];
        store.autoScroll = true;
        store.autoSelect = true;
        store.highlightAlpha = 0.35;
        store.highlightRows = true;
        store.highlightCols = true;
        this.isHydratingSidebarState = false;
        store.configSnapshot = null;
        store.configRevision = null;
        store.configLoaded = true;
      }
    },

    async persistSidebarState(maxRetries = 1) {
      if (this.isHydratingSidebarState) return;

      const layoutStore = Alpine.store('layout');
      const chatStore = Alpine.store('chat');
      if (!layoutStore || !chatStore) return;

      let attempts = 0;
      while (attempts <= maxRetries) {
        attempts += 1;

        const store = Alpine.store('editor');
        if (!store.configLoaded || !Number.isInteger(store.configRevision)) {
          const cfgRes = await fetch('/api/config');
          const cfg = await cfgRes.json();
          store.configSnapshot = cfg;
          store.configRevision = Number.isInteger(Number(cfg?.revision)) ? Number(cfg.revision) : 0;
          store.configLoaded = true;
        }

        const payload = {
          revision: store.configRevision,
          ui: {
            sidebarState: {
              navOpen: layoutStore.isNavOpen !== false,
              inspectorOpen: layoutStore.isInspectorOpen !== false,
              chatOpen: chatStore.isOpen !== false
            }
          }
        };

        const res = await fetch('/api/config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const cfg = await res.json();
          store.configSnapshot = cfg;
          store.configRevision = Number.isInteger(Number(cfg?.revision)) ? Number(cfg.revision) : store.configRevision;
          store.configLoaded = true;
          return;
        }

        const details = await res.json().catch(() => ({}));
        const isRevisionMismatch = res.status === 409 && details?.code === 'REVISION_MISMATCH';
        if (!isRevisionMismatch) {
          console.error('Failed to persist sidebar state:', details?.error || 'Unknown error');
          return;
        }

        if (Number.isInteger(details?.expectedRevision)) {
          store.configRevision = details.expectedRevision;
        } else {
          const cfgRes = await fetch('/api/config');
          const cfg = await cfgRes.json();
          store.configSnapshot = cfg;
          store.configRevision = Number.isInteger(Number(cfg?.revision)) ? Number(cfg.revision) : 0;
          store.configLoaded = true;
        }
      }
    },

    async loadData() {
      try {
        Alpine.store('editor').dataLoaded = false;
        const [classesRes, instancesRes, schemaRes] = await Promise.all([
          fetch('/api/classes'),
          fetch('/api/instances'),
          fetch('/api/schema')
        ]);
        
        const classes = await classesRes.json();
        const instances = await instancesRes.json();
        const schema = await schemaRes.json();
        
        const store = Alpine.store('editor');
        // Apply fresh dataset atomically to avoid transient empty-state flicker
        // in graph/table views during reloads.
        store.classes = classes;
        store.schema = schema;
        store.instances = instances;
        store.dataLoaded = true;
        
        const activeClasses = Array.isArray(store.selectedClasses) && store.selectedClasses.length > 0
          ? [...store.selectedClasses]
          : (this.selectedClass ? [this.selectedClass] : []);
        await this.loadColumnsForClasses(activeClasses);
      } catch (e) {
        console.error('Failed to load data:', e);
        Alpine.store('editor').dataLoaded = true;
      }
    },

    async loadColumns(className) {
      const classSet = className ? [className] : [];
      await this.loadColumnsForClasses(classSet);
    },

    async loadColumnsForClasses(classNames) {
      const normalized = Array.isArray(classNames)
        ? [...new Set(classNames.filter((name) => typeof name === 'string' && name.trim().length > 0))]
        : [];

      if (!normalized.length) {
        Alpine.store('editor').columns = [];
        return;
      }

      try {
        const perClassColumns = await Promise.all(
          normalized.map(async (className) => {
            const res = await fetch(`/api/classes/${className}/columns`);
            if (!res.ok) return [];
            return await res.json();
          })
        );

        const mergedById = new Map();
        for (const columns of perClassColumns) {
          for (const col of (columns || [])) {
            if (!col?.id) continue;
            if (!mergedById.has(col.id)) mergedById.set(col.id, col);
          }
        }

        Alpine.store('editor').columns = [...mergedById.values()].map((c) => ({ ...c, visible: true }));

        if (typeof window.GDEditNav?.reconcileGlobalFilterState === 'function') {
          window.GDEditNav.reconcileGlobalFilterState();
        } else if (typeof window.GDEditNav?.applyComponentColumnVisibility === 'function') {
          window.GDEditNav.applyComponentColumnVisibility();
        }
      } catch (e) {
        console.error('Failed to load columns:', e);
      }
    },

    async reload() {
      this.loading = true;
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Reloading data...' }));
      await fetch('/api/reload', { method: 'POST' });
      await this.loadConfig();
      await this.loadData();
      // Force column reload to ensure table re-renders with fresh data
      if (this.selectedClass) {
        await this.loadColumns(this.selectedClass);
      }
      this.loading = false;
      this.lastSaved = Date.now();
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Data reloaded' }));
    },

    setView(view) {
      this.currentView = view;
      Alpine.store('editor').currentView = view;
      Alpine.store('editor').selectedViews = view ? [view.name] : [];
    },

    getLastSavedText() {
      if (!this.lastSaved) return '';
      const now = Date.now();
      const diffMs = now - this.lastSaved;
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) {
        return diffSec <= 1 ? 'Last saved: 1 sec ago' : `Last saved: ${diffSec} sec ago`;
      }
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) {
        return diffMin === 1 ? 'Last saved: 1 min ago' : `Last saved: ${diffMin} min ago`;
      }
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) {
        return diffHour === 1 ? 'Last saved: 1 hour ago' : `Last saved: ${diffHour} hours ago`;
      }
      const diffDay = Math.floor(diffHour / 24);
      return diffDay === 1 ? 'Last saved: 1 day ago' : `Last saved: ${diffDay} days ago`;
    },

    selectClass(cls) {
      this.selectedClass = cls;
      Alpine.store('editor').selectedClass = cls;
      Alpine.store('editor').selectedClasses = cls ? [cls] : [];
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
