# Game Data Editor - TODO

Tracking missing features from PRD.md and DATA.md specifications.

- read `TechImpl/GameData.md` to underestand the original idea
- read `TechImpl/PRD.md` to understand the implementation plan for the UI
- read `TechImpl/DATA.md` to understand how the UI relates to the existing Ontology back-end
- read `tmp/ontology/docs/ONTOLOGY_RFC.md` to understand the existing Onology back-end

- now, i want you to resume implementation of this front-end UI project in a new folder `tmp/gdedit/`. 
  - use Bun javascript (modular es6 syntax)
    - no functions > 50lines, no files >500lines
    - use Alpine.js + Tailwind CSS 
  - remember: the path to the ontology `storage/` dir is configurable via `config.yaml`

---

## Phase 1: Core Features (P0) - MVP Completion

### Toolbar Features
- [x] **Bulk Add Rows** - Add N rows with auto-naming ($t, $i template variables)
  - Dropdown with preset counts (1/5/10/25/Custom), naming template field
- [x] **Copy/Paste Operations**
  - [x] Copy Table (all visible data)
  - [x] Copy Row(s) (selected rows)
  - [x] Copy Column
  - [x] Smart Paste (auto-detect CSV/TSV headers, align columns)
  - [x] Paste Pad dialog (textarea for clipboard editing)
- [x] **Open/Save File Dialogs**
  - [x] Open: Load from external CSV/JSON file
  - [x] Save: Export current view to file (CSV/JSON)
- [x] **Column Width** - Resizable columns, auto-fit width

### Search & Filter
- [x] **Advanced Query Parser** - Full ontology DSL support
  - [x] Class property search: `:Person.employment.active: true`
  - [x] Relation search: `-[:MEMBER_OF]->: team-zulu`
  - [x] Boolean operators: AND, OR, NOT, parentheses
  - [x] Search history dropdown

### Data Validation
- [x] **Type Validation** - Verify property types on edit
- [x] **Required Field Validation** - Non-empty check for required: true
- [x] **Relation Integrity** - Verify target entities exist
- [x] **Cardinality Validation** - Enforce oto/otm/mto/mtm constraints
- [x] **Visual Validation Feedback** - Red outline on invalid cells

---

## Phase 2: Cell Widgets (P0-P1)

### Primitive Type Widgets
- [x] String (text input)
- [x] Bool (checkbox)
- [x] Date (date picker)
- [x] **Integer** - Number input with +/- buttons and validation
- [x] **Float/Double** - Number input with decimal step
- [x] **Number Slider** - Drag-to-adjust numeric values with track/thumb
- [x] **Enum Dropdown** - Searchable dropdown with inferred/schema enum values

### Complex Type Widgets
- [x] **Color Picker** - Color swatch with popup picker and recent colors
- [x] **Vector2/3/4** - Multi-field input (X, Y, Z, W) with expand/collapse
- [x] **String Array (Tags)** - Chip/pill editor with add/remove and suggestions
- [x] **Nested Object** - JSON view with expand/collapse, key-value editor
- [x] **Array (Expandable)** - Inline expand with item editing, reordering

### Reference Type Widgets
- [x] **Entity Reference** - Dropdown with search, class filter, recent selections
- [x] **Relation Editor** - Edit relations inline with add/remove targets and qualifiers

---

## Phase 3: Navigation & Views (P1)

### Tier System
- [x] Tier 1: Activity Views (role-based tabs)
- [x] Tier 2: Class Tabs (filter by _class)
- [ ] **Tier 3: Component Sub-Tabs** - Filter by component (edit across classes)
- [ ] **Tier 4: Child-Tabs** - Navigate nested data hierarchies
- [ ] **Tab Pinning** - Pin frequently used tabs

### Activity View Configuration
- [ ] **View Editor Dialog**
  - [ ] Set view name, icon, color
  - [ ] Select visible classes
  - [ ] Configure column presets per class
  - [ ] Set default sort order
  - [ ] Read-only mode option
- [ ] **Persist Views to Config** - Save/load view configurations
- [ ] **Column Grouping** - Group columns by component in visibility menu

### Column Management
- [ ] **Hierarchical Column Menu** - Nested menu by component
- [ ] **Column Reordering** - Drag to reorder columns
- [ ] **Column Sorting** - Click header to sort asc/desc
- [ ] **Column Freezing** - Freeze _id/_class columns

---

## Phase 4: Export & Import (P1)

### Export Features
- [ ] **Export to CSV** - Flattened columns with localName prefix
- [ ] **Export to JSON** - Nested structure with relations
- [ ] **Export to YAML** - Original ontology format
- [ ] **Export Dialog** - Format selection, download trigger
- [ ] **Export Visible Only** - Option to export filtered view

### Import Features
- [ ] **Import from CSV** - Parse headers, create instances
- [ ] **Import from JSON** - Validate and create instances
- [ ] **Import Preview** - Show detected format, row count, validation
- [ ] **Merge vs Replace** - Option to append or replace data

---

## Phase 5: Advanced Features (P2)

### Entity Graph View
- [ ] **Force-Directed Graph** - Visualize entity relationships
- [ ] **Node Types** - Different colors/shapes per class
- [ ] **Edge Labels** - Show relation names
- [ ] **Graph Search/Filter** - Filter by class, relation type
- [ ] **Click to Edit** - Navigate from graph to table
- [ ] **Layout Options** - Force, hierarchical, circular

### Schema Editor
- [ ] **Schema View** - MySQL-style table definition
- [ ] **Add/Remove Columns** - Modify component properties
- [ ] **Type Selection** - Dropdown for property types
- [ ] **Constraint Editor** - Add validation rules
- [ ] **Preview Changes** - Show diff before applying

### Live Sync (Hot Reload)
- [ ] **File Watcher** - Detect external file changes
- [ ] **WebSocket Integration** - Push updates to game engine
- [ ] **Change Notifications** - Show when external changes detected
- [ ] **Auto-Reload** - Option to auto-refresh on file change

---

## Phase 6: UX Polish (P2)

### Keyboard Shortcuts
- [ ] `Ctrl+S` - Save
- [ ] `Ctrl+O` - Open
- [ ] `Ctrl+C` / `Ctrl+V` / `Ctrl+X` - Copy/Paste/Cut
- [ ] `Ctrl+Z` / `Ctrl+Shift+Z` - Undo/Redo
- [ ] `Ctrl+F` - Focus search
- [ ] `Ctrl+A` - Select all
- [ ] `Delete` - Delete selected rows
- [ ] `Ctrl+Enter` - New row
- [ ] `Arrow Keys` - Navigate cells
- [ ] `Enter` / `F2` - Edit cell
- [ ] `Escape` - Cancel edit
- [ ] `Tab` / `Shift+Tab` - Next/prev cell

### Undo/Redo
- [ ] **Operation Stack** - Track all edits
- [ ] **Undo** - Revert last change
- [ ] **Redo** - Re-apply undone change
- [ ] **Undo History Panel** - View operation history

### Auto-Save
- [ ] **Dirty Tracking** - Track unsaved changes
- [ ] **Auto-Save Timer** - Save after N seconds of inactivity
- [ ] **Unsaved Changes Indicator** - Show in status bar
- [ ] **Confirm on Exit** - Warn about unsaved changes

### Performance
- [ ] **Virtual Scrolling** - Only render visible rows
- [ ] **Lazy Column Loading** - Load columns on demand
- [ ] **Web Workers** - Offload parsing/validation
- [ ] **10k+ Entity Support** - Test with large datasets

---

## Bugs & Technical Debt

- [ ] Fix: Add Row modal - pre-select current class if one is selected
- [ ] Fix: Column visibility doesn't persist across page reload
- [ ] Refactor: Extract cell widget components to separate files
