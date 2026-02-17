/**
 * Pagination Component
 * Page navigation controls
 */

function pagination() {
  return {
    inputPage: 1,

    get currentPage() {
      return Alpine.store('editor').currentPage;
    },

    set currentPage(val) {
      Alpine.store('editor').currentPage = val;
      this.inputPage = val;
    },

    get pageSize() {
      return Alpine.store('editor').pageSize;
    },

    get totalUnfiltered() {
      const store = Alpine.store('editor');
      return (store.instances || []).length;
    },

    get totalItems() {
      const store = Alpine.store('editor');
      let instances = store.instances || [];
      if (Array.isArray(store.selectedClasses) && store.selectedClasses.length > 0) {
        instances = instances.filter(i => store.selectedClasses.includes(i._class));
      } else if (store.selectedClass) {
        instances = instances.filter(i => i._class === store.selectedClass);
      }
      if (store.searchQuery) {
        instances = window.GDEdit?.applyGlobalFilter?.(instances, store.searchQuery, store.searchMode) || instances;
      }
      return instances.length;
    },

    get totalPages() {
      return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
    },

    get startIndex() {
      return (this.currentPage - 1) * this.pageSize;
    },

    get endIndex() {
      return this.startIndex + this.pageSize;
    },

    goToFirst() {
      this.currentPage = 1;
    },

    goToPrev() {
      if (this.currentPage > 1) this.currentPage--;
    },

    goToNext() {
      if (this.currentPage < this.totalPages) this.currentPage++;
    },

    goToLast() {
      this.currentPage = this.totalPages;
    },

    goToPage(page) {
      const p = Math.max(1, Math.min(this.totalPages, parseInt(page) || 1));
      this.currentPage = p;
    }
  };
}
