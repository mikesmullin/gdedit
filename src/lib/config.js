/**
 * Configuration Loader
 * Loads and parses the config.yaml file
 */
import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { resolve, dirname } from 'path';

const DEFAULT_CONFIG = {
  storage: { path: '../ontology/storage' },
  server: { port: 3000, host: 'localhost' },
  ui: { pageSize: 20, defaultView: 'all', autoSave: true, autoSaveInterval: 30000 },
  views: [{ name: 'All', icon: '📊', classes: [] }]
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
    return mergeDeep(DEFAULT_CONFIG, userConfig);
  } catch (error) {
    console.error(`Error loading config: ${error.message}`);
    return DEFAULT_CONFIG;
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
