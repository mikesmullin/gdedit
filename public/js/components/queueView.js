/**
 * Queue View Component
 * Renders actionable queue cards backed by Queue class instances
 */

function queueView() {
  return {
    selectionAnchorId: null,
    otherInputById: {},
    selectedChoiceIdsByItem: {},

    init() {
      this.$watch('$store.editor.viewMode', (mode) => {
        if (mode !== 'queue') return;
        this.ensureQueueSelectionIsValid();
      });

      this.$watch('$store.editor.instances', () => {
        const store = Alpine.store('editor');
        if (store.viewMode !== 'queue') return;
        this.ensureQueueSelectionIsValid();
      });
    },

    isQueueClass(className) {
      const normalized = String(className || '').trim().toLowerCase();
      return normalized === 'queue';
    },

    getNotificationData(item) {
      const notification = item?.components?.notification;
      if (notification && typeof notification === 'object' && !Array.isArray(notification)) {
        return notification;
      }
      return {};
    },

    getNotificationField(item, fieldName) {
      const notification = this.getNotificationData(item);
      if (notification[fieldName] !== undefined) {
        return notification[fieldName];
      }
      return item?.[fieldName];
    },

    queueInstances() {
      const store = Alpine.store('editor');
      const instances = Array.isArray(store.instances) ? store.instances : [];
      const queueItems = instances.filter((instance) => this.isQueueClass(instance?._class));

      return queueItems
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          const aTs = this.getSortTimestamp(a.item);
          const bTs = this.getSortTimestamp(b.item);
          if (aTs !== bTs) return bTs - aTs;
          return b.index - a.index;
        })
        .map((entry) => entry.item);
    },

    filteredQueueInstances() {
      const store = Alpine.store('editor');
      const items = this.queueInstances().filter((item) => !this.hasFormalResponse(item));
      const query = String(store.searchQuery || '').trim();
      if (!query) return items;

      const q = query.toLowerCase();
      return items.filter((item) => this.getSearchText(item).includes(q));
    },

    getSortTimestamp(item) {
      const candidates = [
        this.getNotificationField(item, 'created'),
        this.getNotificationField(item, 'createdAt'),
        this.getNotificationField(item, 'timestamp'),
        this.getNotificationField(item, 'updated'),
        this.getNotificationField(item, 'updatedAt')
      ];

      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') continue;
        const date = new Date(candidate);
        if (!Number.isNaN(date.getTime())) return date.getTime();
      }

      return 0;
    },

    getSearchText(item) {
      const card = this.getCardData(item);
      const actionLabelText = this.getCardActions(item).map((a) => `${a.key} ${a.label}`).join(' ');
      const choiceText = Array.isArray(card?.choices)
        ? card.choices.map((choice) => `${choice?.id || ''} ${choice?.label || ''}`).join(' ')
        : '';
      const notification = this.getNotificationData(item);

      return [
        item?._id,
        item?._class,
        this.getNotificationField(item, 'summary'),
        this.getNotificationField(item, 'body'),
        this.getMarkdownBodyText(item),
        this.getNotificationField(item, 'urgency'),
        this.getNotificationField(item, 'timeout'),
        this.getNotificationField(item, 'await'),
        card?.type,
        card?.question,
        actionLabelText,
        choiceText,
        JSON.stringify(notification)
      ]
        .filter((part) => typeof part === 'string' || typeof part === 'number')
        .join(' ')
        .toLowerCase();
    },

    ensureQueueSelectionIsValid() {
      const store = Alpine.store('editor');
      if (store.viewMode !== 'queue') return;
      const queueIds = new Set(this.filteredQueueInstances().map((item) => item._id));
      const nextSelected = (store.selectedRows || []).filter((id) => queueIds.has(id));

      if (nextSelected.length === (store.selectedRows || []).length) return;

      store.selectedRows = nextSelected;
      store.selectedEntityId = nextSelected[0] || null;
      if (!store.selectedEntityId) {
        this.selectionAnchorId = null;
      }
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

    handleCardPointerDown(event, itemId) {
      const store = Alpine.store('editor');
      const isRange = event.shiftKey === true;
      const isAdditive = event.ctrlKey === true || event.metaKey === true;
      const currentSelection = [...(store.selectedRows || [])];
      const isCurrentlySelected = currentSelection.includes(itemId);

      if (isRange) {
        const ids = this.filteredQueueInstances().map((item) => item._id);
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
    },

    getCardData(item) {
      if (!item || typeof item !== 'object') return null;
      const cardField = this.getNotificationField(item, 'card');
      if (cardField && typeof cardField === 'object') return cardField;

      const bodyField = this.getNotificationField(item, 'body');
      if (typeof bodyField === 'string') {
        try {
          const parsed = JSON.parse(bodyField);
          if (parsed?.xnotid_card === 'v1' && parsed?.type) {
            return parsed;
          }
        } catch {
          // Ignore non-JSON body
        }
      }

      return null;
    },

    hasFormalResponse(item) {
      const response = this.getNotificationField(item, 'response');
      if (response === undefined || response === null) return false;
      if (typeof response === 'string') return response.trim().length > 0;
      if (Array.isArray(response)) return response.length > 0;
      if (typeof response === 'object') return Object.keys(response).length > 0;
      return true;
    },

    getCardSummary(item) {
      return String(this.getNotificationField(item, 'summary') || 'Queue item');
    },

    getCardBody(item) {
      const card = this.getCardData(item);
      if (this.hasStructuredCard(item)) return '';
      const body = this.getNotificationField(item, 'body');
      if (card?.question && !body) return String(card.question);

      if (typeof body === 'string') return body;
      if (body === undefined || body === null) return '';

      try {
        return JSON.stringify(body, null, 2);
      } catch {
        return String(body);
      }
    },

    getMarkdownBodyText(item) {
      const raw = typeof item?._markdownBody === 'string' ? item._markdownBody : '';
      const trimmed = raw.trim();
      if (!trimmed) return '';

      const placeholder = `# Queue/${String(item?._id || '').trim()}`;
      if (trimmed === placeholder) return '';

      return raw;
    },

    getRenderedMarkdownBody(item) {
      const markdown = this.getMarkdownBodyText(item);
      if (!markdown) return '';

      try {
        if (window.marked?.parse) {
          return window.marked.parse(markdown);
        }
      } catch (error) {
        console.error('Failed to render queue markdown body:', error);
      }

      const escaped = markdown
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      return `<pre>${escaped}</pre>`;
    },

    hasStructuredCard(item) {
      const card = this.getCardData(item);
      return card?.type === 'multiple-choice' || card?.type === 'permission';
    },

    hasExplicitActions(item) {
      return this.normalizeActions(this.getNotificationField(item, 'actions')).length > 0;
    },

    getCardQuestion(item) {
      const card = this.getCardData(item);
      if (!card?.question) return '';
      return String(card.question);
    },

    getMultipleChoiceChoices(item) {
      const card = this.getCardData(item);
      if (card?.type !== 'multiple-choice') return [];

      return (Array.isArray(card.choices) ? card.choices : [])
        .map((choice) => {
          const key = String(choice?.id || '').trim();
          const label = String(choice?.label || key).trim() || key;
          if (!key) return null;
          return { key, label };
        })
        .filter(Boolean);
    },

    getAllowOther(item) {
      const card = this.getCardData(item);
      return card?.type === 'multiple-choice' && card?.allow_other === true;
    },

    shouldShowOtherInput(item) {
      return this.getAllowOther(item) && !this.hasExplicitActions(item);
    },

    isMultipleChoiceCard(item) {
      const card = this.getCardData(item);
      return card?.type === 'multiple-choice';
    },

    getOtherInput(itemId) {
      return String(this.otherInputById[itemId] || '');
    },

    setOtherInput(itemId, value) {
      this.otherInputById[itemId] = String(value || '');
    },

    getSelectedChoiceIds(itemId) {
      const value = this.selectedChoiceIdsByItem[itemId];
      return Array.isArray(value) ? value : [];
    },

    isMultipleChoiceActionSelected(itemId, actionKey) {
      return this.getSelectedChoiceIds(itemId).includes(actionKey);
    },

    toggleMultipleChoiceAction(event, item, action) {
      event.preventDefault();
      event.stopPropagation();

      const itemId = item?._id;
      if (!itemId) return;

      const current = new Set(this.getSelectedChoiceIds(itemId));
      if (current.has(action.key)) {
        current.delete(action.key);
      } else {
        current.add(action.key);
      }

      this.selectedChoiceIdsByItem[itemId] = [...current];
    },

    normalizeActions(actionsField) {
      if (!actionsField) return [];

      if (Array.isArray(actionsField)) {
        return actionsField
          .map((entry) => {
            if (typeof entry === 'string') {
              const [key, label] = entry.split(':');
              const safeKey = String(key || '').trim();
              if (!safeKey) return null;
              return { key: safeKey, label: String(label || safeKey).trim() || safeKey };
            }

            if (entry && typeof entry === 'object') {
              const [key, label] = Object.entries(entry)[0] || [];
              const safeKey = String(key || '').trim();
              if (!safeKey) return null;
              return { key: safeKey, label: String(label || safeKey).trim() || safeKey };
            }

            return null;
          })
          .filter(Boolean);
      }

      if (actionsField && typeof actionsField === 'object') {
        return Object.entries(actionsField)
          .map(([key, label]) => {
            const safeKey = String(key || '').trim();
            if (!safeKey) return null;
            return { key: safeKey, label: String(label || safeKey).trim() || safeKey };
          })
          .filter(Boolean);
      }

      return [];
    },

    getCardActions(item) {
      const explicitActions = this.normalizeActions(this.getNotificationField(item, 'actions'));
      if (explicitActions.length > 0) return explicitActions;

      const card = this.getCardData(item);
      if (!card || !card.type) {
        return [{ key: 'dismiss', label: 'Dismiss' }];
      }

      if (card.type === 'multiple-choice') {
        return this.getMultipleChoiceChoices(item);
      }

      if (card.type === 'permission') {
        return [{ key: 'allow', label: String(card.allow_label || 'Allow') }];
      }

      return [{ key: 'dismiss', label: 'Dismiss' }];
    },

    getCardTypeLabel(item) {
      const card = this.getCardData(item);
      if (!card?.type) return 'notification';
      return String(card.type);
    },

    dispatchQueueAction(item, action, extra = {}) {
      const detail = {
        id: item?._id,
        className: item?._class,
        action: action?.key,
        label: action?.label,
        item,
        ...extra
      };

      window.dispatchEvent(new CustomEvent('gdedit:queue-action', { detail }));
      window.dispatchEvent(new CustomEvent('gdedit:toast', {
        detail: `Queued action: ${action?.label || action?.key || 'unknown'} (${item?._id || 'item'})`
      }));
    },

    buildActionResponse(action, extra = {}) {
      return {
        kind: 'action',
        action: action?.key || null,
        label: action?.label || null,
        respondedAt: new Date().toISOString(),
        ...extra
      };
    },

    async persistFormalResponse(item, responsePayload) {
      const itemId = String(item?._id || '').trim();
      if (!itemId) return false;

      try {
        const res = await fetch(`/api/instances/${encodeURIComponent(itemId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            columnId: 'notification.response',
            value: responsePayload
          })
        });

        if (!res.ok) {
          throw new Error(`Failed with status ${res.status}`);
        }

        const updated = await res.json().catch(() => null);
        const store = Alpine.store('editor');
        const idx = (store.instances || []).findIndex((instance) => instance?._id === itemId);
        if (idx >= 0) {
          if (updated && typeof updated === 'object') {
            store.instances.splice(idx, 1, updated);
          } else {
            const current = store.instances[idx] || {};
            const next = {
              ...current,
              components: {
                ...(current.components || {}),
                notification: {
                  ...((current.components || {}).notification || {}),
                  response: responsePayload
                }
              }
            };
            store.instances.splice(idx, 1, next);
          }
        }

        this.ensureQueueSelectionIsValid();
        
        // Notify app to update pending queue count
        window.dispatchEvent(new CustomEvent('gdedit:queue-updated'));
        
        return true;
      } catch (error) {
        console.error('Failed to persist queue response:', error);
        window.dispatchEvent(new CustomEvent('gdedit:toast', {
          detail: `Failed to record response (${itemId})`
        }));
        return false;
      }
    },

    async submitMultipleChoice(event, item) {
      event.preventDefault();
      event.stopPropagation();

      const choicesById = new Map(
        this.getCardActions(item).map((choice) => [choice.key, choice.label])
      );

      const selectedIds = this.getSelectedChoiceIds(item._id)
        .filter((id) => choicesById.has(id));
      const selected = selectedIds.map((id) => ({ id, label: choicesById.get(id) || id }));

      const otherText = this.getAllowOther(item)
        ? this.getOtherInput(item._id).trim()
        : '';

      if (selected.length === 0 && !otherText) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', {
          detail: `Select at least one option before submitting (${item?._id || 'item'})`
        }));
        return;
      }

      const payload = {
        type: 'multiple-choice',
        selected,
        other: otherText || null
      };

      const responsePayload = {
        kind: 'multiple-choice',
        selected,
        other: otherText || null,
        respondedAt: new Date().toISOString()
      };

      const saved = await this.persistFormalResponse(item, responsePayload);
      if (!saved) return;

      this.dispatchQueueAction(item, {
        key: JSON.stringify(payload),
        label: 'Submit'
      }, {
        cardType: 'multiple-choice',
        payload,
        selected,
        otherText: otherText || null
      });
    },

    async handleActionClick(event, item, action) {
      event.preventDefault();
      event.stopPropagation();

      const responsePayload = this.buildActionResponse(action);
      const saved = await this.persistFormalResponse(item, responsePayload);
      if (!saved) return;

      this.dispatchQueueAction(item, action);
    }
  };
}

window.GDEditQueue = {
  queueView
};
