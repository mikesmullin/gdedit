/**
 * Chat Component - wasm1 step-wise chat sidebar
 * Uses session snapshots from server (YAML parsed on server) as source of truth.
 */

document.addEventListener('alpine:init', () => {
  Alpine.store('chat', {
    tabs: [{
      id: 1,
      name: 'Chat 1',
      messages: [],
      session: null,
      sessionId: null,
      sessionFile: null,
      sessionStatus: 'IDLE',
      isNew: true,
      isWaiting: false,
      stopAttempts: 0
    }],
    activeTabId: 1,
    nextTabId: 2,
    isOpen: true,
    config: {
      agents: {},
      models: [],
      modes: [],
      defaultAgent: 'ontologist',
      command: ''
    }
  });
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureSessionShape(tab) {
  if (!tab.session || typeof tab.session !== 'object') {
    tab.session = {
      apiVersion: 'daemon/v1',
      kind: 'AgentSession',
      metadata: { status: 'IDLE' },
      spec: { system_prompt: '', messages: [] }
    };
  }
  if (!tab.session.metadata || typeof tab.session.metadata !== 'object') {
    tab.session.metadata = { status: 'IDLE' };
  }
  if (!tab.session.spec || typeof tab.session.spec !== 'object') {
    tab.session.spec = { system_prompt: '', messages: [] };
  }
  if (!Array.isArray(tab.session.spec.messages)) {
    tab.session.spec.messages = [];
  }
}

function normalizeVerbatimArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'string') {
    try {
      return JSON.parse(rawArgs);
    } catch {
      return { raw: rawArgs };
    }
  }
  return rawArgs;
}

function mapSessionToMessages(tab) {
  ensureSessionShape(tab);
  const out = [];
  const messages = tab.session.spec.messages || [];

  for (let index = 0; index < messages.length; index++) {
    const entry = messages[index] || {};
    const role = entry.role || 'unknown';
    const verbatim = entry.verbatim || {};
    const meta = entry.meta || {};
    const rawTs = verbatim.timestamp || meta.timestamp || null;
    const timestamp = rawTs
      ? (isNaN(Number(rawTs)) ? rawTs : new Date(Number(rawTs)).toISOString())
      : new Date().toISOString();

    const base = {
      id: `${index}-${Date.now()}-${Math.random()}`,
      timestamp,
      isVisible: meta.visible !== false,
      sessionRef: { entryIndex: index }
    };

    if (role === 'user') {
      out.push({ ...base, role: 'user', content: String(verbatim.content || '') });
      continue;
    }

    if (role === 'assistant') {
      const hasText = typeof verbatim.content === 'string' && verbatim.content.trim().length > 0;
      if (hasText) {
        out.push({
          ...base,
          role: 'assistant',
          content: verbatim.content,
          finishReason: verbatim.finish_reason || null
        });
      }

      if (Array.isArray(verbatim.tool_calls) && verbatim.tool_calls.length > 0) {
        const callMetaMap = meta.calls && typeof meta.calls === 'object' ? meta.calls : {};
        for (const call of verbatim.tool_calls) {
          const callId = call?.id || `call-${Math.random()}`;
          const fn = call?.function || {};
          const approval = callMetaMap?.[callId]?.approval || null;
          const callSent = callMetaMap?.[callId]?.sent === true;
          out.push({
            ...base,
            id: `${index}-${callId}`,
            role: 'tool_call',
            toolName: fn?.name || call?.name || 'tool_call',
            arguments: normalizeVerbatimArguments(fn?.arguments || call?.arguments || {}),
            approvalStatus: approval?.status || 'pending',
            sent: callSent,
            content: '',
            sessionRef: { entryIndex: index, callId }
          });
        }
      }

      continue;
    }

    if (role === 'tool') {
      const approval = meta.approval || null;
      out.push({
        ...base,
        role: 'tool_result',
        toolName: verbatim.name || 'tool_result',
        toolCallId: verbatim.tool_call_id || null,
        content: String(verbatim.content || ''),
        status: approval?.status === 'rejected' ? 'rejected' : 'success',
        approvalStatus: approval?.status || 'pending',
        sent: meta.sent === true,
        sessionRef: { entryIndex: index }
      });

      continue;
    }

  }

  return out;
}

function dispatchSessionMutated(tabId) {
  window.dispatchEvent(new CustomEvent('chat:session-mutated', { detail: { tabId } }));
}

function chatSidebar() {
  return {
    ws: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,

    async init() {
      await this.loadChatConfig();
      this.connectWebSocket();
      window.addEventListener('chat:session-mutated', (event) => {
        const tabId = event?.detail?.tabId;
        if (tabId == null) return;
        this.persistSession(tabId);
      });
    },

    async loadChatConfig() {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (config.chat) {
          Alpine.store('chat').config = config.chat;
        }
      } catch (e) {
        console.error('Failed to load chat config:', e);
      }
    },

    connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'storage-changed') {
          window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Files changed, reloading...' }));
          window.dispatchEvent(new CustomEvent('gdedit:reload'));
          return;
        }
        this.handleMessage(data);
      };

      this.ws.onclose = () => this.scheduleReconnect();
      this.ws.onerror = (err) => console.error('Chat WebSocket error:', err);
    },

    scheduleReconnect() {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        setTimeout(() => this.connectWebSocket(), delay);
      }
    },

    getTab(tabId) {
      return Alpine.store('chat').tabs.find((t) => t.id === tabId) || null;
    },

    handleMessage(data) {
      const tab = this.getTab(data.tabId);
      if (!tab) return;

      switch (data.type) {
        case 'session-snapshot': {
          tab.session = data.session ? cloneJson(data.session) : null;
          tab.sessionId = data.sessionId || tab.sessionId || tab.session?.metadata?.id || null;
          tab.sessionFile = data.sessionFile || tab.sessionFile || null;
          tab.sessionStatus = data.sessionStatus || tab.session?.metadata?.status || 'IDLE';
          tab.messages = mapSessionToMessages(tab);
          tab.isWaiting = false;
          tab.stopAttempts = 0;
          tab.isNew = false;
          window.dispatchEvent(new CustomEvent('chat:newMessage'));
          break;
        }
        case 'session-saved':
          break;
        case 'error':
          tab.messages.push({
            id: `err-${Date.now()}-${Math.random()}`,
            role: 'error',
            content: data.content || 'Unknown chat error',
            timestamp: new Date().toISOString(),
            isVisible: true
          });
          tab.isWaiting = false;
          tab.stopAttempts = 0;
          window.dispatchEvent(new CustomEvent('chat:newMessage'));
          break;
        case 'done':
          tab.isWaiting = false;
          tab.stopAttempts = 0;
          break;
        case 'stop-ack':
          if (data.noProcess) {
            tab.isWaiting = false;
            tab.stopAttempts = 0;
          } else {
            tab.stopAttempts = data.attempt || 0;
          }
          break;
      }
    },

    persistSession(tabId) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const tab = this.getTab(tabId);
      if (!tab || !tab.session) return;
      this.ws.send(JSON.stringify({
        type: 'session-update',
        tabId,
        sessionFile: tab.sessionFile,
        session: tab.session
      }));
    },

    sendStart(tabId, content, agentName) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const tab = this.getTab(tabId);
      if (!tab) return;

      const editorStore = Alpine.store('editor');
      const viewMode = editorStore?.viewMode || 'table';
      const instances = editorStore?.instances || [];
      let selection = [];

      if (viewMode === 'graph') {
        const graphApi = window.__alpineFlow?.default;
        if (graphApi) {
          const selectedNodes = graphApi.getSelectedNodes() || [];
          selection = selectedNodes.map((node) => ({
            id: node.id,
            class: node.type,
            source: 'graph'
          }));
        }
      } else {
        const selectedRows = editorStore?.selectedRows || [];
        selection = selectedRows.map((id) => {
          const instance = instances.find((i) => i._id === id);
          return instance
            ? { id: instance._id, class: instance._class, source: 'table' }
            : { id, class: 'Unknown', source: 'table' };
        });
      }

      tab.isWaiting = true;
      tab.stopAttempts = 0;
      tab.isNew = false;

      this.ws.send(JSON.stringify({
        type: 'chat-start',
        tabId,
        content,
        agent: agentName,
        selection
      }));
    },

    sendContinue(tabId) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const tab = this.getTab(tabId);
      if (!tab || !tab.sessionId) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'No active session to continue yet' }));
        return;
      }
      tab.isWaiting = true;
      tab.stopAttempts = 0;
      this.ws.send(JSON.stringify({
        type: 'chat-continue',
        tabId,
        sessionId: tab.sessionId
      }));
    },

    abortRequest(tabId) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: 'abort', tabId }));
    },

    get tabs() {
      return Alpine.store('chat').tabs;
    },

    get activeTabId() {
      return Alpine.store('chat').activeTabId;
    },

    get activeTab() {
      return this.tabs.find((t) => t.id === this.activeTabId);
    },

    get isOpen() {
      return Alpine.store('chat').isOpen;
    },

    toggleSidebar() {
      Alpine.store('chat').isOpen = !Alpine.store('chat').isOpen;
    }
  };
}

function chatTabs() {
  return {
    setActiveTab(tabId) {
      Alpine.store('chat').activeTabId = tabId;
    },

    createNewTab() {
      const store = Alpine.store('chat');
      const tabNum = store.nextTabId;
      const newTab = {
        id: store.nextTabId++,
        name: `Chat ${tabNum}`,
        messages: [],
        session: null,
        sessionId: null,
        sessionFile: null,
        sessionStatus: 'IDLE',
        isNew: true,
        isWaiting: false,
        stopAttempts: 0
      };
      store.tabs.push(newTab);
      store.activeTabId = newTab.id;
    },

    closeTab(tabId) {
      const store = Alpine.store('chat');
      const idx = store.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;

      if (store.tabs.length === 1) {
        this.createNewTab();
      }

      store.tabs.splice(idx, 1);
      if (store.activeTabId === tabId) {
        store.activeTabId = store.tabs[Math.min(idx, store.tabs.length - 1)].id;
      }
    },

    get tabs() {
      return Alpine.store('chat').tabs;
    },

    get activeTabId() {
      return Alpine.store('chat').activeTabId;
    },

    isActive(tabId) {
      return this.activeTabId === tabId;
    },

    canClose() {
      return true;
    }
  };
}

function chatInput() {
  return {
    inputText: '',
    selectedAgent: null,
    attachedFiles: [],
    showAgentPill: false,

    init() {
      this.selectedAgent = null;
    },

    get activeTab() {
      const store = Alpine.store('chat');
      return store.tabs.find((t) => t.id === store.activeTabId) || null;
    },

    get isWaiting() {
      return this.activeTab?.isWaiting || false;
    },

    get stopAttempts() {
      return this.activeTab?.stopAttempts || 0;
    },

    get buttonState() {
      if (this.isWaiting) return 'stop';
      if ((this.inputText || '').trim().length > 0) return 'send';
      return 'step';
    },

    handleInput(e) {
      const text = e.target.value;
      if (text.startsWith('@') && !this.showAgentPill) {
        const match = text.match(/^@(\w+)\s/);
        if (match) {
          const agentName = match[1];
          const agents = Alpine.store('chat')?.config?.agents || {};
          if (agents[agentName]) {
            this.selectedAgent = agentName;
            this.showAgentPill = true;
            this.inputText = text.slice(match[0].length);
            return;
          }
        }
      }
      this.inputText = text;
    },

    removeAgentPill() {
      this.showAgentPill = false;
      this.selectedAgent = null;
    },

    attachFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = (e) => {
        for (const file of e.target.files) {
          this.attachedFiles.push({ name: file.name, file });
        }
      };
      input.click();
    },

    removeFile(index) {
      this.attachedFiles.splice(index, 1);
    },

    submit() {
      if (this.buttonState === 'stop') {
        this.abort();
        return;
      }

      const tab = this.activeTab;
      if (!tab) return;
      const sidebar = document.querySelector('[x-data*="chatSidebar"]');
      const sidebarData = sidebar?._x_dataStack?.[0];
      if (!sidebarData) return;

      if (this.buttonState === 'send') {
        tab.messages.push({
          id: `pending-user-${Date.now()}-${Math.random()}`,
          role: 'user',
          content: this.inputText,
          timestamp: new Date().toISOString(),
          isVisible: true,
          sessionRef: null
        });
        window.dispatchEvent(new CustomEvent('chat:newMessage'));

        sidebarData.sendStart(tab.id, this.inputText, this.selectedAgent);
        this.inputText = '';
        this.attachedFiles = [];
        return;
      }

      sidebarData.sendContinue(tab.id);
    },

    abort() {
      const tab = this.activeTab;
      if (!tab) return;
      const sidebar = document.querySelector('[x-data*="chatSidebar"]');
      const sidebarData = sidebar?._x_dataStack?.[0];
      if (!sidebarData) return;
      sidebarData.abortRequest(tab.id);
    }
  };
}

function findTabMessageById(messageId) {
  const store = Alpine.store('chat');
  for (const tab of store.tabs) {
    const message = tab.messages.find((m) => m.id === messageId);
    if (message) return { tab, message };
  }
  return null;
}

function chatHistory() {
  return {
    autoScroll: true,
    lastMessageCount: 0,

    init() {
      this.$watch('messages', (msgs) => {
        if (msgs.length > this.lastMessageCount && this.autoScroll) {
          this.$nextTick(() => this.scrollToBottom());
        }
        this.lastMessageCount = msgs.length;
      });

      this.$watch('isWaiting', () => {
        if (this.autoScroll) {
          this.$nextTick(() => this.scrollToBottom());
        }
      });

      window.addEventListener('chat:newMessage', () => {
        if (this.autoScroll) {
          this.$nextTick(() => this.scrollToBottom());
        }
      });

      if (window.__gdeditChatMutationHandlers) {
        const prev = window.__gdeditChatMutationHandlers;
        window.removeEventListener('chat:message-edit', prev.onEdit);
        window.removeEventListener('chat:message-visibility', prev.onVisibility);
      }

      const onEdit = (event) => this.saveMessageEdit(event.detail?.messageId, event.detail?.newContent);
      const onVisibility = (event) => this.toggleMessageVisibility(event.detail?.messageId);

      window.addEventListener('chat:message-edit', onEdit);
      window.addEventListener('chat:message-visibility', onVisibility);
      window.__gdeditChatMutationHandlers = { onEdit, onVisibility };
    },

    handleScroll(event) {
      const el = event.target;
      const threshold = 50;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      this.autoScroll = atBottom;
    },

    scrollToBottom() {
      this.$el.scrollTop = this.$el.scrollHeight;
    },

    get activeTab() {
      const store = Alpine.store('chat');
      return store.tabs.find((t) => t.id === store.activeTabId) || null;
    },

    get messages() {
      return this.activeTab?.messages || [];
    },

    get isNew() {
      return this.activeTab?.isNew || false;
    },

    get isWaiting() {
      return this.activeTab?.isWaiting || false;
    },

    applyEntryMutation(tab, entryIndex, mutator) {
      ensureSessionShape(tab);
      const entry = tab.session.spec.messages?.[entryIndex];
      if (!entry) return false;
      mutator(entry);
      dispatchSessionMutated(tab.id);
      return true;
    },

    saveMessageEdit(messageId, newContent) {
      if (!messageId || typeof newContent !== 'string') return;
      const located = findTabMessageById(messageId);
      if (!located) return;
      const { tab, message } = located;
      const ref = message.sessionRef;
      if (!ref || typeof ref.entryIndex !== 'number') return;

      const ok = this.applyEntryMutation(tab, ref.entryIndex, (entry) => {
        entry.verbatim = entry.verbatim || {};
        entry.meta = entry.meta || {};

        if (ref.callId) {
          entry.meta.calls = entry.meta.calls || {};
          const callState = entry.meta.calls[ref.callId] || {};
          callState.approval = callState.approval || {};
          let parsedArgs = null;
          try {
            parsedArgs = JSON.parse(newContent);
          } catch {
            window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Invalid JSON for tool-call args' }));
            return;
          }
          callState.approval.status = 'modified';
          callState.approval.modified_args = parsedArgs;
          callState.approval.reviewed_at = new Date().toISOString();
          callState.sent = true;
          entry.meta.calls[ref.callId] = callState;
          message.arguments = callState.approval.modified_args;
          return;
        }

        if (message.role === 'tool_result') {
          entry.meta.approval = entry.meta.approval || {};
          entry.meta.approval.status = 'modified';
          entry.meta.approval.modified_content = newContent;
          entry.meta.approval.reviewed_at = new Date().toISOString();
          entry.meta.sent = true;
          message.content = newContent;
          return;
        }

        entry.verbatim.content = newContent;
        message.content = newContent;
      });

      if (ok) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Message updated' }));
      }
    },

    toggleMessageVisibility(messageId) {
      if (!messageId) return;
      const located = findTabMessageById(messageId);
      if (!located) return;
      const { tab, message } = located;
      const ref = message.sessionRef;
      if (!ref || typeof ref.entryIndex !== 'number') return;

      let nextVisible = true;
      const ok = this.applyEntryMutation(tab, ref.entryIndex, (entry) => {
        entry.meta = entry.meta || {};
        const current = entry.meta.visible !== false;
        nextVisible = !current;
        entry.meta.visible = nextVisible;
        message.isVisible = nextVisible;
      });

      if (ok) {
        window.dispatchEvent(new CustomEvent('gdedit:toast', {
          detail: nextVisible ? 'Message included in next inference' : 'Message hidden from next inference'
        }));
      }
    }
  };
}

function chatTitleCard() {
  return {
    logo: ` ██████╗ ██████╗ ███████╗██████╗ ██╗████████╗
██╔════╝ ██╔══██╗██╔════╝██╔══██╗██║╚══██╔══╝
██║  ███╗██║  ██║█████╗  ██║  ██║██║   ██║
██║   ██║██║  ██║██╔══╝  ██║  ██║██║   ██║
╚██████╔╝██████╔╝███████╗██████╔╝██║   ██║
 ╚═════╝ ╚═════╝ ╚══════╝╚═════╝ ╚═╝   ╚═╝
              AI Assistant`.trimEnd(),
    tips: [
      'Use Send to start a new session with prompt text',
      'Use Step to continue an existing session',
      'Edit or hide cards to mutate the context window'
    ]
  };
}

function chatGettingStarted() {
  return {
    prompts: [
      { icon: 'layout-grid', text: 'Show me a summary of all game entities' },
      { icon: 'scale', text: 'Help me balance the damage values for weapons' },
      { icon: 'search', text: 'Find entities with missing required fields' }
    ],

    usePrompt(prompt) {
      const inputEl = document.querySelector('[x-data*="chatInput"]');
      const inputData = inputEl?._x_dataStack?.[0];
      if (!inputData) return;
      inputData.inputText = prompt.text;
      inputData.submit();
    }
  };
}

function chatEllipsis() {
  return {
    dots: '...',
    interval: null,
    init() {
      let count = 0;
      this.interval = setInterval(() => {
        count = (count + 1) % 4;
        this.dots = '.'.repeat(count || 1);
      }, 400);
    },
    destroy() {
      if (this.interval) clearInterval(this.interval);
    }
  };
}

function chatMessageCard(message) {
  return {
    message,
    showActions: false,
    isEditing: false,
    draftContent: '',
    suppressBlurSave: false,

    get isUser() { return this.message.role === 'user'; },
    get isAssistant() { return this.message.role === 'assistant' || this.message.role === 'final'; },
    get isError() { return this.message.role === 'error'; },
    get isToolCall() { return this.message.role === 'tool_call'; },
    get isToolResult() { return this.message.role === 'tool_result'; },
    get isLog() { return this.message.role === 'log'; },
    get isPerf() { return this.message.role === 'perf'; },

    get canMutate() { return !!this.message.sessionRef; },
    get canEdit() { return this.canMutate && ['user', 'assistant', 'tool_call', 'tool_result'].includes(this.message.role); },
    get canCopy() { return this.copyPayload.length > 0; },
    get isVisible() { return this.message.isVisible !== false; },
    get actionAlignmentClass() { return 'justify-end'; },

    get editableContent() {
      if (this.isToolCall) return JSON.stringify(this.message.arguments || {}, null, 2);
      if (typeof this.message.content === 'string') return this.message.content;
      return '';
    },

    get copyPayload() {
      if (this.isToolCall) return JSON.stringify(this.message.arguments || {}, null, 2);
      if (typeof this.message.content === 'string') return this.message.content;
      return '';
    },

    getMessageClasses() {
      return {
        'chat-message-user': this.isUser,
        'chat-message-assistant': this.isAssistant,
        'chat-message-error': this.isError,
        'chat-message-tool': this.isToolCall || this.isToolResult,
        'chat-message-log': this.isLog,
        'chat-message-perf': this.isPerf,
        'chat-message-hidden': !this.isVisible
      };
    },

    get timestamp() {
      if (!this.message.timestamp) return '';
      const d = new Date(this.message.timestamp);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    renderMarkdown(content) {
      if (!content) return '';
      if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
        return marked.parse(content);
      }
      return String(content)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    },

    formatPerfStats(stats) {
      if (!stats) return '';
      const parts = [];
      if (stats.duration_s) parts.push(`${Number(stats.duration_s).toFixed(2)}s`);
      if (stats.tokens) parts.push(`${stats.tokens} tokens`);
      if (stats.tokens_s) parts.push(`${Number(stats.tokens_s).toFixed(1)} tok/s`);
      if (stats['tokens/s']) parts.push(`${Number(stats['tokens/s']).toFixed(1)} tok/s`);
      return parts.join(' · ');
    },

    startEdit() {
      if (!this.canEdit) return;
      this.draftContent = this.editableContent;
      this.isEditing = true;
      this.$nextTick(() => {
        const textarea = this.$refs.editor;
        if (textarea) textarea.focus();
      });
    },

    queueCancelFromClick() { this.suppressBlurSave = true; },
    cancelEdit() {
      this.isEditing = false;
      this.draftContent = '';
      this.suppressBlurSave = false;
    },
    cancelEditFromKeyboard() { this.cancelEdit(); },

    saveEdit() {
      if (!this.isEditing) return;
      window.dispatchEvent(new CustomEvent('chat:message-edit', {
        detail: { messageId: this.message.id, newContent: this.draftContent }
      }));
      this.isEditing = false;
      this.draftContent = '';
      this.suppressBlurSave = false;
    },

    onEditorBlur() {
      if (this.suppressBlurSave) {
        this.suppressBlurSave = false;
        return;
      }
      this.saveEdit();
    },

    toggleVisibility() {
      if (!this.canMutate) return;
      window.dispatchEvent(new CustomEvent('chat:message-visibility', {
        detail: { messageId: this.message.id }
      }));
    },

    async copyCurrentMessage() {
      if (!this.canCopy) return;
      try {
        await navigator.clipboard.writeText(this.copyPayload);
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Copied to clipboard' }));
      } catch {
        window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: 'Failed to copy' }));
      }
    }
  };
}

function chatReviewChanges() {
  return {
    isExpanded: false,
    activeView: 'this',
    activeFilter: 'all',
    changes: { thisAction: 0, allActions: 0, hardCoded: 0, formulas: 0, items: [] },
    toggle() { this.isExpanded = !this.isExpanded; },
    accept() {},
    alwaysAccept() {},
    revert() {}
  };
}

function chatTaskList() {
  return {
    isExpanded: false,
    tasks: [],
    get completedCount() { return this.tasks.filter((t) => t.completed).length; },
    get totalCount() { return this.tasks.length; },
    toggle() { this.isExpanded = !this.isExpanded; },
    toggleTask(taskId) {
      const task = this.tasks.find((t) => t.id === taskId);
      if (task) task.completed = !task.completed;
    }
  };
}
