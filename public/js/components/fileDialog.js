/**
 * File Dialog Components
 * Open/Save file operations
 */

/**
 * Export instances to CSV
 */
export function exportToCSV(instances, columns) {
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
 * Export instances to JSON
 */
export function exportToJSON(instances) {
  const clean = instances.map(i => {
    const copy = { ...i };
    delete copy._source;
    return copy;
  });
  return JSON.stringify(clean, null, 2);
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Download data as file
 */
export function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read file content
 */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Parse CSV content
 */
export function parseCSV(content, delimiter = ',') {
  const lines = content.trim().split('\n');
  const rows = [];

  for (const line of lines) {
    const cells = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
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
    rows.push(cells);
  }

  return rows;
}

/**
 * File dialog component for Alpine.js
 */
export function fileDialog() {
  return {
    showOpenDialog: false,
    showSaveDialog: false,
    openFile: null,
    openPreview: null,
    openFormat: 'auto',
    saveFormat: 'csv',
    saveFilename: 'export',
    exportVisibleOnly: true,

    // Open dialog methods
    openOpenDialog() {
      this.showOpenDialog = true;
      this.openFile = null;
      this.openPreview = null;
    },

    closeOpenDialog() {
      this.showOpenDialog = false;
      this.openFile = null;
      this.openPreview = null;
    },

    async handleFileSelect(event) {
      const file = event.target.files[0];
      if (!file) return;

      this.openFile = file;
      
      try {
        const content = await readFile(file);
        const ext = file.name.split('.').pop().toLowerCase();
        
        if (ext === 'json') {
          const data = JSON.parse(content);
          this.openPreview = {
            format: 'json',
            rows: Array.isArray(data) ? data.length : 1,
            sample: Array.isArray(data) ? data.slice(0, 3) : [data]
          };
        } else {
          const rows = parseCSV(content, ext === 'tsv' ? '\t' : ',');
          this.openPreview = {
            format: ext === 'tsv' ? 'tsv' : 'csv',
            rows: rows.length - 1,
            headers: rows[0],
            sample: rows.slice(1, 4)
          };
        }
      } catch (e) {
        this.openPreview = { error: e.message };
      }
    },

    async importFile() {
      if (!this.openFile) return;

      const store = Alpine.store('editor');
      if (!store.selectedClass) {
        alert('Please select a class before importing');
        return;
      }

      const content = await readFile(this.openFile);
      const ext = this.openFile.name.split('.').pop().toLowerCase();
      
      try {
        if (ext === 'json') {
          await this.importJSON(content, store.selectedClass);
        } else {
          await this.importCSV(content, store.selectedClass, ext === 'tsv' ? '\t' : ',');
        }
        
        await fetch('/api/reload', { method: 'POST' });
        window.dispatchEvent(new CustomEvent('gdedit:reload'));
        this.closeOpenDialog();
        this.showToast('Import completed');
      } catch (e) {
        alert('Import failed: ' + e.message);
      }
    },

    async importCSV(content, className, delimiter) {
      const rows = parseCSV(content, delimiter);
      const headers = rows[0];
      const columns = Alpine.store('editor').columns;
      
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const idIdx = headers.findIndex(h => h === '_id' || h === 'id');
        const id = idIdx >= 0 ? row[idIdx] : `${className.toLowerCase()}-import-${i}`;
        
        const res = await fetch('/api/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ className, id })
        });
        
        if (res.ok) {
          for (let j = 0; j < headers.length; j++) {
            const header = headers[j];
            if (header === '_id' || header === 'id' || header === '_class') continue;
            
            const col = columns.find(c => c.id === header);
            if (col && row[j]) {
              await fetch(`/api/instances/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ columnId: header, value: row[j] })
              });
            }
          }
        }
      }
    },

    async importJSON(content, className) {
      const data = JSON.parse(content);
      const items = Array.isArray(data) ? data : [data];
      const columns = Alpine.store('editor').columns;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const id = item._id || item.id || `${className.toLowerCase()}-import-${i}`;
        
        const res = await fetch('/api/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ className, id })
        });
        
        if (res.ok && item.components) {
          for (const [localName, props] of Object.entries(item.components)) {
            for (const [prop, value] of Object.entries(props)) {
              const columnId = `${localName}.${prop}`;
              await fetch(`/api/instances/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ columnId, value })
              });
            }
          }
        }
      }
    },

    // Save dialog methods
    openSaveDialog() {
      this.showSaveDialog = true;
      const store = Alpine.store('editor');
      this.saveFilename = store.selectedClass || 'export';
    },

    closeSaveDialog() {
      this.showSaveDialog = false;
    },

    exportData() {
      const store = Alpine.store('editor');
      let instances = store.instances;
      
      if (this.exportVisibleOnly && store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      
      const columns = store.columns.filter(c => c.visible);
      const filename = `${this.saveFilename}.${this.saveFormat}`;
      
      let content, mimeType;
      
      if (this.saveFormat === 'csv') {
        content = exportToCSV(instances, columns);
        mimeType = 'text/csv';
      } else {
        content = exportToJSON(instances);
        mimeType = 'application/json';
      }
      
      downloadFile(content, filename, mimeType);
      this.closeSaveDialog();
      this.showToast(`Exported to ${filename}`);
    },

    showToast(message) {
      window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: message }));
    }
  };
}
