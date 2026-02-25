/**
 * Board View Component
 * Kanban-style board for Task instances grouped by workunit.status
 */

function boardView() {
  return {
    selectionAnchorId: null,

    init() {
      this.$watch('$store.editor.viewMode', (mode) => {
        if (mode !== 'board') return;
        this.ensureBoardSelectionIsValid();
      });

      this.$watch('$store.editor.instances', () => {
        const store = Alpine.store('editor');
        if (store.viewMode !== 'board') return;
        this.ensureBoardSelectionIsValid();
      });

      this.$watch('$store.editor.searchQuery', () => {
        const store = Alpine.store('editor');
        if (store.viewMode !== 'board') return;
        this.ensureBoardSelectionIsValid();
      });
    },

    taskInstances() {
      const store = Alpine.store('editor');
      const instances = Array.isArray(store.instances) ? store.instances : [];
      return instances.filter((instance) => String(instance?._class || '').trim() === 'Task');
    },

    getWorkunit(item) {
      const workunit = item?.components?.workunit;
      if (workunit && typeof workunit === 'object' && !Array.isArray(workunit)) return workunit;
      return {};
    },

    getStatus(item) {
      return String(this.getWorkunit(item)?.status || 'idle').trim().toLowerCase();
    },

    getLane(item) {
      const status = this.getStatus(item);
      if (status === 'running') return 'doing';
      if (status === 'success' || status === 'fail') return 'done';
      return 'todo';
    },

    getSummary(item) {
      const workunit = this.getWorkunit(item);
      return String(workunit.summary || item?._id || 'Task');
    },

    getDisplayId(item) {
      const value = String(item?._id || '').trim();
      return value ? value.slice(0, 6) : '—';
    },

    getDescription(item) {
      const workunit = this.getWorkunit(item);
      return String(workunit.description || '').trim();
    },

    parseDate(value) {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    },

    formatRelativeDate(value, now = new Date()) {
      const date = this.parseDate(value);
      if (!date) return '';

      const diffMs = date.getTime() - now.getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      const days = Math.round(Math.abs(diffMs) / dayMs);

      if (days === 0) return 'today';
      if (diffMs >= 0) return `${days} days`;
      return `${days} days ago`;
    },

    formatLongDate(value) {
      const date = this.parseDate(value);
      if (!date) return '';
      const raw = String(value || '');
      const hasTime = raw.includes('T');
      if (hasTime) {
        return date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
      }
      return date.toLocaleDateString(undefined, { dateStyle: 'full' });
    },

    getScheduleBadges(item) {
      const workunit = this.getWorkunit(item);
      const defs = [
        { key: 'due', label: 'due', icon: 'calendar-clock' },
        { key: 'estimateOptimistic', label: 'early', icon: 'timer-reset' },
        { key: 'estimateLikely', label: 'likely', icon: 'timer' },
        { key: 'estimatePessimistic', label: 'late', icon: 'clock-3' }
      ];

      return defs
        .map((def) => {
          const value = workunit?.[def.key];
          const relative = this.formatRelativeDate(value);
          const title = this.formatLongDate(value);
          if (!relative || !title) return null;
          return {
            key: def.key,
            label: def.label,
            icon: def.icon,
            relative,
            title
          };
        })
        .filter(Boolean);
    },

    getVisibleTags(item, limit = 3) {
      return this.getTags(item).slice(0, limit);
    },

    getVisibleStakeholders(item, limit = 2) {
      return this.getStakeholders(item).slice(0, limit);
    },

    getLaneDotClass(laneName) {
      const lane = String(laneName || '').trim().toLowerCase();
      if (lane === 'doing') return 'bg-amber-400';
      if (lane === 'done') return 'bg-green-400';
      return 'bg-blue-400';
    },

    getLaneCountClass(laneName) {
      const lane = String(laneName || '').trim().toLowerCase();
      if (lane === 'doing') return 'bg-amber-900/30 text-amber-300';
      if (lane === 'done') return 'bg-green-900/30 text-green-300';
      return 'bg-blue-900/30 text-blue-300';
    },

    getCardAccentClass(item) {
      const status = this.getStatus(item);
      if (status === 'running') return 'border-l-amber-500';
      if (status === 'success') return 'border-l-green-500';
      if (status === 'fail') return 'border-l-red-500';
      return 'border-l-blue-500';
    },

    getStatusChipClass(item) {
      const status = this.getStatus(item);
      if (status === 'running') return 'bg-amber-900/30 text-amber-300 border-amber-500/40';
      if (status === 'success') return 'bg-green-900/30 text-green-300 border-green-500/40';
      if (status === 'fail') return 'bg-red-900/30 text-red-300 border-red-500/40';
      return 'bg-blue-900/30 text-blue-300 border-blue-500/40';
    },

    getTags(item) {
      const tags = this.getWorkunit(item)?.tags;
      return Array.isArray(tags) ? tags : [];
    },

    isUrgent(item) {
      return this.getWorkunit(item)?.urgent === true;
    },

    isImportant(item) {
      return this.getWorkunit(item)?.important === true;
    },

    getStakeholders(item) {
      const stakeholders = this.getWorkunit(item)?.stakeholders;
      return Array.isArray(stakeholders) ? stakeholders : [];
    },

    getDependsOnCount(item) {
      const dependsOn = this.getWorkunit(item)?.dependsOn;
      return Array.isArray(dependsOn) ? dependsOn.length : 0;
    },

    getWorkerName(item) {
      const workunit = this.getWorkunit(item);
      const value = workunit?.worker;
      if (typeof value !== 'string') return '';
      return value.trim();
    },

    getWorkerInitials(item) {
      const name = this.getWorkerName(item);
      if (!name) return '';

      const cleaned = name.replace(/^@+/, '').trim();
      if (!cleaned) return '';

      const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
      if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
      }

      return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
    },

    getTaskSearchText(item) {
      const workunit = this.getWorkunit(item);
      return [
        item?._id,
        workunit?.id,
        workunit?.summary,
        workunit?.description,
        workunit?.status,
        ...(Array.isArray(workunit?.tags) ? workunit.tags : []),
        ...(Array.isArray(workunit?.stakeholders) ? workunit.stakeholders : []),
        typeof item?._markdownBody === 'string' ? item._markdownBody : ''
      ]
        .filter((part) => typeof part === 'string' || typeof part === 'number')
        .join(' ')
        .toLowerCase();
    },

    filteredTasks() {
      const store = Alpine.store('editor');
      const query = String(store.searchQuery || '').trim().toLowerCase();
      const items = this.taskInstances();
      if (!query) return items;
      return items.filter((item) => this.getTaskSearchText(item).includes(query));
    },

    tasksForLane(laneName) {
      const lane = String(laneName || '').trim().toLowerCase();
      return this.filteredTasks().filter((item) => this.getLane(item) === lane);
    },

    allVisibleTaskIds() {
      const ordered = [
        ...this.tasksForLane('todo'),
        ...this.tasksForLane('doing'),
        ...this.tasksForLane('done')
      ];
      return ordered.map((item) => item._id);
    },

    laneCount(laneName) {
      return this.tasksForLane(laneName).length;
    },

    ensureBoardSelectionIsValid() {
      const store = Alpine.store('editor');
      if (store.viewMode !== 'board') return;
      const validIds = new Set(this.allVisibleTaskIds());
      const nextSelected = (store.selectedRows || []).filter((id) => validIds.has(id));

      if (nextSelected.length === (store.selectedRows || []).length) return;

      store.selectedRows = nextSelected;
      store.selectedEntityId = nextSelected[0] || null;
      if (!store.selectedEntityId) this.selectionAnchorId = null;
      this.syncInspectorSelection(store);
    },

    syncInspectorSelection(store) {
      if (store.autoSelect !== true) return;
      store.inspectorSelectedRows = [...(store.selectedRows || [])];
      store.inspectorSelectedEntityId = store.selectedEntityId || store.inspectorSelectedRows[0] || null;
    },

    isSelected(itemId) {
      const store = Alpine.store('editor');
      return Array.isArray(store.selectedRows) && store.selectedRows.includes(itemId);
    },

    handleTaskPointerDown(event, itemId) {
      const store = Alpine.store('editor');
      const isRange = event.shiftKey === true;
      const isAdditive = event.ctrlKey === true || event.metaKey === true;
      const currentSelection = [...(store.selectedRows || [])];
      const isCurrentlySelected = currentSelection.includes(itemId);

      if (isRange) {
        const ids = this.allVisibleTaskIds();
        const anchorId = this.selectionAnchorId || store.selectedEntityId || currentSelection[0] || itemId;
        const anchorIndex = ids.indexOf(anchorId);
        const targetIndex = ids.indexOf(itemId);

        if (anchorIndex >= 0 && targetIndex >= 0) {
          const from = Math.min(anchorIndex, targetIndex);
          const to = Math.max(anchorIndex, targetIndex);
          const rangeIds = ids.slice(from, to + 1);
          const merged = new Set([...(store.selectedRows || []), ...rangeIds]);
          store.selectedRows = [...merged];
        } else {
          const merged = new Set([...(store.selectedRows || []), itemId]);
          store.selectedRows = [...merged];
        }

        store.selectedEntityId = itemId;
        this.syncInspectorSelection(store);
        return;
      }

      if (isAdditive) {
        if (isCurrentlySelected) {
          store.selectedRows = currentSelection.filter((id) => id !== itemId);
          store.selectedEntityId = store.selectedRows[0] || null;
          if (this.selectionAnchorId === itemId) {
            this.selectionAnchorId = store.selectedEntityId || null;
          }
        } else {
          const merged = new Set([...(store.selectedRows || []), itemId]);
          store.selectedRows = [...merged];
          store.selectedEntityId = itemId;
          this.selectionAnchorId = itemId;
        }

        this.syncInspectorSelection(store);
        return;
      }

      if (isCurrentlySelected && currentSelection.length === 1) {
        store.selectedRows = [];
        store.selectedEntityId = null;
        this.selectionAnchorId = null;
        this.syncInspectorSelection(store);
        return;
      }

      store.selectedRows = [itemId];
      store.selectedEntityId = itemId;
      this.selectionAnchorId = itemId;
      this.syncInspectorSelection(store);
    }
  };
}

window.GDEditBoard = {
  boardView
};
