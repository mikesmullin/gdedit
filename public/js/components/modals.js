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
    componentEditors: [],

    get schema() {
      return Alpine.store('editor').schema || {};
    },

    init() {
      // Pre-select current class
      this.$watch('showAddModal', (val) => {
        if (!val) return;

        const selectedClass = Alpine.store('editor').selectedClass;
        if (selectedClass) {
          this.newClass = selectedClass;
        }
        this.rebuildComponentEditors();
      });

      this.$watch('newClass', () => this.rebuildComponentEditors());
    },

    defaultValueForType(type) {
      const t = String(type || 'string').toLowerCase();
      if (t === 'bool' || t === 'boolean') return false;
      if (t === 'int' || t === 'integer' || t === 'float' || t === 'double' || t === 'number') return 0;
      if (t === 'string[]' || t === 'array') return [];
      if (t === 'object' || t === 'json') return {};
      return '';
    },

    rebuildComponentEditors() {
      const className = String(this.newClass || '').trim();
      const schemaClasses = this.schema.classes || {};
      const schemaComponents = this.schema.components || {};
      const classDef = schemaClasses[className] || {};
      const componentMap = classDef.components || {};

      this.componentEditors = Object.entries(componentMap).map(([localName, componentClass]) => {
        const properties = schemaComponents[componentClass]?.properties || {};
        return {
          localName,
          componentClass,
          properties: Object.entries(properties).map(([name, def]) => ({
            name,
            type: String(def?.type || 'string'),
            required: def?.required === true,
            value: this.defaultValueForType(def?.type)
          }))
        };
      });
    },

    normalizePropertyValue(type, value) {
      const t = String(type || 'string').toLowerCase();
      if (t === 'bool' || t === 'boolean') return Boolean(value);
      if (t === 'int' || t === 'integer') {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      if (t === 'float' || t === 'double' || t === 'number') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      if (t === 'string[]' || t === 'array') {
        if (Array.isArray(value)) return value;
        const text = String(value || '').trim();
        if (!text) return [];
        return text.split(',').map((item) => item.trim()).filter(Boolean);
      }
      if (t === 'object' || t === 'json') {
        if (value && typeof value === 'object') return value;
        const text = String(value || '').trim();
        if (!text) return {};
        try {
          return JSON.parse(text);
        } catch {
          return {};
        }
      }
      return String(value ?? '');
    },

    isRequiredPropertyFilled(property) {
      const type = String(property?.type || 'string').toLowerCase();
      const value = property?.value;

      if (type === 'bool' || type === 'boolean') {
        return typeof value === 'boolean';
      }

      if (type === 'int' || type === 'integer' || type === 'float' || type === 'double' || type === 'number') {
        if (value === '' || value === null || value === undefined) return false;
        return Number.isFinite(Number(value));
      }

      if (type === 'string[]' || type === 'array') {
        if (Array.isArray(value)) return value.length > 0;
        return String(value || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .length > 0;
      }

      if (type === 'object' || type === 'json') {
        if (value && typeof value === 'object') {
          return Object.keys(value).length > 0;
        }

        const text = String(value || '').trim();
        if (!text) return false;
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed)) return parsed.length > 0;
            return Object.keys(parsed).length > 0;
          }
          return true;
        } catch {
          return false;
        }
      }

      return String(value ?? '').trim().length > 0;
    },

    hasRequiredPropertyGaps() {
      for (const component of this.componentEditors) {
        for (const property of component.properties || []) {
          if (!property.required) continue;
          if (!this.isRequiredPropertyFilled(property)) return true;
        }
      }
      return false;
    },

    canCreate() {
      const className = String(this.newClass || '').trim();
      const id = String(this.newId || '').trim();
      if (!className || !id) return false;
      return !this.hasRequiredPropertyGaps();
    },

    buildComponentsPayload() {
      const components = {};

      for (const component of this.componentEditors) {
        components[component.localName] = {};

        for (const property of component.properties) {
          components[component.localName][property.name] = this.normalizePropertyValue(property.type, property.value);
        }
      }

      return components;
    },

    async createRow() {
      const className = String(this.newClass || '').trim();
      const id = String(this.newId || '').trim();

      if (!this.canCreate()) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Class, ID, and required properties are required' }));
        return;
      }
      const components = this.buildComponentsPayload();
      
      const res = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ className, id, components })
      });
      
      if (res.ok) {
        this.showAddModal = false;
        this.newId = '';
        this.componentEditors = [];
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
