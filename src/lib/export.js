/**
 * Export utilities
 * Export ontology data to various formats
 */

/**
 * Export instances to CSV format
 * @param {Array} instances - Instances to export
 * @param {Array} columns - Column definitions
 * @returns {string} CSV string
 */
export function toCSV(instances, columns) {
  const headers = ['_id', '_class', ...columns.map(c => c.id)];
  const rows = [headers.join(',')];

  for (const inst of instances) {
    const values = [
      escapeCSV(inst._id),
      escapeCSV(inst._class),
      ...columns.map(col => {
        const [localName, prop] = col.id.split('.');
        const value = inst.components?.[localName]?.[prop];
        return escapeCSV(formatValue(value));
      })
    ];
    rows.push(values.join(','));
  }

  return rows.join('\n');
}

/**
 * Export instances to JSON format
 * @param {Array} instances - Instances to export
 * @returns {string} JSON string
 */
export function toJSON(instances) {
  const clean = instances.map(i => {
    const copy = { ...i };
    delete copy._source;
    return copy;
  });
  return JSON.stringify(clean, null, 2);
}

/**
 * Escape a value for CSV
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Format a value for export
 */
function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(';');
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}
