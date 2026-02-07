/**
 * Chat Component - Agentic AI Chat Sidebar
 * Provides a multi-tab chat interface with WebSocket communication
 * Parses JSONL output from subd tool and maps to UI cards
 */

// Chat Store
document.addEventListener('alpine:init', () => {
  Alpine.store('chat', {
    tabs: [{ id: 1, name: 'Chat 1', messages: [], history: [], isNew: true }],
    activeTabId: 1,
    nextTabId: 2,
    isOpen: true,
    config: {
      agents: {},
      models: [],
      modes: [],
      defaultAgent: 'default',
      command: ''
    }
  });
});

/**
 * Parse a JSONL line from subd output and convert to a message card
 */
function parseSubdJsonLine(line) {
  try {
    const data = JSON.parse(line);
    const baseMsg = {
      id: Date.now() + Math.random(),
      timestamp: data.timestamp ? new Date(data.timestamp) : new Date()
    };

    switch (data.type) {
      case 'system_prompt':
        return { ...baseMsg, role: 'system', content: data.content };
      
      case 'user_prompt':
        return { ...baseMsg, role: 'user', content: data.content };
      
      case 'assistant':
        return { ...baseMsg, role: 'assistant', content: data.content };
      
      case 'final':
        return { ...baseMsg, role: 'final', content: data.content };
      
      case 'tool_call':
        return { 
          ...baseMsg, 
          role: 'tool_call', 
          toolName: data.name,
          arguments: data.arguments,
          toolCallId: data.tool_call_id
        };
      
      case 'tool_result':
        return { 
          ...baseMsg, 
          role: 'tool_result', 
          toolName: data.name,
          toolCallId: data.tool_call_id,
          content: data.content,
          status: data.status || 'success'
        };
      
      case 'log':
        return { 
          ...baseMsg, 
          role: 'log', 
          level: data.level,
          content: data.message 
        };
      
      case 'perf':
        return { 
          ...baseMsg, 
          role: 'perf', 
          label: data.label,
          stats: data.stats 
        };
      
      case 'error':
        return { ...baseMsg, role: 'error', content: data.message || data.content };
      
      default:
        // Unknown type, store as raw
        return { ...baseMsg, role: 'raw', content: line };
    }
  } catch (e) {
    // Not valid JSON, treat as plain text
    return {
      id: Date.now() + Math.random(),
      role: 'raw',
      content: line,
      timestamp: new Date()
    };
  }
}

/**
 * Main chat sidebar component
 */
function chatSidebar() {
  return {
    ws: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,

    async init() {
      await this.loadChatConfig();
      this.connectWebSocket();
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
        console.log('Chat WebSocket connected');
        this.reconnectAttempts = 0;
      };
      
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // Handle storage-changed event (hot-reload)
        if (data.type === 'storage-changed') {
          console.log('🔄 Storage changed, reloading data...');
          window.dispatchEvent(new CustomEvent('gdedit:toast', { detail: '📁 Files changed, reloading...' }));
          window.dispatchEvent(new CustomEvent('gdedit:reload'));
          return;
        }
        
        this.handleMessage(data);
      };
      
      this.ws.onclose = () => {
        console.log('Chat WebSocket disconnected');
        this.scheduleReconnect();
      };
      
      this.ws.onerror = (err) => {
        console.error('Chat WebSocket error:', err);
      };
    },

    scheduleReconnect() {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        setTimeout(() => this.connectWebSocket(), delay);
      }
    },

    handleMessage(data) {
      const store = Alpine.store('chat');
      const tab = store.tabs.find(t => t.id === data.tabId);
      if (!tab) return;

      switch (data.type) {
        case 'jsonl':
          // Parse JSONL line and add appropriate card
          this.processJsonlLine(tab, data.content);
          break;
        case 'response':
          this.addAssistantMessage(tab, data.content);
          tab.isWaiting = false;
          break;
        case 'error':
          this.addErrorMessage(tab, data.content);
          tab.isWaiting = false;
          break;
        case 'stream':
          // For streaming, check if it's JSONL or plain text
          this.processStreamChunk(tab, data.content);
          break;
        case 'done':
          tab.isWaiting = false;
          break;
      }
    },

    processJsonlLine(tab, line) {
      const msg = parseSubdJsonLine(line);
      
      // Add to raw history for persistence
      if (!tab.history) tab.history = [];
      tab.history.push(line);

      // Filter which message types to display
      const displayRoles = ['assistant', 'final', 'tool_call', 'tool_result', 'error'];
      const verboseRoles = ['log', 'perf'];
      
      // Always show final as the main assistant response
      if (msg.role === 'final') {
        msg.role = 'assistant';
        tab.messages.push(msg);
        this.triggerAutoScroll();
      } else if (displayRoles.includes(msg.role)) {
        tab.messages.push(msg);
        this.triggerAutoScroll();
      }
      // Verbose roles can be shown in a debug mode (future feature)
    },

    triggerAutoScroll() {
      // Dispatch event for chat history to auto-scroll
      window.dispatchEvent(new CustomEvent('chat:newMessage'));
    },

    processStreamChunk(tab, chunk) {
      // Split by newlines to handle JSONL
      const lines = chunk.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        // Try to parse as JSONL first
        if (line.startsWith('{')) {
          this.processJsonlLine(tab, line);
        } else {
          // Plain text - append to last assistant message or create new one
          this.appendToLastMessage(tab, line);
        }
      }
    },

    addAssistantMessage(tab, content) {
      tab.messages.push({
        id: Date.now(),
        role: 'assistant',
        content: content,
        timestamp: new Date()
      });
    },

    addErrorMessage(tab, content) {
      tab.messages.push({
        id: Date.now(),
        role: 'error',
        content: content,
        timestamp: new Date()
      });
    },

    appendToLastMessage(tab, content) {
      const lastMsg = tab.messages[tab.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content += content;
      } else {
        this.addAssistantMessage(tab, content);
      }
    },

    sendMessage(tabId, content, agent) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected');
        return;
      }
      
      // Get the tab's history for session continuity
      const store = Alpine.store('chat');
      const tab = store.tabs.find(t => t.id === tabId);
      const history = tab?.history || [];
      
      // Get current selection from editor store
      const editorStore = Alpine.store('editor');
      const selectedRows = editorStore?.selectedRows || [];
      const instances = editorStore?.instances || [];
      
      // Build selection data with id and class
      const selection = selectedRows.map(id => {
        const instance = instances.find(i => i._id === id);
        return instance ? { id: instance._id, class: instance._class } : { id, class: 'Unknown' };
      });
      
      this.ws.send(JSON.stringify({
        type: 'chat',
        tabId: tabId,
        content: content,
        agent: agent,
        history: history,  // Send accumulated JSONL history
        selection: selection  // Send current editor selection
      }));
    },

    abortRequest(tabId) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      
      this.ws.send(JSON.stringify({
        type: 'abort',
        tabId: tabId
      }));
    },

    get tabs() {
      return Alpine.store('chat').tabs;
    },

    get activeTabId() {
      return Alpine.store('chat').activeTabId;
    },

    get activeTab() {
      return this.tabs.find(t => t.id === this.activeTabId);
    },

    get isOpen() {
      return Alpine.store('chat').isOpen;
    },

    toggleSidebar() {
      Alpine.store('chat').isOpen = !Alpine.store('chat').isOpen;
    }
  };
}

/**
 * Chat tabs navigation component
 */
function chatTabs() {
  return {
    setActiveTab(tabId) {
      Alpine.store('chat').activeTabId = tabId;
    },

    createNewTab() {
      const store = Alpine.store('chat');
      const newTab = {
        id: store.nextTabId++,
        name: `Chat ${store.nextTabId - 1}`,
        messages: [],
        history: [],  // Raw JSONL history for persistence
        isNew: true
      };
      store.tabs.push(newTab);
      store.activeTabId = newTab.id;
    },

    closeTab(tabId) {
      const store = Alpine.store('chat');
      const idx = store.tabs.findIndex(t => t.id === tabId);
      if (idx === -1) return;
      
      // If closing last tab, create a fresh one first
      if (store.tabs.length === 1) {
        this.createNewTab();
      }
      
      store.tabs.splice(idx, 1);
      
      // Switch to another tab if closing active
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

    canClose(tabId) {
      return true; // Always allow closing; last tab close creates a fresh one
    }
  };
}

/**
 * Chat input area component
 */
function chatInput() {
  return {
    inputText: '',
    selectedAgent: null,
    attachedFiles: [],
    showAgentPill: false,

    init() {
      // Use defaultAgent from config (will be set after config loads)
      this.selectedAgent = null; // Will use server's defaultAgent
    },

    get isWaiting() {
      const tab = Alpine.store('chat').tabs.find(
        t => t.id === Alpine.store('chat').activeTabId
      );
      return tab?.isWaiting || false;
    },

    handleInput(e) {
      const text = e.target.value;
      
      // Parse @agent syntax
      if (text.startsWith('@') && !this.showAgentPill) {
        const match = text.match(/^@(\w+)\s/);
        if (match) {
          const agentName = match[1];
          if (this.agents[agentName]) {
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
      this.selectedAgent = null; // Will use server's defaultAgent
    },

    attachFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = (e) => {
        for (const file of e.target.files) {
          this.attachedFiles.push({
            name: file.name,
            file: file
          });
        }
      };
      input.click();
    },

    removeFile(index) {
      this.attachedFiles.splice(index, 1);
    },

    submit() {
      if (!this.inputText.trim() || this.isWaiting) return;
      
      const store = Alpine.store('chat');
      const tab = store.tabs.find(t => t.id === store.activeTabId);
      if (!tab) return;
      
      // Mark as no longer new
      tab.isNew = false;
      
      // Add user message
      tab.messages.push({
        id: Date.now(),
        role: 'user',
        content: this.inputText,
        agent: this.selectedAgent,
        timestamp: new Date()
      });
      
      // Set waiting state
      tab.isWaiting = true;
      
      // Get sidebar component to send message
      const sidebar = document.querySelector('[x-data*="chatSidebar"]');
      if (sidebar && sidebar._x_dataStack) {
        const sidebarData = sidebar._x_dataStack[0];
        sidebarData.sendMessage(tab.id, this.inputText, this.selectedAgent);
      }
      
      // Clear input
      this.inputText = '';
      this.attachedFiles = [];
    },

    abort() {
      const store = Alpine.store('chat');
      const sidebar = document.querySelector('[x-data*="chatSidebar"]');
      if (sidebar && sidebar._x_dataStack) {
        sidebar._x_dataStack[0].abortRequest(store.activeTabId);
      }
      
      const tab = store.tabs.find(t => t.id === store.activeTabId);
      if (tab) tab.isWaiting = false;
    }
  };
}

/**
 * Chat history/messages area component
 */
function chatHistory() {
  return {
    autoScroll: true,
    lastMessageCount: 0,

    init() {
      // Watch for new messages and auto-scroll
      this.$watch('messages', (msgs) => {
        if (msgs.length > this.lastMessageCount && this.autoScroll) {
          this.$nextTick(() => this.scrollToBottom());
        }
        this.lastMessageCount = msgs.length;
      });

      // Also scroll when waiting state changes (streaming updates)
      this.$watch('isWaiting', () => {
        if (this.autoScroll) {
          this.$nextTick(() => this.scrollToBottom());
        }
      });

      // Listen for explicit scroll trigger from message processing
      window.addEventListener('chat:newMessage', () => {
        if (this.autoScroll) {
          this.$nextTick(() => this.scrollToBottom());
        }
      });
    },

    handleScroll(event) {
      const el = event.target;
      const threshold = 50; // pixels from bottom to consider "at bottom"
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      this.autoScroll = atBottom;
    },

    scrollToBottom() {
      this.$el.scrollTop = this.$el.scrollHeight;
    },

    get messages() {
      const store = Alpine.store('chat');
      const tab = store.tabs.find(t => t.id === store.activeTabId);
      return tab?.messages || [];
    },

    get isNew() {
      const store = Alpine.store('chat');
      const tab = store.tabs.find(t => t.id === store.activeTabId);
      return tab?.isNew || false;
    },

    get isWaiting() {
      const store = Alpine.store('chat');
      const tab = store.tabs.find(t => t.id === store.activeTabId);
      return tab?.isWaiting || false;
    },

    copyMessage(content) {
      navigator.clipboard.writeText(content);
      window.dispatchEvent(new CustomEvent('gdedit:toast', { 
        detail: 'Copied to clipboard' 
      }));
    },

    editMessage(msgId) {
      // TODO: Implement edit functionality
      console.log('Edit message:', msgId);
    },

    rollbackTo(msgId) {
      // TODO: Implement rollback functionality
      console.log('Rollback to:', msgId);
    }
  };
}

/**
 * Title card component for new chats
 */
function chatTitleCard() {
  return {
    logo: `
 ██████╗ ██████╗ ███████╗██████╗ ██╗████████╗
██╔════╝ ██╔══██╗██╔════╝██╔══██╗██║╚══██╔══╝
██║  ███╗██║  ██║█████╗  ██║  ██║██║   ██║   
██║   ██║██║  ██║██╔══╝  ██║  ██║██║   ██║   
╚██████╔╝██████╔╝███████╗██████╔╝██║   ██║   
 ╚═════╝ ╚═════╝ ╚══════╝╚═════╝ ╚═╝   ╚═╝   
              AI Assistant
    `.trim(),
    
    tips: [
      'Ask me to analyze your game data',
      'Request bulk edits using natural language',
      'Get suggestions for balancing game entities'
    ]
  };
}

/**
 * Getting started prompts component
 */
function chatGettingStarted() {
  return {
    prompts: [
      {
        icon: '📊',
        text: 'Show me a summary of all game entities'
      },
      {
        icon: '⚖️',
        text: 'Help me balance the damage values for weapons'
      },
      {
        icon: '🔍',
        text: 'Find entities with missing required fields'
      }
    ],

    usePrompt(prompt) {
      const inputEl = document.querySelector('[x-data*="chatInput"]');
      if (inputEl && inputEl._x_dataStack) {
        const inputData = inputEl._x_dataStack[0];
        inputData.inputText = prompt.text;
        inputData.submit();
      }
    }
  };
}

/**
 * Ellipsis loading indicator component
 */
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

/**
 * Message card component - handles all message types
 */
function chatMessageCard(message) {
  return {
    message: message,
    showActions: false,

    get isUser() {
      return this.message.role === 'user';
    },

    get isAssistant() {
      return this.message.role === 'assistant' || this.message.role === 'final';
    },

    get isError() {
      return this.message.role === 'error';
    },

    get isToolCall() {
      return this.message.role === 'tool_call';
    },

    get isToolResult() {
      return this.message.role === 'tool_result';
    },

    get isLog() {
      return this.message.role === 'log';
    },

    get isPerf() {
      return this.message.role === 'perf';
    },

    getMessageClasses() {
      return {
        'chat-message-user': this.isUser,
        'chat-message-assistant': this.isAssistant,
        'chat-message-error': this.isError,
        'chat-message-tool': this.isToolCall || this.isToolResult,
        'chat-message-log': this.isLog,
        'chat-message-perf': this.isPerf
      };
    },

    get formattedContent() {
      return this.message.content;
    },

    get timestamp() {
      if (!this.message.timestamp) return '';
      const d = new Date(this.message.timestamp);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    renderMarkdown(content) {
      if (!content) return '';
      if (typeof marked !== 'undefined') {
        // Configure marked for safe rendering
        marked.setOptions({
          breaks: true,
          gfm: true
        });
        return marked.parse(content);
      }
      // Fallback: escape HTML and preserve whitespace
      return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    },

    formatPerfStats(stats) {
      if (!stats) return '';
      const parts = [];
      if (stats['duration(s)']) parts.push(`${stats['duration(s)'].toFixed(2)}s`);
      if (stats['tokens']) parts.push(`${stats.tokens} tokens`);
      if (stats['tokens/s']) parts.push(`${stats['tokens/s'].toFixed(1)} tok/s`);
      return parts.join(' · ');
    }
  };
}

/**
 * Review changes card component
 */
function chatReviewChanges() {
  return {
    isExpanded: false,
    activeView: 'this',
    activeFilter: 'all',
    
    // Mock data for now
    changes: {
      thisAction: 261,
      allActions: 1594,
      hardCoded: 4,
      formulas: 257,
      items: []
    },

    toggle() {
      this.isExpanded = !this.isExpanded;
    },

    accept() {
      console.log('Accept changes');
    },

    alwaysAccept() {
      console.log('Always accept');
    },

    revert() {
      console.log('Revert changes');
    }
  };
}

/**
 * Task list card component
 */
function chatTaskList() {
  return {
    isExpanded: false,
    tasks: [],

    get completedCount() {
      return this.tasks.filter(t => t.completed).length;
    },

    get totalCount() {
      return this.tasks.length;
    },

    toggle() {
      this.isExpanded = !this.isExpanded;
    },

    toggleTask(taskId) {
      const task = this.tasks.find(t => t.id === taskId);
      if (task) task.completed = !task.completed;
    }
  };
}
