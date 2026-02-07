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
  const { filterClass, filterRelation, searchTerm, visibleClasses } = options;
  
  // Filter instances
  let filtered = instances;
  
  // First filter by visible classes (from current view)
  if (visibleClasses && visibleClasses.length > 0) {
    filtered = filtered.filter(i => visibleClasses.includes(i._class));
  }
  
  // Then filter by selected class (Tier 2 tab)
  if (filterClass) {
    filtered = filtered.filter(i => i._class === filterClass);
  }
  
  // Then filter by search term
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(i => 
      i._id.toLowerCase().includes(term) ||
      i._class.toLowerCase().includes(term)
    );
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
      if (filterRelation && relName !== filterRelation) continue;
      
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
    
    // Graph-specific filters
    filterRelation: '',
    precedence: '',  // Precedence DSL string e.g. "Person > Team > Product"
    
    // Current graph data (reactive)
    currentNodes: [],
    currentEdges: [],
    
    // Available relations for filtering
    availableRelations: [],
    
    init() {
      this.updateAvailableOptions();
      this.rebuildGraphData();
      
      // Watch for data changes
      this.$watch('$store.editor.instances', () => {
        this.updateAvailableOptions();
        this.rebuildGraphData();
      });
      
      // Watch for store filter changes (Tier 2 class selection and toolbar search)
      this.$watch('$store.editor.selectedClass', () => this.rebuildGraphData());
      this.$watch('$store.editor.searchQuery', () => this.rebuildGraphData());
      this.$watch('$store.editor.currentView', () => this.rebuildGraphData());
      
      // Watch for graph-specific filter changes
      this.$watch('filterRelation', () => this.rebuildGraphData());
      this.$watch('precedence', () => this.rebuildGraphData());
      
      // Watch for view mode changes - re-render when becoming visible
      this.$watch('$store.editor.viewMode', (newMode) => {
        if (newMode === 'graph' && this.graphApi) {
          // Delay to allow DOM to become visible, then rebuild (which applies precedence)
          setTimeout(() => {
            this.graphApi.fromJSON({ 
              nodes: this.currentNodes, 
              edges: this.currentEdges
            });
            this.graphApi.setPrecedence(this.precedence || null);
          }, 50);
        }
      });
    },
    
    setGraphApi(api) {
      this.graphApi = api;
      // Load initial data if graph view is currently visible
      const store = Alpine.store('editor');
      if (store.viewMode === 'graph') {
        this.rebuildGraphData();
      }
    },
    
    rebuildGraphData() {
      const store = Alpine.store('editor');
      
      // Get visible classes from current view (if any)
      const visibleClasses = store.currentView?.classes?.length > 0 
        ? store.currentView.classes 
        : null;
      
      const { nodes, edges } = buildGraphData(store.instances, {
        filterClass: store.selectedClass,
        filterRelation: this.filterRelation,
        searchTerm: store.searchQuery,
        visibleClasses
      });
      
      this.currentNodes = nodes;
      this.currentEdges = edges;
      
      // Update alpine-flow if API is available and view is visible
      if (this.graphApi && store.viewMode === 'graph') {
        this.graphApi.fromJSON({ nodes, edges });
        // Apply precedence filter via API (handles clearing, applying, re-layout, re-render)
        this.graphApi.setPrecedence(this.precedence || null);
      }
    },
    
    updateAvailableOptions() {
      const store = Alpine.store('editor');
      
      const relations = new Set();
      for (const inst of store.instances) {
        if (inst.relations) {
          Object.keys(inst.relations).forEach(r => relations.add(r));
        }
      }
      this.availableRelations = [...relations].sort();
    },
    
    navigateToEntity(entityId) {
      // Find the entity and switch to table view
      const store = Alpine.store('editor');
      const entity = store.instances.find(i => i._id === entityId);
      
      if (entity) {
        // Set filters to show this entity
        store.selectedClass = entity._class;
        store.searchQuery = entityId;
        store.viewMode = 'table';
        
        window.dispatchEvent(new CustomEvent('gdedit:toast', { 
          detail: `Navigating to ${entityId}` 
        }));
      }
    },
    
    fitView() {
      if (this.graphApi) {
        this.graphApi.fitView({ padding: 0.15 });
      }
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
