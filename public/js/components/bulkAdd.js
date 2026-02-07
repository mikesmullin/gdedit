/**
 * Bulk Add Rows Component
 * Add multiple rows with template naming
 */

/**
 * Parse template string with variables
 * @param {string} template - Template string with $t (type) and $i (index)
 * @param {object} vars - Variables: { type, index, total }
 * @returns {string} Parsed string
 */
function parseTemplate(template, vars) {
  if (!template) return '';
  
  return template
    .replace(/\$t/g, vars.type || '')
    .replace(/\$i/g, String(vars.index || 0).padStart(3, '0'))
    .replace(/\$n/g, String(vars.total || 0));
}

/**
 * Generate multiple IDs from template
 * @param {string} template - Template string
 * @param {string} className - Class name
 * @param {number} count - Number of IDs
 * @param {number} startIndex - Starting index
 * @returns {Array<string>} Generated IDs
 */
function generateIds(template, className, count, startIndex = 1) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = parseTemplate(template, {
      type: className.toLowerCase(),
      index: startIndex + i,
      total: count
    });
    ids.push(id);
  }
  return ids;
}

/**
 * Bulk add modal component
 */
function bulkAddModal() {
  return {
    showBulkAddModal: false,
    selectedClass: '',
    rowCount: 5,
    customCount: 10,
    useCustomCount: false,
    nameTemplate: '$t-$i',
    startIndex: 1,
    generatedIds: [],
    isCreating: false,
    
    presetCounts: [1, 5, 10, 25],

    init() {
      this.$watch('selectedClass', () => this.updatePreview());
      this.$watch('rowCount', () => this.updatePreview());
      this.$watch('customCount', () => this.updatePreview());
      this.$watch('useCustomCount', () => this.updatePreview());
      this.$watch('nameTemplate', () => this.updatePreview());
      this.$watch('startIndex', () => this.updatePreview());
    },

    open() {
      const store = Alpine.store('editor');
      this.selectedClass = store.selectedClass || '';
      this.showBulkAddModal = true;
      this.updatePreview();
    },

    close() {
      this.showBulkAddModal = false;
      this.isCreating = false;
    },

    get actualCount() {
      return this.useCustomCount ? this.customCount : this.rowCount;
    },

    updatePreview() {
      if (!this.selectedClass || !this.nameTemplate) {
        this.generatedIds = [];
        return;
      }
      
      const count = Math.min(this.actualCount, 100);
      this.generatedIds = generateIds(
        this.nameTemplate, 
        this.selectedClass, 
        count,
        this.startIndex
      );
    },

    selectPreset(count) {
      this.useCustomCount = false;
      this.rowCount = count;
    },

    async createRows() {
      if (!this.selectedClass || this.generatedIds.length === 0) return;
      
      this.isCreating = true;
      const errors = [];

      try {
        for (const id of this.generatedIds) {
          const res = await fetch('/api/instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ className: this.selectedClass, id })
          });
          
          if (!res.ok) {
            const err = await res.json();
            errors.push({ id, error: err.error || 'Failed to create' });
          }
        }

        if (errors.length === 0) {
          this.close();
          await fetch('/api/reload', { method: 'POST' });
          window.dispatchEvent(new CustomEvent('gdedit:reload'));
        } else {
          alert(`Created ${this.generatedIds.length - errors.length} rows. Errors:\n${errors.map(e => `${e.id}: ${e.error}`).join('\n')}`);
        }
      } catch (e) {
        alert('Failed to create rows: ' + e.message);
      } finally {
        this.isCreating = false;
      }
    }
  };
}
