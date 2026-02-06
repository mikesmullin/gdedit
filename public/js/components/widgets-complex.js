/**
 * Complex Widget Data Functions
 * Structured type editors: array, object, entity reference, relation
 */

/**
 * Array widget data
 */
function arrayWidgetData() {
  return {
    items: [], isExpanded: false, editIndex: -1, editValue: '',
    
    initArray() {
      this.items = window.GDEditWidgets?.parseArray?.(this.getValue()) || [];
    },
    
    get preview() {
      if (this.items.length === 0) return '[]';
      return `[${this.items.length} items]`;
    },
    
    toggleExpanded() { this.isExpanded = !this.isExpanded; },
    
    startEdit(index) {
      this.editIndex = index;
      this.editValue = typeof this.items[index] === 'object' 
        ? JSON.stringify(this.items[index]) 
        : String(this.items[index] ?? '');
    },
    
    saveEdit() {
      if (this.editIndex < 0) return;
      try {
        this.items[this.editIndex] = JSON.parse(this.editValue);
      } catch {
        this.items[this.editIndex] = this.editValue;
      }
      this.setValue([...this.items]);
      this.editIndex = -1;
    },
    
    cancelEdit() { this.editIndex = -1; },
    
    addItem() {
      this.items.push('');
      this.setValue([...this.items]);
      this.startEdit(this.items.length - 1);
    },
    
    removeItem(index) {
      this.items.splice(index, 1);
      this.setValue([...this.items]);
    },
    
    moveUp(index) {
      if (index <= 0) return;
      [this.items[index], this.items[index - 1]] = [this.items[index - 1], this.items[index]];
      this.setValue([...this.items]);
    },
    
    moveDown(index) {
      if (index >= this.items.length - 1) return;
      [this.items[index], this.items[index + 1]] = [this.items[index + 1], this.items[index]];
      this.setValue([...this.items]);
    }
  };
}

/**
 * Object widget data
 */
function objectWidgetData() {
  return {
    data: {}, isExpanded: false, editMode: false, jsonText: '', parseError: null,
    
    initObject() {
      this.data = window.GDEditWidgets?.parseObject?.(this.getValue()) || {};
      this.jsonText = JSON.stringify(this.data, null, 2);
    },
    
    get preview() {
      const keys = Object.keys(this.data);
      if (keys.length === 0) return '{}';
      return `{${keys.slice(0, 2).join(', ')}${keys.length > 2 ? '...' : ''}}`;
    },
    
    get keyCount() { return Object.keys(this.data).length; },
    
    toggleExpanded() { this.isExpanded = !this.isExpanded; },
    
    startEdit() {
      this.jsonText = JSON.stringify(this.data, null, 2);
      this.editMode = true;
      this.parseError = null;
    },
    
    cancelEdit() { this.editMode = false; this.parseError = null; },
    
    saveEdit() {
      try {
        this.data = JSON.parse(this.jsonText);
        this.setValue(this.data);
        this.editMode = false;
        this.parseError = null;
      } catch (e) {
        this.parseError = e.message;
      }
    },
    
    updateProperty(key, value) {
      try { this.data[key] = JSON.parse(value); }
      catch { this.data[key] = value; }
      this.setValue({ ...this.data });
    },
    
    deleteProperty(key) {
      delete this.data[key];
      this.setValue({ ...this.data });
    },
    
    addProperty() {
      const key = prompt('Property name:');
      if (key && !this.data.hasOwnProperty(key)) {
        this.data[key] = '';
        this.setValue({ ...this.data });
      }
    }
  };
}

/**
 * Entity reference widget data
 */
function entityRefWidgetData() {
  return {
    localValue: '', isOpen: false, searchTerm: '', 
    recentSelections: [], filterClass: '',
    
    initEntityRef() {
      this.localValue = this.getValue() ?? '';
      try {
        this.recentSelections = JSON.parse(
          localStorage.getItem('gdedit-recent-entities') || '[]'
        ).slice(0, 10);
      } catch { this.recentSelections = []; }
      
      if (this.col.schema?.targetClass) {
        this.filterClass = this.col.schema.targetClass;
      }
    },
    
    get entities() {
      const store = Alpine.store('editor');
      let entities = store.instances;
      if (this.filterClass) {
        entities = entities.filter(e => e._class === this.filterClass);
      }
      return entities;
    },
    
    get filteredEntities() {
      let entities = this.entities;
      if (this.searchTerm) {
        const term = this.searchTerm.toLowerCase();
        entities = entities.filter(e => 
          e._id.toLowerCase().includes(term) ||
          e._class.toLowerCase().includes(term)
        );
      }
      return entities.slice(0, 20);
    },
    
    get availableClasses() {
      const store = Alpine.store('editor');
      return [...new Set(store.instances.map(i => i._class))].sort();
    },
    
    get selectedEntity() {
      const store = Alpine.store('editor');
      return store.instances.find(i => i._id === this.localValue);
    },
    
    selectEntity(entity) {
      this.localValue = entity._id;
      this.setValue(entity._id);
      this.addToRecent(entity._id);
      this.isOpen = false;
      this.searchTerm = '';
    },
    
    clearSelection() {
      this.localValue = '';
      this.setValue(null);
    },
    
    addToRecent(id) {
      this.recentSelections = [id, ...this.recentSelections.filter(r => r !== id)].slice(0, 10);
      localStorage.setItem('gdedit-recent-entities', JSON.stringify(this.recentSelections));
    },
    
    toggle() {
      this.isOpen = !this.isOpen;
      if (this.isOpen) this.searchTerm = '';
    }
  };
}

/**
 * Relation editor widget data
 */
function relationWidgetData() {
  return {
    targets: [], isOpen: false, searchTerm: '',
    cardinality: 'mtm', qualifiers: {}, editingQualifier: null,
    
    initRelation() {
      const val = this.getValue();
      this.targets = Array.isArray(val) 
        ? val.map(t => typeof t === 'string' ? { _to: t } : t)
        : val ? [typeof val === 'string' ? { _to: val } : val] : [];
      
      if (this.col.schema) {
        this.cardinality = this.col.schema.cardinality || 'mtm';
      }
    },
    
    get isSingle() {
      return this.cardinality === 'oto' || this.cardinality === 'mto';
    },
    
    get entities() {
      const store = Alpine.store('editor');
      let entities = store.instances;
      if (this.col.schema?.targetClass) {
        entities = entities.filter(e => e._class === this.col.schema.targetClass);
      }
      const selectedIds = new Set(this.targets.map(t => t._to));
      return entities.filter(e => !selectedIds.has(e._id));
    },
    
    get filteredEntities() {
      let entities = this.entities;
      if (this.searchTerm) {
        const term = this.searchTerm.toLowerCase();
        entities = entities.filter(e => e._id.toLowerCase().includes(term));
      }
      return entities.slice(0, 15);
    },
    
    addTarget(entity) {
      if (this.isSingle) {
        this.targets = [{ _to: entity._id }];
      } else {
        this.targets = [...this.targets, { _to: entity._id }];
      }
      this.saveValue();
      if (this.isSingle) this.isOpen = false;
      this.searchTerm = '';
    },
    
    removeTarget(index) {
      this.targets = this.targets.filter((_, i) => i !== index);
      this.saveValue();
    },
    
    editQualifier(index) {
      this.editingQualifier = index;
      this.qualifiers = { ...this.targets[index] };
      delete this.qualifiers._to;
    },
    
    saveQualifier() {
      if (this.editingQualifier === null) return;
      const target = this.targets[this.editingQualifier];
      this.targets[this.editingQualifier] = { _to: target._to, ...this.qualifiers };
      this.saveValue();
      this.editingQualifier = null;
    },
    
    addQualifierField() {
      const key = prompt('Qualifier name (e.g., role, since):');
      if (key) this.qualifiers[key] = '';
    },
    
    removeQualifierField(key) { delete this.qualifiers[key]; },
    
    saveValue() {
      if (this.isSingle) {
        this.setValue(this.targets[0] || null);
      } else {
        this.setValue(this.targets);
      }
    }
  };
}
