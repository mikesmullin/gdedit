/**
 * Toolbar Component
 * Search, filters, and action buttons
 */

function toolbar() {
  return {
    showAddModal: false,
    searchTimeout: null,
    searchHistory: [],
    showSearchHistory: false,

    init() {
      // Load search history from localStorage
      try {
        this.searchHistory = JSON.parse(localStorage.getItem('gdedit-search-history') || '[]');
      } catch { this.searchHistory = []; }
    },

    get visibleColumnsCount() {
      return Alpine.store('editor').columns.filter(c => c.visible).length;
    },

    get totalColumnsCount() {
      return Alpine.store('editor').columns.length;
    },

    get paginationInfo() {
      const store = Alpine.store('editor');
      const instances = store.instances || [];
      const filtered = this.getFilteredInstances();
      return `${filtered.length} of ${instances.length} entities`;
    },

    getFilteredInstances() {
      const store = Alpine.store('editor');
      let instances = store.instances || [];
      
      if (store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      
      if (store.searchQuery) {
        instances = window.GDEdit?.applyFilter?.(instances, store.searchQuery) || this.basicFilter(instances, store.searchQuery);
      }
      
      return instances;
    },

    basicFilter(instances, query) {
      const q = query.toLowerCase();
      return instances.filter(i => {
        const idMatch = i._id.toLowerCase().includes(q);
        const classMatch = i._class.toLowerCase().includes(q);
        const componentMatch = JSON.stringify(i.components || {}).toLowerCase().includes(q);
        return idMatch || classMatch || componentMatch;
      });
    },

    toggleColumn(colId) {
      const store = Alpine.store('editor');
      const col = store.columns.find(c => c.id === colId);
      if (col) col.visible = !col.visible;
    },

    showAllColumns() {
      Alpine.store('editor').columns.forEach(c => c.visible = true);
    },

    hideAllColumns() {
      Alpine.store('editor').columns.forEach(c => c.visible = false);
    },

    debounceSearch() {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        Alpine.store('editor').currentPage = 1;
      }, 300);
    },

    submitSearch() {
      const query = Alpine.store('editor').searchQuery;
      if (query && !this.searchHistory.includes(query)) {
        this.searchHistory.unshift(query);
        if (this.searchHistory.length > 20) this.searchHistory.pop();
        localStorage.setItem('gdedit-search-history', JSON.stringify(this.searchHistory));
      }
      this.showSearchHistory = false;
    },

    selectHistoryItem(item) {
      Alpine.store('editor').searchQuery = item;
      this.showSearchHistory = false;
      Alpine.store('editor').currentPage = 1;
    },

    clearSearch() {
      Alpine.store('editor').searchQuery = '';
      Alpine.store('editor').currentPage = 1;
    },

    async deleteSelected() {
      const store = Alpine.store('editor');
      if (store.selectedRows.length === 0) return;
      
      if (!confirm(`Delete ${store.selectedRows.length} selected row(s)?`)) return;
      
      for (const id of store.selectedRows) {
        await fetch(`/api/instances/${id}`, { method: 'DELETE' });
      }
      
      store.selectedRows = [];
      await this.$root.reload();
    }
  };
}
