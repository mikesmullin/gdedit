/**
 * Query Parser
 * Parses ontology search queries
 */

/**
 * Parse a search query string
 * @param {string} query - Query string
 * @returns {object} Parsed query object
 */
export function parseQuery(query) {
  if (!query || typeof query !== 'string') {
    return { type: 'empty' };
  }

  const trimmed = query.trim();
  
  // Bare value search (no operators)
  if (!trimmed.includes(':') && !trimmed.includes('-[')) {
    return { type: 'bare', value: trimmed };
  }

  // Class property search: [id]:Class[.property]: <value>
  const classMatch = trimmed.match(/^([^:]*):([^.:\s]*)(?:\.([^:]+))?:\s*(.*)$/);
  if (classMatch) {
    const [, id, className, property, value] = classMatch;
    return {
      type: 'class',
      id: id || null,
      class: className || null,
      property: property || null,
      value: parseValue(value)
    };
  }

  // Relation search: -[:RELATION]->: <value>
  const relMatch = trimmed.match(/-\[:([^\]]+)\]->\s*:\s*(.*)$/);
  if (relMatch) {
    const [, relation, value] = relMatch;
    return { type: 'relation', relation, value: parseValue(value) };
  }

  return { type: 'bare', value: trimmed };
}

/**
 * Parse a value string (handle booleans, numbers, etc.)
 */
function parseValue(str) {
  if (!str) return null;
  const trimmed = str.trim();
  
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  
  return trimmed;
}

/**
 * Apply query filter to instances
 * @param {Array} instances - Array of instances
 * @param {object} query - Parsed query
 * @returns {Array} Filtered instances
 */
export function applyFilter(instances, query) {
  if (query.type === 'empty') return instances;
  
  if (query.type === 'bare') {
    const search = query.value.toLowerCase();
    return instances.filter(i => matchBareValue(i, search));
  }

  if (query.type === 'class') {
    return instances.filter(i => matchClassQuery(i, query));
  }

  if (query.type === 'relation') {
    return instances.filter(i => matchRelationQuery(i, query));
  }

  return instances;
}

function matchBareValue(instance, search) {
  if (instance._id.toLowerCase().includes(search)) return true;
  if (instance._class.toLowerCase().includes(search)) return true;
  
  const componentsStr = JSON.stringify(instance.components || {}).toLowerCase();
  return componentsStr.includes(search);
}

function matchClassQuery(instance, query) {
  if (query.id && instance._id !== query.id) return false;
  if (query.class && instance._class !== query.class) return false;
  
  if (query.property && query.value !== null) {
    const [localName, prop] = query.property.split('.');
    const value = instance.components?.[localName]?.[prop];
    return value === query.value || String(value) === String(query.value);
  }
  
  return true;
}

function matchRelationQuery(instance, query) {
  const relations = instance.relations?.[query.relation];
  if (!relations) return false;
  
  if (query.value === null) return relations.length > 0;
  
  return relations.some(r => {
    const target = typeof r === 'string' ? r : r._to;
    return target === query.value;
  });
}
