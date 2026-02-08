/**
 * Advanced Query Parser Component - Full DSL with boolean operators
 */

// Token types for lexer
const TokenType = {
  STRING: 'STRING', NUMBER: 'NUMBER', BOOL: 'BOOL',
  COLON: 'COLON', DOT: 'DOT', LPAREN: 'LPAREN', RPAREN: 'RPAREN',
  AND: 'AND', OR: 'OR', NOT: 'NOT',
  RELATION_ARROW: 'RELATION_ARROW', LBRACKET: 'LBRACKET', RBRACKET: 'RBRACKET', EOF: 'EOF'
};

/**
 * Tokenize query string
 */
function tokenize(query) {
  const tokens = [];
  let i = 0;
  const len = query.length;

  while (i < len) {
    const ch = query[i];

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Keywords
    if (query.slice(i, i + 3).toUpperCase() === 'AND') {
      tokens.push({ type: TokenType.AND });
      i += 3;
      continue;
    }
    if (query.slice(i, i + 2).toUpperCase() === 'OR') {
      tokens.push({ type: TokenType.OR });
      i += 2;
      continue;
    }
    if (query.slice(i, i + 3).toUpperCase() === 'NOT') {
      tokens.push({ type: TokenType.NOT });
      i += 3;
      continue;
    }

    // Relation arrow
    if (query.slice(i, i + 3) === '->:') {
      tokens.push({ type: TokenType.RELATION_ARROW });
      i += 3;
      continue;
    }

    // Single chars
    if (ch === ':') {
      tokens.push({ type: TokenType.COLON });
      i++;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: TokenType.DOT });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: TokenType.LPAREN });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: TokenType.RPAREN });
      i++;
      continue;
    }
    if (ch === '[') {
      tokens.push({ type: TokenType.LBRACKET });
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ type: TokenType.RBRACKET });
      i++;
      continue;
    }
    if (ch === '-' && query[i + 1] === '[') {
      i++; // Skip dash, bracket will be consumed next
      continue;
    }

    // Quoted string
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let str = '';
      while (i < len && query[i] !== quote) {
        if (query[i] === '\\' && i + 1 < len) {
          i++;
          str += query[i];
        } else {
          str += query[i];
        }
        i++;
      }
      i++; // Skip closing quote
      tokens.push({ type: TokenType.STRING, value: str });
      continue;
    }

    // Boolean literals
    if (query.slice(i, i + 4).toLowerCase() === 'true') {
      tokens.push({ type: TokenType.BOOL, value: true });
      i += 4;
      continue;
    }
    if (query.slice(i, i + 5).toLowerCase() === 'false') {
      tokens.push({ type: TokenType.BOOL, value: false });
      i += 5;
      continue;
    }

    // Number
    if (/[-\d]/.test(ch)) {
      let num = '';
      while (i < len && /[\d.-]/.test(query[i])) {
        num += query[i];
        i++;
      }
      const parsed = num.includes('.') ? parseFloat(num) : parseInt(num, 10);
      if (!isNaN(parsed)) {
        tokens.push({ type: TokenType.NUMBER, value: parsed });
        continue;
      }
      // Not a number, treat as string start
      i -= num.length;
    }

    // Unquoted string (identifier)
    let str = '';
    while (i < len && !/[\s:.\[\]()"]/.test(query[i])) {
      str += query[i];
      i++;
    }
    if (str) {
      tokens.push({ type: TokenType.STRING, value: str });
    }
  }

  tokens.push({ type: TokenType.EOF });
  return tokens;
}

/**
 * Parse tokens into AST
 */
function parseTokens(tokens) {
  let pos = 0;

  function current() {
    return tokens[pos] || { type: TokenType.EOF };
  }

  function consume(type) {
    if (current().type === type) {
      return tokens[pos++];
    }
    return null;
  }

  function expect(type) {
    const tok = consume(type);
    if (!tok) {
      throw new Error(`Expected ${type}, got ${current().type}`);
    }
    return tok;
  }

  // Expression = OrExpr
  function parseExpression() {
    return parseOrExpr();
  }

  // OrExpr = AndExpr (OR AndExpr)*
  function parseOrExpr() {
    let left = parseAndExpr();
    while (consume(TokenType.OR)) {
      const right = parseAndExpr();
      left = { type: 'or', left, right };
    }
    return left;
  }

  // AndExpr = NotExpr (AND NotExpr)*
  function parseAndExpr() {
    let left = parseNotExpr();
    while (consume(TokenType.AND)) {
      const right = parseNotExpr();
      left = { type: 'and', left, right };
    }
    return left;
  }

  // NotExpr = NOT? Primary
  function parseNotExpr() {
    if (consume(TokenType.NOT)) {
      return { type: 'not', operand: parsePrimary() };
    }
    return parsePrimary();
  }

  // Primary = '(' Expression ')' | ClassQuery | RelationQuery | BareValue
  function parsePrimary() {
    if (consume(TokenType.LPAREN)) {
      const expr = parseExpression();
      expect(TokenType.RPAREN);
      return expr;
    }

    // Try relation query: -[:RELATION]->: value
    if (consume(TokenType.LBRACKET)) {
      if (consume(TokenType.COLON)) {
        const relation = expect(TokenType.STRING).value;
        expect(TokenType.RBRACKET);
        expect(TokenType.RELATION_ARROW);
        const value = parseValue();
        return { type: 'relation', relation, value };
      }
      pos--; // Backtrack
    }

    // Try id:Class pattern (id:Class: value or id:Class:)
    // Look ahead to see if we have STRING COLON STRING COLON pattern
    if (current().type === TokenType.STRING && 
        tokens[pos + 1]?.type === TokenType.COLON &&
        tokens[pos + 2]?.type === TokenType.STRING &&
        tokens[pos + 3]?.type === TokenType.COLON) {
      const id = consume(TokenType.STRING).value;
      consume(TokenType.COLON);
      const className = consume(TokenType.STRING).value;
      consume(TokenType.COLON);
      const value = parseValue();
      return { type: 'idclass', id, class: className, value };
    }
    
    // Try id:Class pattern without trailing colon (shorthand for matching id+class)
    if (current().type === TokenType.STRING && 
        tokens[pos + 1]?.type === TokenType.COLON &&
        tokens[pos + 2]?.type === TokenType.STRING &&
        (tokens[pos + 3]?.type === TokenType.EOF || 
         tokens[pos + 3]?.type === TokenType.AND ||
         tokens[pos + 3]?.type === TokenType.OR ||
         tokens[pos + 3]?.type === TokenType.RPAREN)) {
      const id = consume(TokenType.STRING).value;
      consume(TokenType.COLON);
      const className = consume(TokenType.STRING).value;
      return { type: 'idclass', id, class: className, value: null };
    }

    // Try class query: :Class.property: value
    if (consume(TokenType.COLON)) {
      const className = expect(TokenType.STRING).value;
      let property = null;
      
      if (consume(TokenType.DOT)) {
        property = expect(TokenType.STRING).value;
      }
      
      expect(TokenType.COLON);
      const value = parseValue();
      
      return { type: 'class', class: className, property, value };
    }

    // Bare value search
    const value = parseValue();
    return { type: 'bare', value };
  }

  function parseValue() {
    const tok = current();
    if (tok.type === TokenType.STRING) {
      pos++;
      return tok.value;
    }
    if (tok.type === TokenType.NUMBER) {
      pos++;
      return tok.value;
    }
    if (tok.type === TokenType.BOOL) {
      pos++;
      return tok.value;
    }
    return null;
  }

  const ast = parseExpression();
  return ast;
}

/**
 * Parse query string
 * @param {string} query - Query string
 * @returns {object} AST
 */
function parseQuery(query) {
  if (!query || typeof query !== 'string') {
    return { type: 'empty' };
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return { type: 'empty' };
  }

  try {
    const tokens = tokenize(trimmed);
    return parseTokens(tokens);
  } catch (e) {
    // Fallback to simple search
    return { type: 'bare', value: trimmed };
  }
}

/**
 * Apply filter to instances
 * @param {Array} instances - Instances to filter
 * @param {object} ast - Parsed query AST
 * @returns {Array} Filtered instances
 */
function applyFilter(instances, ast) {
  if (!ast || ast.type === 'empty') {
    return instances;
  }

  return instances.filter(inst => matchInstance(inst, ast));
}

function matchInstance(instance, ast) {
  switch (ast.type) {
    case 'empty':
      return true;

    case 'bare':
      return matchBare(instance, ast.value);

    case 'class':
      return matchClass(instance, ast);

    case 'idclass':
      return matchIdClass(instance, ast);

    case 'relation':
      return matchRelation(instance, ast);

    case 'and':
      return matchInstance(instance, ast.left) && matchInstance(instance, ast.right);

    case 'or':
      return matchInstance(instance, ast.left) || matchInstance(instance, ast.right);

    case 'not':
      return !matchInstance(instance, ast.operand);

    default:
      return true;
  }
}

function matchBare(instance, search) {
  if (!search) return true;
  const s = String(search).toLowerCase();
  
  if (instance._id.toLowerCase().includes(s)) return true;
  if (instance._class.toLowerCase().includes(s)) return true;
  
  const componentsStr = JSON.stringify(instance.components || {}).toLowerCase();
  return componentsStr.includes(s);
}

function matchClass(instance, query) {
  if (query.class && instance._class !== query.class) {
    return false;
  }

  if (query.property && query.value !== null) {
    const [localName, prop] = query.property.split('.');
    const value = instance.components?.[localName]?.[prop];
    
    if (typeof query.value === 'boolean') {
      return value === query.value;
    }
    return String(value) === String(query.value);
  }

  return true;
}

function matchIdClass(instance, query) {
  // Match by id (supports wildcard * or partial match)
  if (query.id) {
    const idPattern = query.id;
    if (idPattern === '*' || idPattern === '**') {
      // Wildcard matches any id
    } else if (idPattern.includes('*')) {
      // Pattern matching with wildcard
      const regex = new RegExp('^' + idPattern.replace(/\*/g, '.*') + '$', 'i');
      if (!regex.test(instance._id)) return false;
    } else {
      // Exact match (case-insensitive)
      if (instance._id.toLowerCase() !== idPattern.toLowerCase()) return false;
    }
  }
  
  // Match by class
  if (query.class && instance._class !== query.class) {
    return false;
  }
  
  // If value is provided, search within instance data
  if (query.value !== null && query.value !== undefined) {
    const s = String(query.value).toLowerCase();
    const componentsStr = JSON.stringify(instance.components || {}).toLowerCase();
    if (!componentsStr.includes(s)) return false;
  }
  
  return true;
}

function matchRelation(instance, query) {
  const relations = instance.relations?.[query.relation];
  if (!relations) return false;

  if (query.value === null) {
    return relations.length > 0;
  }

  return relations.some(r => {
    const target = typeof r === 'string' ? r : r._to;
    return target === query.value;
  });
}

/**
 * Query history manager
 */
function createQueryHistory(maxSize = 20) {
  const STORAGE_KEY = 'gdedit-query-history';
  
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function save(history) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {}
  }

  return {
    history: load(),

    add(query) {
      if (!query || typeof query !== 'string') return;
      const trimmed = query.trim();
      if (!trimmed) return;

      // Remove duplicates
      this.history = this.history.filter(h => h !== trimmed);
      this.history.unshift(trimmed);
      
      // Trim to max size
      if (this.history.length > maxSize) {
        this.history = this.history.slice(0, maxSize);
      }
      
      save(this.history);
    },

    clear() {
      this.history = [];
      save([]);
    }
  };
}

/**
 * Search component for Alpine.js
 */
function advancedSearch() {
  return {
    searchQuery: '',
    showHistory: false,
    queryHistory: createQueryHistory(),
    searchTimeout: null,
    parsedQuery: null,
    parseError: null,

    init() {
      this.$watch('searchQuery', () => this.debounceSearch());
    },

    debounceSearch() {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.executeSearch();
      }, 300);
    },

    executeSearch() {
      const store = Alpine.store('editor');
      store.searchQuery = this.searchQuery;
      store.currentPage = 1;

      if (this.searchQuery) {
        try {
          this.parsedQuery = parseQuery(this.searchQuery);
          this.parseError = null;
        } catch (e) {
          this.parseError = e.message;
        }
      } else {
        this.parsedQuery = null;
        this.parseError = null;
      }
    },

    submitSearch() {
      if (this.searchQuery) {
        this.queryHistory.add(this.searchQuery);
      }
      this.executeSearch();
      this.showHistory = false;
    },

    selectFromHistory(query) {
      this.searchQuery = query;
      this.showHistory = false;
      this.executeSearch();
    },

    clearHistory() {
      this.queryHistory.clear();
    },

    clearSearch() {
      this.searchQuery = '';
      Alpine.store('editor').searchQuery = '';
      Alpine.store('editor').currentPage = 1;
    }
  };
}
