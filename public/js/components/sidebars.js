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
      defaultView: 'all',
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
        this.settings.defaultView = cfg.ui?.defaultView || 'all';
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
        const payload = this.buildPayload();
        const res = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const details = await res.json().catch(() => ({}));
          throw new Error(details.error || 'Failed to save config');
        }

        this.saveStatus = 'Saved';
        await this.loadConfig();
        Alpine.store('editor').pageSize = Number(this.settings.pageSize) || 20;

        const appEl = document.querySelector('[x-data="app()"]');
        if (appEl?._x_dataStack?.[0]?.loadConfig) {
          await appEl._x_dataStack[0].loadConfig();
        }

        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Config saved' }));
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
    get selectedEntityId() {
      const store = Alpine.store('editor');
      return store.selectedEntityId || store.selectedRows?.[0] || null;
    },

    get selectedIds() {
      return Alpine.store('editor').selectedRows || [];
    },

    get selectedCount() {
      if (this.selectedIds.length > 0) return this.selectedIds.length;
      return this.selectedEntityId ? 1 : 0;
    },

    get selectedInstance() {
      const selectedId = this.selectedEntityId;
      if (!selectedId) return null;
      const instances = Alpine.store('editor').instances || [];
      return instances.find((instance) => instance._id === selectedId) || null;
    },

    get inspectorColumns() {
      const instance = this.selectedInstance;
      if (!instance) return [];

      const storeColumns = Alpine.store('editor').columns || [];
      if (storeColumns.length > 0) return storeColumns;

      return this.inferColumnsFromInstance(instance);
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
    }
  };
}
