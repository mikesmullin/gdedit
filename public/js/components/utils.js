/**
 * GDEdit Utilities
 * Global utility functions for filtering, validation, etc.
 */

window.GDEdit = {
  /**
   * Apply DSL filter to instances
   */
  applyFilter(instances, query) {
    if (!query) return instances;
    const q = query.toLowerCase();
    
    // Check for id:Class pattern (id:Class: value or id:Class without trailing colon)
    const idClassMatch = query.match(/^([^:]+):([^.:]+):?\s*(.*)$/);
    if (idClassMatch) {
      const [, idPattern, cls, val] = idClassMatch;
      return instances.filter(i => {
        // Match id (case-insensitive, supports * wildcard)
        if (idPattern && idPattern !== '*' && idPattern !== '**') {
          if (idPattern.includes('*')) {
            const regex = new RegExp('^' + idPattern.replace(/\*/g, '.*') + '$', 'i');
            if (!regex.test(i._id)) return false;
          } else {
            if (i._id.toLowerCase() !== idPattern.toLowerCase()) return false;
          }
        }
        // Match class
        if (cls && i._class !== cls) return false;
        // Match value if provided
        if (val) {
          const searchStr = val.toLowerCase();
          const componentsStr = JSON.stringify(i.components || {}).toLowerCase();
          if (!componentsStr.includes(searchStr)) return false;
        }
        return true;
      });
    }
    
    // Check for DSL patterns (:Class.property: value)
    const classMatch = query.match(/^:([^.:\s]*)(?:\.([^:]+))?:\s*(.*)$/);
    if (classMatch) {
      const [, cls, prop, val] = classMatch;
      return instances.filter(i => {
        if (cls && i._class !== cls) return false;
        if (prop && val) {
          const [ln, p] = prop.split('.');
          const v = i.components?.[ln]?.[p];
          return String(v).toLowerCase() === val.toLowerCase() || 
                 v === (val === 'true' ? true : val === 'false' ? false : val);
        }
        return true;
      });
    }
    
    const relMatch = query.match(/-\[:([^\]]+)\]->:\s*(.*)$/);
    if (relMatch) {
      const [, rel, target] = relMatch;
      return instances.filter(i => {
        const rels = i.relations?.[rel];
        if (!rels) return false;
        if (!target) return rels.length > 0;
        return rels.some(r => (typeof r === 'string' ? r : r._to) === target);
      });
    }
    
    // Basic text search
    return instances.filter(i => {
      if (i._id.toLowerCase().includes(q)) return true;
      if (i._class.toLowerCase().includes(q)) return true;
      if (JSON.stringify(i.components || {}).toLowerCase().includes(q)) return true;
      return false;
    });
  },
  
  /**
   * Validate value against type
   */
  validateType(value, type, required = false) {
    const errors = [];
    
    if (required && (value === null || value === undefined || value === '')) {
      errors.push({ message: 'Field is required', type: 'error' });
      return errors;
    }
    
    if (value === null || value === undefined || value === '') return errors;
    
    switch (type) {
      case 'int':
      case 'integer':
        if (!Number.isInteger(Number(value))) {
          errors.push({ message: 'Expected integer', type: 'error' });
        }
        break;
      case 'float':
      case 'double':
      case 'number':
        if (isNaN(Number(value))) {
          errors.push({ message: 'Expected number', type: 'error' });
        }
        break;
      case 'bool':
      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors.push({ message: 'Expected boolean', type: 'error' });
        }
        break;
      case 'date':
        if (isNaN(Date.parse(value))) {
          errors.push({ message: 'Invalid date', type: 'error' });
        }
        break;
    }
    
    return errors;
  }
};

/**
 * Widget helper utilities
 */
window.GDEditWidgets = {
  /**
   * Get vector dimensions from type
   */
  getVectorDimensions(type) {
    if (!type) return 3;
    const t = type.toLowerCase();
    if (t.includes('2') || t === 'vec2' || t === 'vector2') return 2;
    if (t.includes('4') || t === 'vec4' || t === 'vector4') return 4;
    return 3;
  },
  
  /**
   * Parse vector value
   */
  parseVector(value, dimensions) {
    if (Array.isArray(value)) {
      return value.slice(0, dimensions).map(v => Number(v) || 0);
    }
    if (typeof value === 'object' && value !== null) {
      const keys = ['x', 'y', 'z', 'w'].slice(0, dimensions);
      return keys.map(k => Number(value[k]) || 0);
    }
    return Array(dimensions).fill(0);
  },
  
  /**
   * Parse tags from value
   */
  parseTags(value) {
    if (Array.isArray(value)) return value.filter(v => typeof v === 'string');
    if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  },
  
  /**
   * Parse array value
   */
  parseArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return []; }
    }
    return [];
  },
  
  /**
   * Parse object value
   */
  parseObject(value) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return {}; }
    }
    return {};
  },
  
  /**
   * Infer enum values from property
   */
  inferEnumValues(property, schema) {
    return schema?.enum || [];
  }
};
