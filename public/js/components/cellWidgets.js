/**
 * Cell Widgets Component
 * Advanced cell editors for different data types
 */

/**
 * Type definitions for widget metadata
 */
const TYPE_WIDGETS = {
  // Primitives
  string: 'text',
  int: 'integer',
  integer: 'integer',
  float: 'float',
  double: 'float',
  number: 'float',
  bool: 'checkbox',
  boolean: 'checkbox',
  date: 'date',
  
  // Complex
  color: 'color',
  vector2: 'vector',
  vector3: 'vector',
  vector4: 'vector',
  vec2: 'vector',
  vec3: 'vector',
  vec4: 'vector',
  'string[]': 'tags',
  tags: 'tags',
  array: 'array',
  object: 'object',
  json: 'object',
  
  // Reference
  entity: 'entityRef',
  entityRef: 'entityRef',
  relation: 'relation'
};

/**
 * Detect vector dimensions from type
 */
function getVectorDimensions(type) {
  const match = type.match(/(?:vector|vec)(\d)/i);
  return match ? parseInt(match[1]) : 3;
}

/**
 * Parse vector value from various formats
 */
function parseVector(value, dimensions) {
  if (!value) return Array(dimensions).fill(0);
  if (Array.isArray(value)) return value.slice(0, dimensions);
  if (typeof value === 'object') {
    const keys = ['x', 'y', 'z', 'w'].slice(0, dimensions);
    return keys.map(k => value[k] ?? 0);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parseVector(parsed, dimensions);
    } catch {
      return value.split(',').map(v => parseFloat(v.trim()) || 0).slice(0, dimensions);
    }
  }
  return Array(dimensions).fill(0);
}

/**
 * Format vector for storage
 */
function formatVector(values) {
  return values;
}

/**
 * Parse tags from various formats
 */
function parseTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value.split(',').map(t => t.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Parse nested object
 */
function parseObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Parse array
 */
function parseArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Infer enum values from property name or schema
 */
function inferEnumValues(propName, schema) {
  const commonEnums = {
    status: ['active', 'inactive', 'pending', 'archived'],
    state: ['idle', 'running', 'paused', 'stopped'],
    priority: ['low', 'medium', 'high', 'critical'],
    type: ['default', 'primary', 'secondary'],
    size: ['small', 'medium', 'large', 'xlarge'],
    alignment: ['left', 'center', 'right'],
    direction: ['up', 'down', 'left', 'right'],
    difficulty: ['easy', 'normal', 'hard', 'expert']
  };
  
  // Check schema for enum definition
  if (schema?.enum) return schema.enum;
  
  // Check common patterns
  const lower = propName.toLowerCase();
  for (const [key, values] of Object.entries(commonEnums)) {
    if (lower.includes(key)) return values;
  }
  
  return null;
}

/**
 * Integer Widget Component
 */
function integerWidget() {
  return {
    localValue: 0,
    min: null,
    max: null,
    step: 1,
    
    init() {
      this.localValue = parseInt(this.getValue()) || 0;
      // Check schema for constraints
      if (this.col.schema) {
        this.min = this.col.schema.min ?? null;
        this.max = this.col.schema.max ?? null;
        this.step = this.col.schema.step ?? 1;
      }
    },
    
    validateAndSet(val) {
      let num = parseInt(val) || 0;
      if (this.min !== null) num = Math.max(this.min, num);
      if (this.max !== null) num = Math.min(this.max, num);
      this.localValue = num;
      this.setValue(num);
    },
    
    increment() {
      this.validateAndSet(this.localValue + this.step);
    },
    
    decrement() {
      this.validateAndSet(this.localValue - this.step);
    }
  };
}

/**
 * Float Widget Component
 */
function floatWidget() {
  return {
    localValue: 0,
    min: null,
    max: null,
    step: 0.1,
    precision: 2,
    
    init() {
      this.localValue = parseFloat(this.getValue()) || 0;
      if (this.col.schema) {
        this.min = this.col.schema.min ?? null;
        this.max = this.col.schema.max ?? null;
        this.step = this.col.schema.step ?? 0.1;
        this.precision = this.col.schema.precision ?? 2;
      }
    },
    
    formatDisplay() {
      return this.localValue.toFixed(this.precision);
    },
    
    validateAndSet(val) {
      let num = parseFloat(val) || 0;
      if (this.min !== null) num = Math.max(this.min, num);
      if (this.max !== null) num = Math.min(this.max, num);
      this.localValue = num;
      this.setValue(num);
    }
  };
}

/**
 * Number Slider Widget Component
 */
function sliderWidget() {
  return {
    localValue: 0,
    min: 0,
    max: 100,
    step: 1,
    showInput: false,
    
    init() {
      this.localValue = parseFloat(this.getValue()) || 0;
      if (this.col.schema) {
        this.min = this.col.schema.min ?? 0;
        this.max = this.col.schema.max ?? 100;
        this.step = this.col.schema.step ?? 1;
      }
    },
    
    get percentage() {
      return ((this.localValue - this.min) / (this.max - this.min)) * 100;
    },
    
    updateValue(val) {
      this.localValue = parseFloat(val);
      this.setValue(this.localValue);
    },
    
    toggleInput() {
      this.showInput = !this.showInput;
    }
  };
}

/**
 * Enum Dropdown Widget Component
 */
function enumWidget() {
  return {
    localValue: '',
    options: [],
    isOpen: false,
    searchTerm: '',
    
    init() {
      this.localValue = this.getValue() ?? '';
      this.options = this.col.schema?.enum || 
                     inferEnumValues(this.col.property, this.col.schema) || 
                     [];
    },
    
    get filteredOptions() {
      if (!this.searchTerm) return this.options;
      const term = this.searchTerm.toLowerCase();
      return this.options.filter(o => o.toLowerCase().includes(term));
    },
    
    selectOption(opt) {
      this.localValue = opt;
      this.setValue(opt);
      this.isOpen = false;
      this.searchTerm = '';
    },
    
    toggle() {
      this.isOpen = !this.isOpen;
      if (this.isOpen) this.searchTerm = '';
    }
  };
}

/**
 * Color Picker Widget Component
 */
function colorWidget() {
  return {
    localValue: '#000000',
    isOpen: false,
    recentColors: [],
    
    init() {
      this.localValue = this.normalizeColor(this.getValue());
      try {
        this.recentColors = JSON.parse(
          localStorage.getItem('gdedit-recent-colors') || '[]'
        ).slice(0, 8);
      } catch { this.recentColors = []; }
    },
    
    normalizeColor(val) {
      if (!val) return '#000000';
      if (typeof val === 'string' && val.startsWith('#')) return val;
      if (typeof val === 'object' && val.r !== undefined) {
        return this.rgbToHex(val.r, val.g, val.b);
      }
      return '#000000';
    },
    
    rgbToHex(r, g, b) {
      return '#' + [r, g, b].map(x => {
        const hex = Math.round(x).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      }).join('');
    },
    
    hexToRgb(hex) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 0, g: 0, b: 0 };
    },
    
    updateColor(hex) {
      this.localValue = hex;
      this.setValue(hex);
      this.addToRecent(hex);
    },
    
    addToRecent(hex) {
      this.recentColors = [hex, ...this.recentColors.filter(c => c !== hex)]
        .slice(0, 8);
      localStorage.setItem('gdedit-recent-colors', 
        JSON.stringify(this.recentColors));
    },
    
    selectRecent(color) {
      this.localValue = color;
      this.setValue(color);
      this.isOpen = false;
    }
  };
}

/**
 * Vector Widget Component (2D/3D/4D)
 */
function vectorWidget() {
  return {
    components: [],
    labels: ['X', 'Y', 'Z', 'W'],
    dimensions: 3,
    isExpanded: false,
    
    init() {
      this.dimensions = getVectorDimensions(this.col.type);
      this.components = parseVector(this.getValue(), this.dimensions);
    },
    
    updateComponent(index, value) {
      const num = parseFloat(value) || 0;
      this.components[index] = num;
      this.setValue(formatVector([...this.components]));
    },
    
    get displayValue() {
      return this.components.map(c => c.toFixed(2)).join(', ');
    },
    
    toggleExpanded() {
      this.isExpanded = !this.isExpanded;
    },
    
    setAll(value) {
      this.components = Array(this.dimensions).fill(parseFloat(value) || 0);
      this.setValue(formatVector([...this.components]));
    }
  };
}

/**
 * Tags (String Array) Widget Component
 */
function tagsWidget() {
  return {
    tags: [],
    inputValue: '',
    isEditing: false,
    suggestions: [],
    
    init() {
      this.tags = parseTags(this.getValue());
      // Get suggestions from other instances with same column
      this.loadSuggestions();
    },
    
    loadSuggestions() {
      const store = Alpine.store('editor');
      const existingTags = new Set();
      
      for (const inst of store.instances) {
        const [ln, prop] = this.col.id.split('.');
        const val = inst.components?.[ln]?.[prop];
        for (const tag of parseTags(val)) {
          existingTags.add(tag);
        }
      }
      
      this.suggestions = [...existingTags].sort();
    },
    
    get filteredSuggestions() {
      if (!this.inputValue) return [];
      const term = this.inputValue.toLowerCase();
      return this.suggestions
        .filter(s => s.toLowerCase().includes(term) && !this.tags.includes(s))
        .slice(0, 5);
    },
    
    addTag(tag) {
      tag = tag?.trim() || this.inputValue.trim();
      if (tag && !this.tags.includes(tag)) {
        this.tags = [...this.tags, tag];
        this.saveValue();
      }
      this.inputValue = '';
    },
    
    removeTag(index) {
      this.tags = this.tags.filter((_, i) => i !== index);
      this.saveValue();
    },
    
    handleKeydown(e) {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        this.addTag();
      } else if (e.key === 'Backspace' && !this.inputValue && this.tags.length) {
        this.removeTag(this.tags.length - 1);
      }
    },
    
    saveValue() {
      this.setValue(this.tags);
    }
  };
}

/**
 * Nested Object Widget Component
 */
function objectWidget() {
  return {
    data: {},
    isExpanded: false,
    editMode: false,
    jsonText: '',
    parseError: null,
    
    init() {
      this.data = parseObject(this.getValue());
      this.jsonText = JSON.stringify(this.data, null, 2);
    },
    
    get preview() {
      const keys = Object.keys(this.data);
      if (keys.length === 0) return '{}';
      return `{${keys.slice(0, 2).join(', ')}${keys.length > 2 ? '...' : ''}}`;
    },
    
    get keyCount() {
      return Object.keys(this.data).length;
    },
    
    toggleExpanded() {
      this.isExpanded = !this.isExpanded;
    },
    
    startEdit() {
      this.jsonText = JSON.stringify(this.data, null, 2);
      this.editMode = true;
      this.parseError = null;
    },
    
    cancelEdit() {
      this.editMode = false;
      this.parseError = null;
    },
    
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
      this.data[key] = value;
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
 * Array Widget Component
 */
function arrayWidget() {
  return {
    items: [],
    isExpanded: false,
    editIndex: -1,
    editValue: '',
    
    init() {
      this.items = parseArray(this.getValue());
    },
    
    get preview() {
      if (this.items.length === 0) return '[]';
      return `[${this.items.length} items]`;
    },
    
    toggleExpanded() {
      this.isExpanded = !this.isExpanded;
    },
    
    startEdit(index) {
      this.editIndex = index;
      this.editValue = typeof this.items[index] === 'object' 
        ? JSON.stringify(this.items[index]) 
        : String(this.items[index]);
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
    
    cancelEdit() {
      this.editIndex = -1;
    },
    
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
      [this.items[index], this.items[index - 1]] = 
        [this.items[index - 1], this.items[index]];
      this.setValue([...this.items]);
    },
    
    moveDown(index) {
      if (index >= this.items.length - 1) return;
      [this.items[index], this.items[index + 1]] = 
        [this.items[index + 1], this.items[index]];
      this.setValue([...this.items]);
    }
  };
}

/**
 * Entity Reference Widget Component
 */
function entityRefWidget() {
  return {
    localValue: '',
    isOpen: false,
    searchTerm: '',
    recentSelections: [],
    filterClass: '',
    
    init() {
      this.localValue = this.getValue() ?? '';
      try {
        this.recentSelections = JSON.parse(
          localStorage.getItem('gdedit-recent-entities') || '[]'
        ).slice(0, 10);
      } catch { this.recentSelections = []; }
      
      // Get filter class from schema
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
      this.recentSelections = [id, ...this.recentSelections.filter(r => r !== id)]
        .slice(0, 10);
      localStorage.setItem('gdedit-recent-entities', 
        JSON.stringify(this.recentSelections));
    },
    
    toggle() {
      this.isOpen = !this.isOpen;
      if (this.isOpen) {
        this.searchTerm = '';
      }
    }
  };
}

/**
 * Relation Editor Widget Component
 */
function relationWidget() {
  return {
    targets: [],
    isOpen: false,
    searchTerm: '',
    cardinality: 'mtm',
    qualifiers: {},
    editingQualifier: null,
    
    init() {
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
      
      // Exclude already selected
      const selectedIds = new Set(this.targets.map(t => t._to));
      entities = entities.filter(e => !selectedIds.has(e._id));
      
      return entities;
    },
    
    get filteredEntities() {
      let entities = this.entities;
      
      if (this.searchTerm) {
        const term = this.searchTerm.toLowerCase();
        entities = entities.filter(e => 
          e._id.toLowerCase().includes(term)
        );
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
      if (key) {
        this.qualifiers[key] = '';
      }
    },
    
    removeQualifierField(key) {
      delete this.qualifiers[key];
    },
    
    saveValue() {
      if (this.isSingle) {
        this.setValue(this.targets[0] || null);
      } else {
        this.setValue(this.targets);
      }
    }
  };
}

// Export widget factories for global use
window.GDEditWidgets = {
  TYPE_WIDGETS,
  getVectorDimensions,
  parseVector,
  parseTags,
  parseObject,
  parseArray,
  inferEnumValues,
  integerWidget,
  floatWidget,
  sliderWidget,
  enumWidget,
  colorWidget,
  vectorWidget,
  tagsWidget,
  objectWidget,
  arrayWidget,
  entityRefWidget,
  relationWidget
};
