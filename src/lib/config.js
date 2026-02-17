/**
 * Configuration Loader
 * Loads and parses the config.yaml file
 */
import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { resolve, dirname } from 'path';
import { homedir } from 'os';

/**
 * Expand ~ in paths to home directory
 * @param {string} path - Path to expand
 * @returns {string} Expanded path
 */
function expandPath(path) {
  if (typeof path === 'string' && path.startsWith('~')) {
    return path.replace(/^~/, homedir());
  }
  return path;
}

/**
 * Recursively expand ~ in paths within an object
 * @param {any} obj - Object to process
 * @returns {any} Object with expanded paths
 */
export function expandPathsInObject(obj) {
  if (typeof obj === 'string') {
    return expandPath(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(expandPathsInObject);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandPathsInObject(value);
    }
    return result;
  }
  return obj;
}

const DEFAULT_CONFIG = {
  revision: 0,
  storage: { path: '../ontology/storage' },
  server: { port: 3000, host: 'localhost' },
  ui: {
    pageSize: 20,
    autoScroll: true,
    autoSelect: true,
    highlightAlpha: 0.35,
    highlightRows: true,
    highlightCols: true,
    graphState: {
      fitEnabled: false,
      forceEnabled: false,
      layoutEnabled: true,
      fitPadding: 0.5
    },
    sidebarState: {
      navOpen: true,
      inspectorOpen: true,
      chatOpen: true
    },
    filterState: {
      views: { selected: [], pinned: [] },
      classes: { selected: [], pinned: [] },
      components: { selected: [], pinned: [] }
    }
  },
  views: []
};

/**
 * Load configuration from config.yaml
 * @param {string} configPath - Path to config file
 * @returns {object} Merged configuration object
 */
export function loadConfig(configPath = 'config.yaml') {
  const resolvedPath = resolve(configPath);
  
  if (!existsSync(resolvedPath)) {
    console.warn(`Config file not found at ${resolvedPath}, using defaults`);
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(resolvedPath, 'utf8');
    const userConfig = parseYaml(content);
    const expandedConfig = expandPathsInObject(userConfig);
    const merged = mergeDeep(DEFAULT_CONFIG, expandedConfig);
    return expandPathsInObject(merged);
  } catch (error) {
    console.error(`Error loading config: ${error.message}`);
    return expandPathsInObject(DEFAULT_CONFIG);
  }
}

/**
 * Deep merge two objects
 * @param {object} target - Target object
 * @param {object} source - Source object to merge
 * @returns {object} Merged object
 */
function mergeDeep(target, source) {
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    if (isObject(source[key]) && isObject(target[key])) {
      result[key] = mergeDeep(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Resolve storage path relative to config file location
 * @param {object} config - Configuration object
 * @param {string} configDir - Directory containing config file
 * @returns {string} Absolute storage path
 */
export function resolveStoragePath(config, configDir) {
  const storagePath = config.storage?.path || DEFAULT_CONFIG.storage.path;
  return resolve(configDir, storagePath);
}
