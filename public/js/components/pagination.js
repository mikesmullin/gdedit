/**
 * Pagination Component
 * Page navigation controls
 */

function pagination() {
  return {
    inputPage: 1,

    currentPage() {
      return Number(Alpine.store('editor').currentPage) || 1;
    },

    setCurrentPage(val) {
      const store = Alpine.store('editor');
      const next = Math.max(1, parseInt(val, 10) || 1);
      store.currentPage = next;
      this.inputPage = next;
    },

    pageSize() {
      return Math.max(1, Number(Alpine.store('editor').pageSize) || 20);
    },

    totalUnfiltered() {
      const store = Alpine.store('editor');
      return (store.instances || []).length;
    },

    totalItems() {
      const store = Alpine.store('editor');
      let instances = store.instances || [];
      if (Array.isArray(store.selectedClasses) && store.selectedClasses.length > 0) {
        instances = instances.filter(i => store.selectedClasses.includes(i._class));
      }
      if (store.searchQuery) {
        instances = window.GDEdit?.applyGlobalFilter?.(instances, store.searchQuery, store.searchMode) || instances;
      }
      return instances.length;
    },

    totalPages() {
      return Math.max(1, Math.ceil(this.totalItems() / this.pageSize()));
    },

    startIndex() {
      return (this.currentPage() - 1) * this.pageSize();
    },

    endIndex() {
      return this.startIndex() + this.pageSize();
    },

    goToFirst() {
      this.setCurrentPage(1);
    },

    goToPrev() {
      const curr = this.currentPage();
      if (curr > 1) this.setCurrentPage(curr - 1);
    },

    goToNext() {
      const curr = this.currentPage();
      const total = this.totalPages();
      if (curr < total) this.setCurrentPage(curr + 1);
    },

    goToLast() {
      this.setCurrentPage(this.totalPages());
    },

    goToPage(page) {
      const p = Math.max(1, Math.min(this.totalPages(), parseInt(page, 10) || 1));
      this.setCurrentPage(p);
    }
  };
}
