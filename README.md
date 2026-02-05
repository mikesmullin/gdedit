# Game Data Editor (GDE)

A browser-based, spreadsheet-style editor for managing Ontology YAML data files.

## Features

- 📊 Spreadsheet-style UI for editing entities
- 🏷️ Activity views (role-based filtering)
- 📑 Class/type tabs for organization
- 🔍 Search/filter with query syntax
- ✏️ Inline cell editing
- 📄 Pagination for large datasets
- 💾 Auto-save to YAML files

## Requirements

- [Bun](https://bun.sh/) runtime

## Installation

```bash
cd gdedit
bun install
```

## Configuration

Edit `config.yaml` to configure the storage path:

```yaml
storage:
  path: "../ontology/storage"  # Path to ontology YAML files

server:
  port: 3000
  host: "localhost"

ui:
  pageSize: 20
  defaultView: "all"
```

## Running

```bash
# Development (with hot reload)
bun run dev

# Production
bun run start
```

Open http://localhost:3000 in your browser.

## Project Structure

```
gdedit/
├── config.yaml           # Configuration file
├── package.json          # Dependencies
├── public/               # Static frontend files
│   ├── index.html        # Main HTML entry
│   └── js/
│       └── app.js        # Alpine.js components
└── src/
    ├── server.js         # Bun server entry point
    └── lib/
        ├── api.js        # API route handlers
        ├── config.js     # Config loader
        ├── export.js     # Export utilities
        ├── ontology.js   # YAML parser
        ├── operations.js # CRUD operations
        ├── query.js      # Query parser
        └── store.js      # Data store
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/schema` | GET | Get ontology schema |
| `/api/classes` | GET | List all classes |
| `/api/classes/:name/columns` | GET | Get columns for a class |
| `/api/instances` | GET | List all instances |
| `/api/instances?class=X` | GET | List instances of class |
| `/api/instances/:id` | GET | Get instance by ID |
| `/api/instances` | POST | Create new instance |
| `/api/instances/:id` | PUT | Update instance |
| `/api/instances/:id` | PATCH | Partial update |
| `/api/instances/:id` | DELETE | Delete instance |
| `/api/reload` | POST | Reload data from disk |

## Search Query Syntax

- **Bare value**: `John` - Search all fields
- **Class filter**: `:Person:` - List all Person instances
- **Property filter**: `:Person.employment.active: true` - Filter by property
- **ID lookup**: `jdoe::` - Find by ID
- **Relation**: `-[:MEMBER_OF]->: team-zulu` - Find by relation

## Tech Stack

- **Runtime**: Bun
- **Frontend**: Alpine.js + Tailwind CSS
- **Data**: YAML files (Ontology format)

## License

MIT
