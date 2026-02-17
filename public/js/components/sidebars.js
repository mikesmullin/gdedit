/**
 * Sidebar Layout Components
 * Left navigation and right inspector sidebars
 */

document.addEventListener('alpine:init', () => {
  Alpine.store('layout', {
    isNavOpen: true,
    isInspectorOpen: true
  });
});

function appNavSidebar() {
  return {
    sections: [
      { name: 'Main', icon: 'layout-grid' },
      { name: 'Settings', icon: 'settings' }
    ],
    openSection: 'Main',
    settings: {
      pageSize: 20,
      autoScroll: true,
      autoSelect: true,
      highlightAlpha: 0.35,
      highlightRows: true,
      highlightCols: true
    },
    baseConfig: {},
    saveError: '',
    isSaving: false,
    isHydratingSettings: false,
    pendingSave: false,

    async init() {
      await this.loadConfig();
      this.initAutoSaveWatchers();
    },

    initAutoSaveWatchers() {
      const fields = [
        'pageSize',
        'autoScroll', 'autoSelect', 'highlightAlpha', 'highlightRows', 'highlightCols'
      ];

      for (const field of fields) {
        this.$watch(`settings.${field}`, () => {
          this.triggerImmediateSave();
        });
      }
    },

    triggerImmediateSave() {
      if (this.isHydratingSettings) return;

      if (this.isSaving) {
        this.pendingSave = true;
        return;
      }

      void this.saveSettings();
    },

    async loadConfig() {
      try {
        this.isHydratingSettings = true;
        const cfg = await this.fetchConfigSnapshot();

        this.settings.pageSize = cfg.ui?.pageSize || 20;
        this.settings.autoScroll = cfg.ui?.autoScroll !== false;
        this.settings.autoSelect = cfg.ui?.autoSelect !== false;
        this.settings.highlightAlpha = Number.isFinite(Number(cfg.ui?.highlightAlpha)) ? Number(cfg.ui.highlightAlpha) : 0.35;
        this.settings.highlightRows = cfg.ui?.highlightRows !== false;
        this.settings.highlightCols = cfg.ui?.highlightCols !== false;
      } catch (error) {
        console.error('Failed to load nav settings:', error);
        this.saveError = 'Failed to load config';
      } finally {
        this.isHydratingSettings = false;
      }
    },

    async fetchConfigSnapshot() {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      this.baseConfig = cfg;
      return cfg;
    },

    buildPayload() {
      const payload = {
        ...this.baseConfig,
        ui: {
          ...(this.baseConfig.ui || {}),
          pageSize: Number(this.settings.pageSize) || 20,
          autoScroll: Boolean(this.settings.autoScroll),
          autoSelect: Boolean(this.settings.autoSelect),
          highlightAlpha: Number.isFinite(Number(this.settings.highlightAlpha))
            ? Math.min(1, Math.max(0, Number(this.settings.highlightAlpha)))
            : 0.35,
          highlightRows: Boolean(this.settings.highlightRows),
          highlightCols: Boolean(this.settings.highlightCols)
        }
      };

      return payload;
    },

    async saveSettings() {
      this.saveError = '';
      this.isSaving = true;

      try {
        let attempts = 0;
        let lastError = null;

        while (attempts < 2) {
          attempts += 1;
          const payload = this.buildPayload();
          payload.revision = Number(this.baseConfig?.revision || 0);

          const res = await fetch('/api/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            const saved = await res.json().catch(() => ({}));
            this.baseConfig = saved;
            const editorStore = Alpine.store('editor');
            editorStore.pageSize = Number(this.settings.pageSize) || 20;
            editorStore.autoScroll = Boolean(this.settings.autoScroll);
            editorStore.autoSelect = Boolean(this.settings.autoSelect);
            editorStore.highlightAlpha = Number.isFinite(Number(this.settings.highlightAlpha))
              ? Math.min(1, Math.max(0, Number(this.settings.highlightAlpha)))
              : 0.35;
            editorStore.highlightRows = Boolean(this.settings.highlightRows);
            editorStore.highlightCols = Boolean(this.settings.highlightCols);
            editorStore.configSnapshot = saved;
            editorStore.configRevision = Number.isInteger(Number(saved?.revision))
              ? Number(saved.revision)
              : editorStore.configRevision;
            editorStore.configLoaded = true;

            return;
          }

          const details = await res.json().catch(() => ({}));
          const isRevisionMismatch = res.status === 409 && details?.code === 'REVISION_MISMATCH';
          if (isRevisionMismatch && attempts < 2) {
            await this.fetchConfigSnapshot();
            continue;
          }

          lastError = new Error(details.error || 'Failed to save config');
          break;
        }

        throw lastError || new Error('Failed to save config');
      } catch (error) {
        this.saveError = error.message;
      } finally {
        this.isSaving = false;
        if (this.pendingSave) {
          this.pendingSave = false;
          this.triggerImmediateSave();
        }
      }
    },

    toggleSection(name) {
      this.openSection = this.openSection === name ? '' : name;
    },

    isSectionOpen(name) {
      return this.openSection === name;
    }
  };
}

function inspectorSidebar() {
  return {
    isRemoving: false,

    get selectedEntityId() {
      const store = Alpine.store('editor');
      return store.selectedEntityId || store.selectedRows?.[0] || null;
    },

    get selectedIds() {
      const store = Alpine.store('editor');
      if (Array.isArray(store.selectedRows) && store.selectedRows.length > 0) {
        return store.selectedRows;
      }
      return store.selectedEntityId ? [store.selectedEntityId] : [];
    },

    get selectedCount() {
      return this.selectedIds.length;
    },

    get selectedInstances() {
      const instances = Alpine.store('editor').instances || [];
      if (!this.selectedIds.length) return [];
      const byId = new Map(instances.map((instance) => [instance._id, instance]));
      return this.selectedIds.map((id) => byId.get(id)).filter(Boolean);
    },

    get selectedInstance() {
      return this.selectedInstances[0] || null;
    },

    get selectedIdsSummary() {
      if (this.selectedIds.length === 0) return '—';
      if (this.selectedIds.length === 1) return this.selectedIds[0];

      const previewCount = 2;
      const preview = this.selectedIds.slice(0, previewCount).join(', ');
      const remaining = this.selectedIds.length - previewCount;
      return remaining > 0 ? `${preview}, +${remaining} more` : preview;
    },

    get selectedClassSummary() {
      if (!this.selectedInstances.length) return '—';
      const classes = [...new Set(this.selectedInstances.map((instance) => instance._class).filter(Boolean))];
      if (classes.length === 0) return '—';
      if (classes.length === 1) return classes[0];
      return '— mixed —';
    },

    get inspectorColumns() {
      const instances = this.selectedInstances;
      if (!instances.length) return [];

      const commonColumnIds = this.getCommonColumnIds(instances);

      const storeColumns = Alpine.store('editor').columns || [];
      if (storeColumns.length > 0) {
        return storeColumns.filter((col) => commonColumnIds.has(col.id));
      }

      return this.inferColumnsFromInstance(instances[0]).filter((col) => commonColumnIds.has(col.id));
    },

    get relationPairs() {
      const rels = this.selectedInstance?.relations || {};
      return Object.entries(rels).map(([name, targets]) => ({
        name,
        targets: this.formatRelationTargets(targets)
      }));
    },

    inferColumnsFromInstance(instance) {
      const components = instance.components || {};
      const columns = [];

      for (const [localName, props] of Object.entries(components)) {
        for (const [property, value] of Object.entries(props || {})) {
          columns.push({
            id: `${localName}.${property}`,
            type: this.inferType(value),
            schema: {},
            required: false
          });
        }
      }

      return columns;
    },

    getCommonColumnIds(instances) {
      if (!instances.length) return new Set();

      const toColumnIdSet = (instance) => {
        const ids = new Set();
        const components = instance.components || {};
        for (const [localName, props] of Object.entries(components)) {
          for (const property of Object.keys(props || {})) {
            ids.add(`${localName}.${property}`);
          }
        }
        return ids;
      };

      const intersection = toColumnIdSet(instances[0]);
      for (let i = 1; i < instances.length; i += 1) {
        const ids = toColumnIdSet(instances[i]);
        for (const id of [...intersection]) {
          if (!ids.has(id)) intersection.delete(id);
        }
      }

      return intersection;
    },

    inferType(value) {
      if (typeof value === 'boolean') return 'bool';
      if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
      if (Array.isArray(value)) return value.every((v) => typeof v === 'string') ? 'string[]' : 'array';
      if (value && typeof value === 'object') return 'json';
      return 'string';
    },

    formatRelationTargets(targets) {
      if (!Array.isArray(targets) || targets.length === 0) return '—';
      return targets
        .map((target) => (typeof target === 'string' ? target : target._to || ''))
        .filter(Boolean)
        .join(', ');
    },

    async removeSelected() {
      const store = Alpine.store('editor');
      const selectedIds = Array.isArray(store.selectedRows) && store.selectedRows.length > 0
        ? [...store.selectedRows]
        : (store.selectedEntityId ? [store.selectedEntityId] : []);

      if (!selectedIds.length || this.isRemoving) return;

      this.isRemoving = true;
      try {
        await Promise.all(selectedIds.map(async (id) => {
          const res = await fetch(`/api/instances/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 404) {
            const details = await res.json().catch(() => ({}));
            throw new Error(details.error || `Failed to remove ${id}`);
          }
        }));

        store.selectedRows = [];
        store.selectedEntityId = null;
        window.dispatchEvent(new CustomEvent('gdedit:toast', {
          detail: selectedIds.length === 1 ? 'Record removed' : `${selectedIds.length} records removed`
        }));
        window.dispatchEvent(new CustomEvent('gdedit:reload'));
      } catch (error) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: `❌ ${error.message}` }));
      } finally {
        this.isRemoving = false;
      }
    }
  };
}
