/**
 * Basic Widget Data Functions
 * Simple type editors: integer, slider, enum, color, vector
 */

/**
 * Integer widget data
 */
function integerWidgetData() {
  return {
    localValue: 0,
    min: null,
    max: null,
    step: 1,
    
    initInteger() {
      this.localValue = parseInt(this.getValue()) || 0;
      if (this.col.schema) {
        this.min = this.col.schema.min ?? null;
        this.max = this.col.schema.max ?? null;
        this.step = this.col.schema.step ?? 1;
      }
    },
    
    validateAndSet(val) {
      let num = parseInt(val) || 0;
      if (this.min !== null) num = Math.max(this.min, num);
      if (this.max !== null) num = Math.min(this.max, num);
      this.localValue = num;
      this.setValue(num);
    },
    
    increment() { this.validateAndSet(this.localValue + this.step); },
    decrement() { this.validateAndSet(this.localValue - this.step); }
  };
}

/**
 * Slider widget data
 */
function sliderWidgetData() {
  return {
    localValue: 0, min: 0, max: 100, step: 1,
    
    initSlider() {
      this.localValue = parseFloat(this.getValue()) || 0;
      if (this.col.schema) {
        this.min = this.col.schema.min ?? 0;
        this.max = this.col.schema.max ?? 100;
        this.step = this.col.schema.step ?? 1;
      }
    },
    
    get percentage() {
      return ((this.localValue - this.min) / (this.max - this.min)) * 100;
    },
    
    updateValue(val) {
      this.localValue = parseFloat(val);
      this.setValue(this.localValue);
    },
    
    updateFromClick(e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.localValue = Math.round((this.min + pct * (this.max - this.min)) / this.step) * this.step;
      this.setValue(this.localValue);
    }
  };
}

/**
 * Enum dropdown widget data
 */
function enumWidgetData() {
  return {
    localValue: '', options: [], isOpen: false, searchTerm: '',
    
    initEnum() {
      this.localValue = this.getValue() ?? '';
      this.options = this.col.schema?.enum || 
                     window.GDEditWidgets?.inferEnumValues?.(this.col.property, this.col.schema) || [];
    },
    
    get filteredOptions() {
      if (!this.searchTerm) return this.options;
      const term = this.searchTerm.toLowerCase();
      return this.options.filter(o => o.toLowerCase().includes(term));
    },
    
    selectOption(opt) {
      this.localValue = opt;
      this.setValue(opt);
      this.isOpen = false;
      this.searchTerm = '';
    },
    
    toggle() {
      this.isOpen = !this.isOpen;
      if (this.isOpen) this.searchTerm = '';
    }
  };
}

/**
 * Color picker widget data
 */
function colorWidgetData() {
  return {
    localValue: '#000000', isOpen: false, recentColors: [],
    
    initColor() {
      this.localValue = this.normalizeColor(this.getValue());
      try {
        this.recentColors = JSON.parse(
          localStorage.getItem('gdedit-recent-colors') || '[]'
        ).slice(0, 8);
      } catch { this.recentColors = []; }
    },
    
    normalizeColor(val) {
      if (!val) return '#000000';
      if (typeof val === 'string' && val.startsWith('#')) return val;
      if (typeof val === 'object' && val.r !== undefined) {
        return '#' + [val.r, val.g, val.b].map(x => {
          const hex = Math.round(x).toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        }).join('');
      }
      return '#000000';
    },
    
    updateColor(hex) {
      this.localValue = hex;
      this.setValue(hex);
      this.addToRecent(hex);
    },
    
    addToRecent(hex) {
      this.recentColors = [hex, ...this.recentColors.filter(c => c !== hex)].slice(0, 8);
      localStorage.setItem('gdedit-recent-colors', JSON.stringify(this.recentColors));
    },
    
    selectRecent(color) {
      this.localValue = color;
      this.setValue(color);
      this.isOpen = false;
    }
  };
}

/**
 * Vector widget data (2D/3D/4D)
 */
function vectorWidgetData() {
  return {
    components: [], labels: ['X', 'Y', 'Z', 'W'], dimensions: 3, isExpanded: false,
    
    initVector() {
      this.dimensions = window.GDEditWidgets?.getVectorDimensions?.(this.col.type) || 3;
      this.components = window.GDEditWidgets?.parseVector?.(this.getValue(), this.dimensions) || 
                        Array(this.dimensions).fill(0);
    },
    
    updateComponent(index, value) {
      const num = parseFloat(value) || 0;
      this.components[index] = num;
      this.setValue([...this.components]);
    },
    
    get displayValue() {
      return this.components.map(c => (c || 0).toFixed(2)).join(', ');
    },
    
    toggleExpanded() { this.isExpanded = !this.isExpanded; }
  };
}

/**
 * Tags (string array) widget data
 */
function tagsWidgetData() {
  return {
    tags: [], inputValue: '', isEditing: false, suggestions: [], pendingTag: false,
    
    initTags() {
      this.tags = window.GDEditWidgets?.parseTags?.(this.getValue()) || [];
      this.loadSuggestions();
    },
    
    loadSuggestions() {
      const store = Alpine.store('editor');
      const existingTags = new Set();
      for (const inst of store.instances) {
        const [ln, prop] = this.col.id.split('.');
        const val = inst.components?.[ln]?.[prop];
        const tags = window.GDEditWidgets?.parseTags?.(val) || [];
        for (const tag of tags) existingTags.add(tag);
      }
      this.suggestions = [...existingTags].sort();
    },
    
    get filteredSuggestions() {
      if (!this.inputValue) return [];
      const term = this.inputValue.toLowerCase();
      return this.suggestions.filter(s => 
        s.toLowerCase().includes(term) && !this.tags.includes(s)
      ).slice(0, 5);
    },
    
    addTag(tag) {
      tag = tag?.trim() || this.inputValue.trim();
      if (tag && !this.tags.includes(tag)) {
        this.tags = [...this.tags, tag];
        this.setValue(this.tags);
      }
      this.inputValue = '';
    },
    
    removeTag(index) {
      this.tags = this.tags.filter((_, i) => i !== index);
      this.setValue(this.tags);
    },
    
    handleKeydown(e) {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        this.addTag();
      } else if (e.key === 'Backspace' && !this.inputValue && this.tags.length) {
        this.removeTag(this.tags.length - 1);
      }
    }
  };
}
