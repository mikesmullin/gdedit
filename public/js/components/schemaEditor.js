/**
 * Schema Editor Component - MySQL-style table definition view
 * Phase 5: View and modify component properties and constraints
 */

/**
 * Property type options
 */
const PROPERTY_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'bool', label: 'Boolean' },
  { value: 'int', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'date', label: 'Date' },
  { value: 'string[]', label: 'String Array' },
  { value: 'object', label: 'Object' },
  { value: 'entity', label: 'Entity Reference' },
  { value: 'color', label: 'Color' },
  { value: 'vector2', label: 'Vector2' },
  { value: 'vector3', label: 'Vector3' },
  { value: 'enum', label: 'Enum' }
];

/**
 * Cardinality options for relations
 */
const CARDINALITY_OPTIONS = [
  { value: 'oto', label: 'One-to-One (1:1)' },
  { value: 'otm', label: 'One-to-Many (1:N)' },
  { value: 'mto', label: 'Many-to-One (N:1)' },
  { value: 'mtm', label: 'Many-to-Many (N:N)' }
];

/**
 * Schema Editor Alpine Component
 */
function schemaEditor() {
  return {
    // View state
    selectedClass: null,
    selectedComponent: null,
    showAddPropertyModal: false,
    showAddRelationModal: false,
    showPreviewModal: false,
    
    // Edit state
    pendingChanges: [],
    newProperty: { name: '', type: 'string', required: false },
    newRelation: { name: '', domain: '', range: '', cardinality: 'mtm' },
    
    // Schema data
    schema: null,
    classes: [],
    components: [],
    relations: [],
    
    init() {
      this.loadSchema();
      this.$watch('$store.editor.schema', () => this.loadSchema());
    },
    
    loadSchema() {
      const store = Alpine.store('editor');
      this.schema = store.schema || {};
      
      // Extract classes
      this.classes = Object.entries(this.schema.classes || {}).map(([name, def]) => ({
        name,
        components: def.components || {}
      }));
      
      // Extract components
      this.components = Object.entries(this.schema.components || {}).map(([name, def]) => ({
        name,
        properties: Object.entries(def.properties || {}).map(([propName, propDef]) => ({
          name: propName,
          type: propDef.type || 'string',
          required: propDef.required || false
        }))
      }));
      
      // Extract relations
      this.relations = Object.entries(this.schema.relations || {}).map(([name, def]) => ({
        name,
        domain: def.domain,
        range: def.range,
        cardinality: def.cardinality,
        qualifiers: def.qualifiers || {}
      }));
      
      // Select first class by default
      if (this.classes.length > 0 && !this.selectedClass) {
        this.selectedClass = this.classes[0].name;
      }
    },
    
    selectClass(className) {
      this.selectedClass = className;
      this.selectedComponent = null;
    },
    
    selectComponent(componentName) {
      this.selectedComponent = componentName;
    },
    
    // Get class definition
    getClassDef() {
      return this.classes.find(c => c.name === this.selectedClass);
    },
    
    // Get components for selected class
    getClassComponents() {
      const cls = this.getClassDef();
      if (!cls) return [];
      
      return Object.entries(cls.components).map(([localName, componentClass]) => {
        const compDef = this.components.find(c => c.name === componentClass);
        return {
          localName,
          componentClass,
          properties: compDef?.properties || []
        };
      });
    },
    
    // Get component definition
    getComponentDef(componentName) {
      return this.components.find(c => c.name === componentName);
    },
    
    // Get relations for selected class
    getClassRelations() {
      if (!this.selectedClass) return [];
      return this.relations.filter(r => r.domain === this.selectedClass);
    },
    
    // Add property
    openAddProperty(componentName) {
      this.selectedComponent = componentName;
      this.newProperty = { name: '', type: 'string', required: false };
      this.showAddPropertyModal = true;
    },
    
    async addProperty() {
      if (!this.newProperty.name || !this.selectedComponent) return;
      
      const change = {
        type: 'addProperty',
        component: this.selectedComponent,
        property: { ...this.newProperty }
      };
      
      this.pendingChanges.push(change);
      
      // Update local state
      const comp = this.components.find(c => c.name === this.selectedComponent);
      if (comp) {
        comp.properties.push({ ...this.newProperty });
      }
      
      this.showAddPropertyModal = false;
      this.newProperty = { name: '', type: 'string', required: false };
      
      window.dispatchEvent(new CustomEvent('gdedit:toast', {
        detail: `Added property: ${change.property.name}`
      }));
    },
    
    // Remove property
    async removeProperty(componentName, propertyName) {
      if (!confirm(`Remove property "${propertyName}" from ${componentName}?`)) return;
      
      const change = {
        type: 'removeProperty',
        component: componentName,
        property: propertyName
      };
      
      this.pendingChanges.push(change);
      
      // Update local state
      const comp = this.components.find(c => c.name === componentName);
      if (comp) {
        comp.properties = comp.properties.filter(p => p.name !== propertyName);
      }
      
      window.dispatchEvent(new CustomEvent('gdedit:toast', {
        detail: `Removed property: ${propertyName}`
      }));
    },
    
    // Toggle property required
    toggleRequired(componentName, propertyName) {
      const comp = this.components.find(c => c.name === componentName);
      if (!comp) return;
      
      const prop = comp.properties.find(p => p.name === propertyName);
      if (prop) {
        prop.required = !prop.required;
        this.pendingChanges.push({
          type: 'updateProperty',
          component: componentName,
          property: propertyName,
          changes: { required: prop.required }
        });
      }
    },
    
    // Change property type
    changePropertyType(componentName, propertyName, newType) {
      const comp = this.components.find(c => c.name === componentName);
      if (!comp) return;
      
      const prop = comp.properties.find(p => p.name === propertyName);
      if (prop) {
        prop.type = newType;
        this.pendingChanges.push({
          type: 'updateProperty',
          component: componentName,
          property: propertyName,
          changes: { type: newType }
        });
      }
    },
    
    // Add relation
    openAddRelation() {
      this.newRelation = { 
        name: '', 
        domain: this.selectedClass || '', 
        range: '', 
        cardinality: 'mtm' 
      };
      this.showAddRelationModal = true;
    },
    
    async addRelation() {
      if (!this.newRelation.name || !this.newRelation.domain || !this.newRelation.range) return;
      
      const change = {
        type: 'addRelation',
        relation: { ...this.newRelation }
      };
      
      this.pendingChanges.push(change);
      this.relations.push({ ...this.newRelation, qualifiers: {} });
      
      this.showAddRelationModal = false;
      this.newRelation = { name: '', domain: '', range: '', cardinality: 'mtm' };
      
      window.dispatchEvent(new CustomEvent('gdedit:toast', {
        detail: `Added relation: ${change.relation.name}`
      }));
    },
    
    // Remove relation
    async removeRelation(relationName) {
      if (!confirm(`Remove relation "${relationName}"?`)) return;
      
      this.pendingChanges.push({
        type: 'removeRelation',
        relation: relationName
      });
      
      this.relations = this.relations.filter(r => r.name !== relationName);
      
      window.dispatchEvent(new CustomEvent('gdedit:toast', {
        detail: `Removed relation: ${relationName}`
      }));
    },
    
    // Preview changes
    previewChanges() {
      this.showPreviewModal = true;
    },
    
    // Apply changes
    async applyChanges() {
      if (this.pendingChanges.length === 0) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', {
          detail: 'No changes to apply'
        }));
        return;
      }
      
      try {
        const res = await fetch('/api/schema', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes: this.pendingChanges })
        });
        
        if (!res.ok) {
          throw new Error('Failed to apply schema changes');
        }
        
        this.pendingChanges = [];
        this.showPreviewModal = false;
        
        // Reload schema
        await this.reloadSchema();
        
        window.dispatchEvent(new CustomEvent('gdedit:toast', {
          detail: '✓ Schema changes applied'
        }));
      } catch (e) {
        console.error('Schema update error:', e);
        window.dispatchEvent(new CustomEvent('gdedit:toast', {
          detail: '❌ Failed to apply changes: ' + e.message
        }));
      }
    },
    
    async reloadSchema() {
      try {
        const res = await fetch('/api/schema');
        const schema = await res.json();
        Alpine.store('editor').schema = schema;
        this.loadSchema();
      } catch (e) {
        console.error('Failed to reload schema:', e);
      }
    },
    
    // Discard changes
    discardChanges() {
      this.pendingChanges = [];
      this.loadSchema(); // Reset to original
      this.showPreviewModal = false;
      
      window.dispatchEvent(new CustomEvent('gdedit:toast', {
        detail: 'Changes discarded'
      }));
    },
    
    // Format change for display
    formatChange(change) {
      switch (change.type) {
        case 'addProperty':
          return `+ Add property "${change.property.name}" (${change.property.type}) to ${change.component}`;
        case 'removeProperty':
          return `- Remove property "${change.property}" from ${change.component}`;
        case 'updateProperty':
          return `~ Update property "${change.property}" in ${change.component}`;
        case 'addRelation':
          return `+ Add relation "${change.relation.name}" (${change.relation.domain} → ${change.relation.range})`;
        case 'removeRelation':
          return `- Remove relation "${change.relation}"`;
        default:
          return JSON.stringify(change);
      }
    },
    
    get hasChanges() {
      return this.pendingChanges.length > 0;
    },
    
    get propertyTypes() {
      return PROPERTY_TYPES;
    },
    
    get cardinalityOptions() {
      return CARDINALITY_OPTIONS;
    }
  };
}

/**
 * Format cardinality for display
 */
function formatCardinality(code) {
  const map = { oto: '1:1', otm: '1:N', mto: 'N:1', mtm: 'N:N' };
  return map[code] || code;
}

// Export for global access
window.GDEditSchema = {
  schemaEditor,
  formatCardinality,
  PROPERTY_TYPES,
  CARDINALITY_OPTIONS
};
