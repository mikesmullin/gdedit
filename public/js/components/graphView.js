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
  const { filterClass, filterRelation, searchTerm } = options;
  
  // Filter instances
  let filtered = instances;
  if (filterClass) {
    filtered = filtered.filter(i => i._class === filterClass);
  }
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(i => 
      i._id.toLowerCase().includes(term) ||
      i._class.toLowerCase().includes(term)
    );
  }
  
  // Create node lookup for quick access
  const nodeLookup = new Map(instances.map(i => [i._id, i]));
  
  // Build nodes with positions (grid layout initially)
  const cols = Math.ceil(Math.sqrt(filtered.length));
  const nodes = filtered.map((inst, idx) => {
    const colors = getClassColor(inst._class);
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    
    return {
      id: inst._id,
      type: 'entity',
      position: { x: col * 220 + 50, y: row * 120 + 50 },
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
    isInitialized: false,
    graphContainer: null,
    graphApi: null,
    
    // Filters
    filterClass: '',
    filterRelation: '',
    searchTerm: '',
    
    // Available options
    availableClasses: [],
    availableRelations: [],
    
    // Layout options
    layoutType: 'grid',
    
    init() {
      this.updateAvailableOptions();
      
      // Watch for data changes
      this.$watch('$store.editor.instances', () => {
        this.updateAvailableOptions();
        if (this.isInitialized) {
          this.refreshGraph();
        }
      });
    },
    
    updateAvailableOptions() {
      const store = Alpine.store('editor');
      this.availableClasses = [...new Set(store.instances.map(i => i._class))].sort();
      
      const relations = new Set();
      for (const inst of store.instances) {
        if (inst.relations) {
          Object.keys(inst.relations).forEach(r => relations.add(r));
        }
      }
      this.availableRelations = [...relations].sort();
    },
    
    async initGraph() {
      if (this.isInitialized) return;
      
      // Wait for container to be ready
      await this.$nextTick();
      
      const container = this.$refs.graphContainer;
      if (!container) return;
      
      const store = Alpine.store('editor');
      const { nodes, edges } = buildGraphData(store.instances, {
        filterClass: this.filterClass,
        filterRelation: this.filterRelation,
        searchTerm: this.searchTerm
      });
      
      // Initialize alpine-flow
      const config = {
        nodes,
        edges,
        options: {
          fitView: true,
          fitViewPadding: 0.15,
          showBackground: true,
          background: { variant: 'dots', gap: 20 },
          showControls: true,
          showMinimap: true,
          nodesDraggable: true,
          snapToGrid: true,
          snapGrid: [20, 20]
        },
        nodeTypes: {
          entity: entityNodeRenderer
        },
        onNodeClick: (event, node) => {
          this.handleNodeClick(node);
        },
        onNodeDoubleClick: (event, node) => {
          this.navigateToEntity(node.id);
        },
        onEdgeClick: (event, edge) => {
          this.handleEdgeClick(edge);
        },
        onInit: (api) => {
          this.graphApi = api;
        }
      };
      
      // Set config on container for Alpine to pick up
      container._alpineFlowConfig = config;
      this.isInitialized = true;
    },
    
    refreshGraph() {
      if (!this.graphApi) return;
      
      const store = Alpine.store('editor');
      const { nodes, edges } = buildGraphData(store.instances, {
        filterClass: this.filterClass,
        filterRelation: this.filterRelation,
        searchTerm: this.searchTerm
      });
      
      this.graphApi.fromJSON({ nodes, edges, viewport: this.graphApi.getViewport() });
    },
    
    handleNodeClick(node) {
      // Highlight node and show info
      window.dispatchEvent(new CustomEvent('gdedit:toast', {
        detail: `Selected: ${node.id} (${node.data.className})`
      }));
    },
    
    handleEdgeClick(edge) {
      window.dispatchEvent(new CustomEvent('gdedit:toast', {
        detail: `Relation: ${edge.data.relName}`
      }));
    },
    
    navigateToEntity(entityId) {
      // Find the entity and switch to table view
      const store = Alpine.store('editor');
      const entity = store.instances.find(i => i._id === entityId);
      
      if (entity) {
        // Set filters to show this entity
        store.selectedClass = entity._class;
        store.searchQuery = entityId;
        
        // Emit event to switch view
        window.dispatchEvent(new CustomEvent('gdedit:switchView', { detail: 'table' }));
        window.dispatchEvent(new CustomEvent('gdedit:toast', { 
          detail: `Navigating to ${entityId}` 
        }));
      }
    },
    
    applyFilter() {
      this.refreshGraph();
    },
    
    clearFilters() {
      this.filterClass = '';
      this.filterRelation = '';
      this.searchTerm = '';
      this.refreshGraph();
    },
    
    fitView() {
      if (this.graphApi) {
        this.graphApi.fitView({ padding: 0.15 });
      }
    },
    
    exportGraph() {
      if (!this.graphApi) return;
      
      const data = this.graphApi.toJSON();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'entity-graph.json';
      a.click();
      URL.revokeObjectURL(url);
    },
    
    get nodeCount() {
      return this.graphApi ? this.graphApi.getNodes().length : 0;
    },
    
    get edgeCount() {
      return this.graphApi ? this.graphApi.getEdges().length : 0;
    }
  };
}

/**
 * Graph View Wrapper - Manages the alpine-flow integration
 */
function graphViewWrapper() {
  return {
    nodes: [],
    edges: [],
    isReady: false,
    
    init() {
      // Listen for graph initialization
      this.$watch('$store.editor.instances', () => this.buildGraph());
      this.buildGraph();
    },
    
    buildGraph() {
      const store = Alpine.store('editor');
      const data = buildGraphData(store.instances, {});
      this.nodes = data.nodes;
      this.edges = data.edges;
      this.isReady = true;
    },
    
    getGraphConfig() {
      return {
        nodes: this.nodes,
        edges: this.edges,
        options: {
          fitView: true,
          fitViewPadding: 0.15,
          showBackground: true,
          background: { variant: 'dots', gap: 20 },
          showControls: true,
          showMinimap: true
        },
        nodeTypes: { entity: entityNodeRenderer }
      };
    }
  };
}

// Export for global access
window.GDEditGraph = {
  graphView,
  graphViewWrapper,
  buildGraphData,
  getClassColor,
  entityNodeRenderer,
  CLASS_COLORS
};
