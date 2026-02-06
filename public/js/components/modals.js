/**
 * Modal Components
 * Add row, bulk add modals
 */

/**
 * Add single row modal
 */
function addModal() {
  return {
    get showAddModal() {
      return Alpine.store('editor').showAddModal || false;
    },
    set showAddModal(val) {
      Alpine.store('editor').showAddModal = val;
    },
    newClass: '',
    newId: '',

    init() {
      // Pre-select current class
      this.$watch('showAddModal', (val) => {
        if (val && Alpine.store('editor').selectedClass) {
          this.newClass = Alpine.store('editor').selectedClass;
        }
      });
    },

    async createRow() {
      if (!this.newClass || !this.newId) return;
      
      const res = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ className: this.newClass, id: this.newId })
      });
      
      if (res.ok) {
        this.showAddModal = false;
        this.newId = '';
        await fetch('/api/reload', { method: 'POST' });
        window.dispatchEvent(new CustomEvent('gdedit:reload'));
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Row created' }));
      } else {
        const err = await res.json();
        alert('Failed to create: ' + (err.error || 'Unknown error'));
      }
    }
  };
}

/**
 * Bulk add rows modal
 */
function bulkAddModal() {
  return {
    selectedClass: '',
    rowCount: 5,
    customCount: 10,
    useCustomCount: false,
    nameTemplate: '$t-$i',
    startIndex: 1,
    generatedIds: [],
    isCreating: false,
    presetCounts: [1, 5, 10, 25],

    get showBulkAddModal() {
      return Alpine.store('editor').showBulkAddModal || false;
    },
    set showBulkAddModal(val) {
      Alpine.store('editor').showBulkAddModal = val;
    },

    init() {
      this.$watch('selectedClass', () => this.updatePreview());
      this.$watch('rowCount', () => this.updatePreview());
      this.$watch('customCount', () => this.updatePreview());
      this.$watch('useCustomCount', () => this.updatePreview());
      this.$watch('nameTemplate', () => this.updatePreview());
      this.$watch('startIndex', () => this.updatePreview());
      
      // Watch for modal open to initialize
      this.$watch('showBulkAddModal', (val) => {
        if (val) {
          this.selectedClass = Alpine.store('editor').selectedClass || '';
          this.updatePreview();
        }
      });
    },

    open() {
      this.selectedClass = Alpine.store('editor').selectedClass || '';
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
      this.generatedIds = [];
      for (let i = 0; i < count; i++) {
        const id = this.nameTemplate
          .replace(/\$t/g, this.selectedClass.toLowerCase())
          .replace(/\$i/g, String(this.startIndex + i).padStart(3, '0'));
        this.generatedIds.push(id);
      }
    },

    selectPreset(count) {
      this.useCustomCount = false;
      this.rowCount = count;
    },

    async createRows() {
      if (!this.selectedClass || this.generatedIds.length === 0) return;
      
      this.isCreating = true;
      let created = 0;

      try {
        for (const id of this.generatedIds) {
          const res = await fetch('/api/instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ className: this.selectedClass, id })
          });
          if (res.ok) created++;
        }

        this.close();
        await fetch('/api/reload', { method: 'POST' });
        window.dispatchEvent(new CustomEvent('gdedit:reload'));
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `Created ${created} rows` }));
      } catch (e) {
        alert('Failed to create rows: ' + e.message);
      } finally {
        this.isCreating = false;
      }
    }
  };
}
