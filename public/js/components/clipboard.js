/**
 * Clipboard Operations Component
 * Copy/Paste for tables, rows, cells, columns
 */

/**
 * Detect clipboard data format
 * @param {string} text - Clipboard text
 * @returns {object} Format info: { type, delimiter, hasHeaders }
 */
export function detectFormat(text) {
  if (!text) return { type: 'empty' };

  const lines = text.trim().split('\n');
  if (lines.length === 0) return { type: 'empty' };

  // Check for JSON
  if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
    try {
      JSON.parse(text);
      return { type: 'json' };
    } catch {}
  }

  // Check for TSV (tabs)
  const tabCount = (lines[0].match(/\t/g) || []).length;
  const commaCount = (lines[0].match(/,/g) || []).length;

  const delimiter = tabCount > commaCount ? '\t' : ',';
  const type = delimiter === '\t' ? 'tsv' : 'csv';

  // Detect headers (first row with no numeric values)
  const firstRow = parseDelimitedRow(lines[0], delimiter);
  const hasHeaders = firstRow.every(cell => isNaN(Number(cell)) || cell === '');

  return { type, delimiter, hasHeaders, lines };
}

/**
 * Parse a delimited row (handles quoted values)
 */
export function parseDelimitedRow(row, delimiter = ',') {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (const char of row) {
    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      inQuotes = false;
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Parse clipboard data into structured format
 */
export function parseClipboard(text, format = null) {
  const detected = format || detectFormat(text);

  if (detected.type === 'json') {
    return { type: 'json', data: JSON.parse(text) };
  }

  if (detected.type === 'csv' || detected.type === 'tsv') {
    const lines = text.trim().split('\n');
    const rows = lines.map(line => parseDelimitedRow(line, detected.delimiter));
    
    if (detected.hasHeaders && rows.length > 1) {
      const headers = rows[0];
      const data = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => obj[h] = row[i] || '');
        return obj;
      });
      return { type: 'table', headers, data, rows: rows.slice(1) };
    }
    
    return { type: 'rows', rows };
  }

  // Single value
  return { type: 'value', value: text };
}

/**
 * Format data for clipboard
 */
export function formatForClipboard(data, format = 'tsv') {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }

  const delimiter = format === 'csv' ? ',' : '\t';

  if (Array.isArray(data)) {
    if (data.length === 0) return '';
    
    // Array of objects - use first item keys as headers
    if (typeof data[0] === 'object' && !Array.isArray(data[0])) {
      const headers = Object.keys(data[0]);
      const rows = [headers.join(delimiter)];
      for (const item of data) {
        const cells = headers.map(h => escapeCell(item[h], delimiter));
        rows.push(cells.join(delimiter));
      }
      return rows.join('\n');
    }
    
    // Array of arrays
    return data.map(row => 
      Array.isArray(row) ? row.map(c => escapeCell(c, delimiter)).join(delimiter) : String(row)
    ).join('\n');
  }

  return String(data);
}

function escapeCell(value, delimiter) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Clipboard component for Alpine.js
 */
export function clipboard() {
  return {
    showPastePad: false,
    pasteContent: '',
    pastePreview: null,
    pasteMode: 'auto',

    async copyTable() {
      const store = Alpine.store('editor');
      const instances = this.getFilteredInstances();
      const columns = store.columns.filter(c => c.visible);
      
      const data = instances.map(inst => {
        const row = { _id: inst._id, _class: inst._class };
        for (const col of columns) {
          const [localName, prop] = col.id.split('.');
          row[col.id] = inst.components?.[localName]?.[prop] ?? '';
        }
        return row;
      });

      const text = formatForClipboard(data, 'tsv');
      await navigator.clipboard.writeText(text);
      this.showToast(`Copied ${data.length} rows`);
    },

    async copySelectedRows() {
      const store = Alpine.store('editor');
      if (store.selectedRows.length === 0) return;

      const columns = store.columns.filter(c => c.visible);
      const instances = store.instances.filter(i => store.selectedRows.includes(i._id));
      
      const data = instances.map(inst => {
        const row = { _id: inst._id, _class: inst._class };
        for (const col of columns) {
          const [localName, prop] = col.id.split('.');
          row[col.id] = inst.components?.[localName]?.[prop] ?? '';
        }
        return row;
      });

      const text = formatForClipboard(data, 'tsv');
      await navigator.clipboard.writeText(text);
      this.showToast(`Copied ${data.length} selected rows`);
    },

    async copyCell(instance, columnId) {
      const [localName, prop] = columnId.split('.');
      const value = instance.components?.[localName]?.[prop] ?? '';
      await navigator.clipboard.writeText(String(value));
      this.showToast('Copied cell');
    },

    async copyColumn(columnId) {
      const store = Alpine.store('editor');
      const instances = this.getFilteredInstances();
      
      const values = instances.map(inst => {
        if (columnId === '_id') return inst._id;
        if (columnId === '_class') return inst._class;
        const [localName, prop] = columnId.split('.');
        return inst.components?.[localName]?.[prop] ?? '';
      });

      await navigator.clipboard.writeText(values.join('\n'));
      this.showToast(`Copied ${values.length} values from column`);
    },

    getFilteredInstances() {
      const store = Alpine.store('editor');
      let instances = store.instances;
      if (store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      return instances;
    },

    openPastePad() {
      this.pasteContent = '';
      this.pastePreview = null;
      this.showPastePad = true;
    },

    closePastePad() {
      this.showPastePad = false;
      this.pasteContent = '';
      this.pastePreview = null;
    },

    updatePastePreview() {
      if (!this.pasteContent) {
        this.pastePreview = null;
        return;
      }
      
      const format = detectFormat(this.pasteContent);
      const parsed = parseClipboard(this.pasteContent, format);
      
      this.pastePreview = {
        format: format.type,
        rowCount: parsed.rows?.length || (parsed.data?.length) || 1,
        headers: parsed.headers || [],
        preview: parsed.rows?.slice(0, 3) || parsed.data?.slice(0, 3) || []
      };
    },

    async executePaste() {
      if (!this.pasteContent) return;
      
      const store = Alpine.store('editor');
      const parsed = parseClipboard(this.pasteContent);
      
      if (parsed.type === 'table' && parsed.headers && store.selectedClass) {
        await this.pasteAsRows(parsed, store.selectedClass);
      } else if (parsed.type === 'rows' && store.selectedClass) {
        await this.pasteRows(parsed.rows, store.selectedClass);
      } else {
        alert('Cannot determine paste format. Please select a class.');
      }
      
      this.closePastePad();
    },

    async pasteAsRows(parsed, className) {
      const columns = Alpine.store('editor').columns;
      let created = 0;
      
      for (const row of parsed.data) {
        const id = row._id || row.id || `${className.toLowerCase()}-${Date.now()}-${created}`;
        
        const res = await fetch('/api/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ className, id })
        });
        
        if (res.ok) {
          // Update properties
          for (const [key, value] of Object.entries(row)) {
            if (key === '_id' || key === '_class' || key === 'id') continue;
            
            const col = columns.find(c => c.id === key);
            if (col) {
              await fetch(`/api/instances/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ columnId: key, value })
              });
            }
          }
          created++;
        }
      }
      
      await fetch('/api/reload', { method: 'POST' });
      window.dispatchEvent(new CustomEvent('gdedit:reload'));
      this.showToast(`Created ${created} rows`);
    },

    async pasteRows(rows, className) {
      let created = 0;
      
      for (const row of rows) {
        const id = row[0] || `${className.toLowerCase()}-${Date.now()}-${created}`;
        
        const res = await fetch('/api/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ className, id })
        });
        
        if (res.ok) created++;
      }
      
      await fetch('/api/reload', { method: 'POST' });
      window.dispatchEvent(new CustomEvent('gdedit:reload'));
      this.showToast(`Created ${created} rows`);
    },

    showToast(message) {
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: message }));
    }
  };
}
