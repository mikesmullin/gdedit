/**
 * GDEdit Utilities
 * Global utility functions for filtering, validation, etc.
 */

window.GDEdit = {
  applyGlobalFilter(instances, query, mode = 'search') {
    if (!query || !String(query).trim()) return instances;

    if (mode === 'precedence') {
      return this.applyPrecedenceFilter(instances, query);
    }

    return this.applyFilter(instances, query);
  },

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

  applyPrecedenceFilter(instances, precedenceQuery) {
    const rules = this.parsePrecedence(precedenceQuery);
    if (!rules) return instances;

    const nodeIds = new Set(instances.map((instance) => instance._id));
    const byId = new Map(instances.map((instance) => [instance._id, instance]));
    const nodeCount = instances.length;

    const forward = new Map();
    const backward = new Map();
    for (const id of nodeIds) {
      forward.set(id, new Set());
      backward.set(id, new Set());
    }

    for (const instance of instances) {
      const sourceId = instance._id;
      for (const targets of Object.values(instance.relations || {})) {
        const targetList = Array.isArray(targets) ? targets : [targets];
        for (const target of targetList) {
          const targetId = typeof target === 'object' ? target?._to : target;
          if (!targetId || !nodeIds.has(targetId)) continue;
          forward.get(sourceId).add(targetId);
          backward.get(targetId).add(sourceId);
        }
      }
    }

    const visibleNodeIds = new Set();

    for (const chain of rules.chains) {
      const resolved = chain.map((group) => {
        if (group.isWildcard) return new Set();
        const ids = new Set();
        for (const instance of instances) {
          if (this.matchesAnyPrecedenceSelector(instance, group.selectors)) {
            ids.add(instance._id);
          }
        }
        return ids;
      });

      for (let i = 0; i < chain.length; i += 1) {
        if (!chain[i].isWildcard) continue;

        const depth = chain[i].wildcardDepth;
        const maxSteps = depth === Infinity ? nodeCount : depth;

        let leftIdx = -1;
        for (let l = i - 1; l >= 0; l -= 1) {
          if (!chain[l].isWildcard) {
            leftIdx = l;
            break;
          }
        }

        let rightIdx = -1;
        for (let r = i + 1; r < chain.length; r += 1) {
          if (!chain[r].isWildcard) {
            rightIdx = r;
            break;
          }
        }

        if (leftIdx >= 0 && rightIdx >= 0) {
          const path = this.findPathNodeIds(resolved[leftIdx], resolved[rightIdx], forward, backward, maxSteps);
          for (const id of resolved[leftIdx]) path.delete(id);
          for (const id of resolved[rightIdx]) path.delete(id);
          resolved[i] = path;
        } else if (rightIdx >= 0) {
          resolved[i] = this.walkGraph(resolved[rightIdx], backward, maxSteps);
        } else if (leftIdx >= 0) {
          resolved[i] = this.walkGraph(resolved[leftIdx], forward, maxSteps);
        }
      }

      for (let i = 0; i < chain.length; i += 1) {
        for (const id of resolved[i]) {
          if (byId.has(id)) visibleNodeIds.add(id);
        }
      }
    }

    return instances.filter((instance) => visibleNodeIds.has(instance._id));
  },

  parsePrecedence(precedenceQuery) {
    if (!precedenceQuery || typeof precedenceQuery !== 'string') return null;
    const trimmed = precedenceQuery.trim();
    if (!trimmed) return null;

    const chains = [];
    for (const statement of trimmed.split(';')) {
      const segment = statement.trim();
      if (!segment) continue;

      const groups = segment
        .split('>')
        .map((groupExpr) => {
          const selectors = groupExpr.split('&').map((raw) => this.parsePrecedenceSelector(raw)).filter(Boolean);
          const hasWildcard = selectors.length === 1 && selectors[0].kind === 'wildcard';
          return {
            selectors,
            isWildcard: hasWildcard,
            wildcardDepth: hasWildcard ? selectors[0].depth : 0,
          };
        })
        .filter((group) => group.selectors.length > 0);

      if (groups.length) chains.push(groups);
    }

    return chains.length ? { chains } : null;
  },

  parsePrecedenceSelector(token) {
    const value = String(token || '').trim();
    if (!value) return null;
    if (value === '**') return { kind: 'wildcard', depth: Infinity };
    if (value === '*') return { kind: 'wildcard', depth: 1 };

    const colonIndex = value.indexOf(':');
    if (colonIndex === -1) return { kind: 'id', id: value };
    if (colonIndex === 0) {
      const type = value.slice(1);
      return type ? { kind: 'type', type } : null;
    }

    const id = value.slice(0, colonIndex);
    const type = value.slice(colonIndex + 1);
    return id && type ? { kind: 'instance', id, type } : null;
  },

  matchesAnyPrecedenceSelector(instance, selectors) {
    return selectors.some((selector) => {
      if (selector.kind === 'wildcard') return false;
      if (selector.kind === 'id') return instance._id === selector.id;
      if (selector.kind === 'type') return instance._class === selector.type;
      if (selector.kind === 'instance') return instance._id === selector.id && instance._class === selector.type;
      return false;
    });
  },

  walkGraph(seeds, adjacency, maxSteps) {
    const visited = new Set(seeds);
    let frontier = new Set(seeds);

    for (let step = 0; step < maxSteps; step += 1) {
      const next = new Set();
      for (const id of frontier) {
        for (const neighbor of adjacency.get(id) || []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          next.add(neighbor);
        }
      }
      if (!next.size) break;
      frontier = next;
    }

    for (const id of seeds) visited.delete(id);
    return visited;
  },

  findPathNodeIds(sources, targets, forwardAdj, backwardAdj, maxSteps) {
    const forwardReachable = this.walkGraph(sources, forwardAdj, maxSteps);
    for (const id of sources) forwardReachable.add(id);

    const backwardReachable = this.walkGraph(targets, backwardAdj, maxSteps);
    for (const id of targets) backwardReachable.add(id);

    const intersection = new Set();
    for (const id of forwardReachable) {
      if (backwardReachable.has(id)) intersection.add(id);
    }
    return intersection;
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
