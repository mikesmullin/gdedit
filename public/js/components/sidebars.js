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
      storagePath: '',
      serverHost: 'localhost',
      serverPort: 3000,
      pageSize: 20,
      defaultView: '',
      autoSave: true,
      autoSaveInterval: 30000,
      chatEnabled: true,
      chatDefaultAgent: 'ontologist',
      chatCommand: '',
      viewsText: '[]',
      chatAgentsText: '{}',
      chatModelsText: '[]',
      chatModesText: '[]'
    },
    baseConfig: {},
    saveStatus: '',
    saveError: '',
    isSaving: false,

    async init() {
      await this.loadConfig();
    },

    async loadConfig() {
      try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        this.baseConfig = cfg;

        this.settings.storagePath = cfg.storage?.path || '';
        this.settings.serverHost = cfg.server?.host || 'localhost';
        this.settings.serverPort = cfg.server?.port || 3000;
        this.settings.pageSize = cfg.ui?.pageSize || 20;
        this.settings.defaultView = cfg.ui?.defaultView ?? '';
        this.settings.autoSave = cfg.ui?.autoSave ?? true;
        this.settings.autoSaveInterval = cfg.ui?.autoSaveInterval || 30000;
        this.settings.chatEnabled = cfg.chat?.enabled ?? true;
        this.settings.chatDefaultAgent = cfg.chat?.defaultAgent || 'ontologist';
        this.settings.chatCommand = cfg.chat?.command || '';
        this.settings.viewsText = this.stringifyPretty(cfg.views || []);
        this.settings.chatAgentsText = this.stringifyPretty(cfg.chat?.agents || {});
        this.settings.chatModelsText = this.stringifyPretty(cfg.chat?.models || []);
        this.settings.chatModesText = this.stringifyPretty(cfg.chat?.modes || []);
      } catch (error) {
        console.error('Failed to load nav settings:', error);
        this.saveError = 'Failed to load config';
      }
    },

    stringifyPretty(value) {
      return JSON.stringify(value, null, 2);
    },

    parseJsonField(label, value, fallback) {
      const text = value?.trim();
      if (!text) return fallback;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${label} must be valid JSON`);
      }
    },

    buildPayload() {
      const payload = {
        ...this.baseConfig,
        storage: {
          ...(this.baseConfig.storage || {}),
          path: this.settings.storagePath
        },
        server: {
          ...(this.baseConfig.server || {}),
          host: this.settings.serverHost,
          port: Number(this.settings.serverPort) || 3000
        },
        ui: {
          ...(this.baseConfig.ui || {}),
          pageSize: Number(this.settings.pageSize) || 20,
          defaultView: this.settings.defaultView,
          autoSave: Boolean(this.settings.autoSave),
          autoSaveInterval: Number(this.settings.autoSaveInterval) || 30000
        },
        chat: {
          ...(this.baseConfig.chat || {}),
          enabled: Boolean(this.settings.chatEnabled),
          defaultAgent: this.settings.chatDefaultAgent,
          command: this.settings.chatCommand
        }
      };

      payload.views = this.parseJsonField('Views', this.settings.viewsText, []);
      payload.chat.agents = this.parseJsonField('Chat Agents', this.settings.chatAgentsText, {});
      payload.chat.models = this.parseJsonField('Chat Models', this.settings.chatModelsText, []);
      payload.chat.modes = this.parseJsonField('Chat Modes', this.settings.chatModesText, []);

      return payload;
    },

    async saveSettings() {
      this.saveError = '';
      this.saveStatus = '';
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
            this.saveStatus = 'Saved';
            await this.loadConfig();
            Alpine.store('editor').pageSize = Number(this.settings.pageSize) || 20;

            const appEl = document.querySelector('[x-data="app()"]');
            if (appEl?._x_dataStack?.[0]?.loadConfig) {
              await appEl._x_dataStack[0].loadConfig();
            }

            window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Config saved' }));
            return;
          }

          const details = await res.json().catch(() => ({}));
          const isRevisionMismatch = res.status === 409 && details?.code === 'REVISION_MISMATCH';
          if (isRevisionMismatch && attempts < 2) {
            await this.loadConfig();
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
