/**
 * Graph View Component - Entity Relationship Visualization
 * Phase 5: Uses alpine-flow for interactive graph rendering
 */

/**
 * Color palette for different entity classes
 */
const CLASS_COLORS = {
  Person: { bg: '#3b82f6', border: '#1d4ed8', text: '#ffffff' },
  Team: { bg: '#10b981', border: '#047857', text: '#ffffff' },
  Product: { bg: '#f59e0b', border: '#d97706', text: '#000000' },
  Franchise: { bg: '#8b5cf6', border: '#6d28d9', text: '#ffffff' },
  System: { bg: '#ef4444', border: '#dc2626', text: '#ffffff' },
  default: { bg: '#6b7280', border: '#4b5563', text: '#ffffff' }
};

/**
 * Get color scheme for a class
 */
function getClassColor(className) {
  return CLASS_COLORS[className] || CLASS_COLORS.default;
}

/**
 * Build nodes and edges from instances
 */
function buildGraphData(instances, options = {}) {
  const { filterClass, filterClasses, searchTerm, searchMode, visibleClasses } = options;
  
  // Filter instances
  let filtered = instances;
  
  // First filter by visible classes (from current view)
  if (visibleClasses && visibleClasses.length > 0) {
    filtered = filtered.filter(i => visibleClasses.includes(i._class));
  }
  
  // Then filter by selected class set (Tier 2 multi-select)
  if (Array.isArray(filterClasses) && filterClasses.length > 0) {
    filtered = filtered.filter(i => filterClasses.includes(i._class));
  } else if (filterClass) {
    filtered = filtered.filter(i => i._class === filterClass);
  }
  
  // Then filter by search term (using same DSL filter as table view)
  if (searchTerm) {
    filtered = window.GDEdit?.applyGlobalFilter?.(filtered, searchTerm, searchMode) || filtered.filter(i => {
      const term = searchTerm.toLowerCase();
      return i._id.toLowerCase().includes(term) || i._class.toLowerCase().includes(term);
    });
  }
  
  // Create node lookup for quick access
  const nodeLookup = new Map(instances.map(i => [i._id, i]));
  
  // Build nodes (no position - let autolayout handle it)
  // Use class name as node type so precedence filtering works
  const nodes = filtered.map((inst) => {
    const colors = getClassColor(inst._class);
    
    return {
      id: inst._id,
      type: inst._class,  // Use class name as type for precedence filtering
      // No position - autolayout will position nodes based on edge topology
      data: {
        label: inst._id,
        className: inst._class,
        instance: inst,
        colors
      }
    };
  });
  
  // Build edges from relations
  const edges = [];
  const nodeIds = new Set(nodes.map(n => n.id));
  
  for (const inst of filtered) {
    if (!inst.relations) continue;
    
    for (const [relName, targets] of Object.entries(inst.relations)) {
      const targetList = Array.isArray(targets) ? targets : [targets];
      
      for (const target of targetList) {
        const targetId = typeof target === 'object' ? target._to : target;
        
        // Only add edge if target node exists in filtered set
        if (nodeIds.has(targetId)) {
          edges.push({
            id: `${inst._id}-${relName}-${targetId}`,
            source: inst._id,
            target: targetId,
            label: relName,
            data: { relName, qualifier: typeof target === 'object' ? target : null }
          });
        }
      }
    }
  }
  
  return { nodes, edges };
}

/**
 * Custom node renderer for entity nodes
 */
function entityNodeRenderer(node) {
  const { label, className, colors } = node.data;
  return `
    <div class="alpine-flow__node-content entity-node" 
         style="background: ${colors.bg}; border: 2px solid ${colors.border}; color: ${colors.text}; padding: 8px 12px; min-width: 100px; border-radius: 6px; cursor: pointer;">
      <div style="font-size: 10px; opacity: 0.8; margin-bottom: 2px;">${className}</div>
      <div style="font-weight: 500; font-size: 13px;">${label}</div>
      <div class="alpine-flow__handle alpine-flow__handle-target" data-handletype="target" data-handleposition="top"></div>
      <div class="alpine-flow__handle alpine-flow__handle-source" data-handletype="source" data-handleposition="bottom"></div>
    </div>
  `;
}

/**
 * Graph View Alpine Component
 */
function graphView() {
  return {
    graphApi: null,
    forceEnabled: false,
    layoutEnabled: true,
    fitEnabled: false,
    autoFitFrameId: null,
    graphStatePersistTimer: null,
    hasAppliedInitialLayout: false,
    fitPadding: 0.5,
    isHydratingGraphState: false,
    
    // Graph-specific filters
    
    
    // Current graph data (reactive)
    currentNodes: [],
    currentEdges: [],
    nodePositionCache: {},
    
    // Available relations for future graph metadata
    availableRelations: [],
    
    init() {
      this.loadPersistedGraphState();
      this.rebuildGraphData();
      
      // Watch for data changes
      this.$watch('$store.editor.instances', () => {
        this.rebuildGraphData();
      });
      
      // Watch for store filter changes (Tier 2 class selection and toolbar search)
      this.$watch('$store.editor.selectedClass', () => this.rebuildGraphData());
      this.$watch('$store.editor.selectedViews', () => this.rebuildGraphData());
      this.$watch('$store.editor.selectedClasses', () => this.rebuildGraphData());
      this.$watch('$store.editor.selectedComponents', () => this.rebuildGraphData());
      this.$watch('$store.editor.searchQuery', () => this.rebuildGraphData());
      this.$watch('$store.editor.searchMode', () => this.rebuildGraphData());
      this.$watch('$store.editor.currentView', () => this.rebuildGraphData());

      this.$watch('fitPadding', () => {
        if (!this.isHydratingGraphState) {
          this.queuePersistGraphState();
        }
      });

      this.$watch('$store.editor.configLoaded', (loaded) => {
        if (!loaded) return;
        this.loadPersistedGraphState();
        this.applyGraphRuntimeState();
      });
      
      // Watch for view mode changes - re-render when becoming visible
      this.$watch('$store.editor.viewMode', (newMode) => {
        if (newMode === 'graph' && this.graphApi) {
          // Delay to allow DOM to become visible, then rebuild using preserved positions/viewport.
          setTimeout(() => {
            this.rebuildGraphData();
            if (this.fitEnabled) this.startAutoFit();
          }, 50);
        } else {
          this.stopAutoFit();
        }
      });
    },
    
    setGraphApi(api) {
      this.graphApi = api;
      this.hasAppliedInitialLayout = false;
      if (typeof this.graphApi.getAutoLayoutEnabled === 'function') {
        this.layoutEnabled = this.graphApi.getAutoLayoutEnabled() === true;
      }
      // Load initial data if graph view is currently visible
      const store = Alpine.store('editor');
      if (store.viewMode === 'graph') {
        this.rebuildGraphData();
      }
      this.applyGraphRuntimeState();
    },

    loadPersistedGraphState() {
      const store = Alpine.store('editor');
      const graphState = store.configSnapshot?.ui?.graphState;
      if (!graphState || typeof graphState !== 'object') return;

      this.isHydratingGraphState = true;
      this.fitEnabled = graphState.fitEnabled === true;
      this.forceEnabled = graphState.forceEnabled === true;
      this.layoutEnabled = graphState.layoutEnabled !== false;
      if (Number.isFinite(Number(graphState.fitPadding))) {
        this.fitPadding = Number(graphState.fitPadding);
      }
      if (this.layoutEnabled && this.forceEnabled) {
        this.forceEnabled = false;
      }
      this.isHydratingGraphState = false;
    },

    queuePersistGraphState(delayMs = 200) {
      if (this.graphStatePersistTimer) {
        clearTimeout(this.graphStatePersistTimer);
      }

      this.graphStatePersistTimer = setTimeout(() => {
        this.graphStatePersistTimer = null;
        void this.persistGraphState();
      }, delayMs);
    },

    async persistGraphState(maxRetries = 3) {
      if (this.isHydratingGraphState) return;

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
            graphState: {
              fitEnabled: this.fitEnabled === true,
              forceEnabled: this.forceEnabled === true,
              layoutEnabled: this.layoutEnabled !== false,
              fitPadding: Number.isFinite(Number(this.fitPadding)) ? Number(this.fitPadding) : 0.5
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
          console.error('Failed to persist graph state:', details?.error || 'Unknown error');
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

      console.warn('Skipped persisting graph state after revision retries');
    },

    applyGraphRuntimeState() {
      if (!this.graphApi) return;

      if (this.layoutEnabled && this.forceEnabled) {
        this.forceEnabled = false;
      }

      if (typeof this.graphApi.getAutoLayoutEnabled === 'function' && typeof this.graphApi.setAutoLayoutEnabled === 'function') {
        const runtimeLayoutEnabled = this.graphApi.getAutoLayoutEnabled() === true;
        const desiredLayoutEnabled = this.layoutEnabled === true;
        if (runtimeLayoutEnabled !== desiredLayoutEnabled) {
          this.layoutEnabled = this.graphApi.setAutoLayoutEnabled(desiredLayoutEnabled) === true;
        } else {
          this.layoutEnabled = runtimeLayoutEnabled;
        }
      }

      this.graphApi.setForceOptions({ enabled: this.forceEnabled });

      const store = Alpine.store('editor');
      if (this.fitEnabled && store.viewMode === 'graph') {
        this.fitView();
        this.startAutoFit();
      } else {
        this.stopAutoFit();
      }
    },

    hasValidPosition(pos) {
      return pos && Number.isFinite(pos.x) && Number.isFinite(pos.y);
    },

    rememberNodePosition(payload) {
      if (!payload || typeof payload.id !== 'string') return;
      const position = payload.position;
      if (!this.hasValidPosition(position)) return;
      this.nodePositionCache[payload.id] = { x: position.x, y: position.y };
    },

    captureNodePositionsFromGraphApi() {
      if (!this.graphApi || typeof this.graphApi.getNodes !== 'function') return;
      const nodes = this.graphApi.getNodes() || [];
      for (const node of nodes) {
        if (!node || typeof node.id !== 'string') continue;
        if (!this.hasValidPosition(node.position)) continue;
        this.nodePositionCache[node.id] = { x: node.position.x, y: node.position.y };
      }
    },
    
    rebuildGraphData() {
      const store = Alpine.store('editor');
      this.captureNodePositionsFromGraphApi();
      
      // Get visible classes from current view (if any)
      const selectedViewClasses = window.GDEditNav?.getSelectedViewClasses?.(store) || store.classes || [];
      const visibleClasses = selectedViewClasses.length > 0 ? selectedViewClasses : null;
      
      const { nodes, edges } = buildGraphData(store.instances, {
        filterClass: store.selectedClass,
        filterClasses: store.selectedClasses,
        searchTerm: store.searchQuery,
        searchMode: store.searchMode || 'search',
        visibleClasses
      });

      const previousNodes = this.graphApi ? this.graphApi.getNodes() : this.currentNodes;
      const previousPositionById = new Map(
        Object.entries(this.nodePositionCache).map(([id, position]) => [id, position])
      );
      for (const node of (previousNodes || [])) {
        previousPositionById.set(node.id, node.position);
      }

      const positionedNodes = nodes.map((node) => {
        const previousPosition = previousPositionById.get(node.id);
        if (this.hasValidPosition(previousPosition)) {
          const stablePosition = { x: previousPosition.x, y: previousPosition.y };
          this.nodePositionCache[node.id] = stablePosition;
          return {
            ...node,
            position: stablePosition
          };
        }

        return node;
      });
      
      this.currentNodes = positionedNodes;
      this.currentEdges = edges;
      
      // Update alpine-flow if API is available and view is visible
      if (this.graphApi && store.viewMode === 'graph') {
        const viewport = this.graphApi.getViewport?.();
        const payload = {
          nodes: positionedNodes,
          edges,
          ...(this.fitEnabled ? {} : { viewport })
        };

        this.graphApi.fromJSON(payload);

        if (this.layoutEnabled && positionedNodes.length > 0 && typeof this.graphApi.layoutNodes === 'function') {
          // Re-apply layout when nodes change if layout is enabled
          this.graphApi.layoutNodes({ force: true, direction: 'LR' });
        }

        if (this.fitEnabled) this.fitView();
      }
    },
    
    navigateToEntity(entityId) {
      // Find the entity and switch to table view
      const store = Alpine.store('editor');
      const entity = store.instances.find(i => i._id === entityId);
      
      if (entity) {
        // Set filters to show this entity
        store.selectedClass = entity._class;
        store.selectedClasses = [entity._class];
        store.searchQuery = entityId;
        store.viewMode = 'table';
        
        window.dispatchEvent(new CustomEvent('gdedit:toast', { 
          detail: `Navigating to ${entityId}` 
        }));
      }
    },

    applyGlobalSelection(selectedIds) {
      const store = Alpine.store('editor');
      const validIds = (selectedIds || []).filter((id) =>
        store.instances.some((instance) => instance._id === id)
      );

      store.selectedRows = [...validIds];
      store.selectedEntityId = validIds[0] || null;
    },

    syncSelectionFromGraph(fallbackEntityId = null) {
      if (this.graphApi && typeof this.graphApi.getSelectedNodes === 'function') {
        const selectedIds = (this.graphApi.getSelectedNodes() || [])
          .map((node) => node?.id)
          .filter((id) => typeof id === 'string' && id.length > 0);
        this.applyGlobalSelection(selectedIds);
        return;
      }

      if (fallbackEntityId) {
        this.applyGlobalSelection([fallbackEntityId]);
        return;
      }

      this.applyGlobalSelection([]);
    },

    selectEntity(entityId) {
      // Backward-compatible handler for legacy single-id dispatch paths.
      this.syncSelectionFromGraph(entityId || null);
    },
    
    fitView() {
      if (this.graphApi) {
        this.graphApi.fitView({ padding: this.fitPadding });
      }
    },

    startAutoFit() {
      if (this.autoFitFrameId) return;

      const tick = () => {
        const store = Alpine.store('editor');
        if (!this.fitEnabled || !this.graphApi || store.viewMode !== 'graph') {
          this.autoFitFrameId = null;
          return;
        }

        this.fitView();
        this.autoFitFrameId = requestAnimationFrame(tick);
      };

      this.autoFitFrameId = requestAnimationFrame(tick);
    },

    stopAutoFit() {
      if (!this.autoFitFrameId) return;
      cancelAnimationFrame(this.autoFitFrameId);
      this.autoFitFrameId = null;
    },

    toggleFit() {
      this.fitEnabled = !this.fitEnabled;
      if (this.fitEnabled) {
        this.fitView();
        this.startAutoFit();
      } else {
        this.stopAutoFit();
      }

      this.queuePersistGraphState(0);
    },

    toggleForce() {
      if (!this.graphApi) return;
      const nextEnabled = !this.forceEnabled;

      if (nextEnabled && this.layoutEnabled && typeof this.graphApi.setAutoLayoutEnabled === 'function') {
        this.layoutEnabled = this.graphApi.setAutoLayoutEnabled(false) === true;
      }

      this.graphApi.setForceOptions({ enabled: nextEnabled });
      this.forceEnabled = nextEnabled;

      this.queuePersistGraphState(0);
    },

    toggleLayout() {
      if (!this.graphApi || typeof this.graphApi.setAutoLayoutEnabled !== 'function') return;
      const nextEnabled = !this.layoutEnabled;

      if (nextEnabled && this.forceEnabled) {
        this.graphApi.setForceOptions({ enabled: false });
        this.forceEnabled = false;
      }

      this.layoutEnabled = this.graphApi.setAutoLayoutEnabled(nextEnabled) === true;
      if (this.fitEnabled) this.fitView();

      this.queuePersistGraphState(0);
    },
    
    exportGraph() {
      const data = { 
        nodes: this.currentNodes, 
        edges: this.currentEdges 
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'entity-graph.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  };
}

// Export for global access
window.GDEditGraph = {
  graphView,
  buildGraphData,
  getClassColor,
  entityNodeRenderer,
  CLASS_COLORS
};
