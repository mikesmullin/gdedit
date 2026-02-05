/**
 * Data Store
 * In-memory store for ontology data with reactive updates
 */
import { loadOntology, getClassColumns, getClassRelations } from './ontology.js';

/**
 * Create a new data store
 * @param {string} storagePath - Path to storage directory
 * @returns {object} Store instance
 */
export function createStore(storagePath) {
  let data = { schema: {}, instances: [] };
  let listeners = [];

  /**
   * Load/reload data from storage
   */
  function load() {
    data = loadOntology(storagePath);
    notifyListeners();
    return data;
  }

  /**
   * Get all instances of a class
   * @param {string} className - Class name (optional, all if not specified)
   */
  function getInstances(className = null) {
    if (!className) return data.instances;
    return data.instances.filter(i => i._class === className);
  }

  /**
   * Get instance by ID
   */
  function getInstance(id) {
    return data.instances.find(i => i._id === id);
  }

  /**
   * Get all unique class names
   */
  function getClasses() {
    return Object.keys(data.schema.classes || {});
  }

  /**
   * Get schema
   */
  function getSchema() {
    return data.schema;
  }

  /**
   * Get columns for a class
   */
  function getColumns(className) {
    return getClassColumns(data.schema, className);
  }

  /**
   * Get relations for a class
   */
  function getRelations(className) {
    return getClassRelations(data.schema, className);
  }

  /**
   * Subscribe to changes
   */
  function subscribe(listener) {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  }

  function notifyListeners() {
    for (const listener of listeners) {
      listener(data);
    }
  }

  return {
    load,
    getInstances,
    getInstance,
    getClasses,
    getSchema,
    getColumns,
    getRelations,
    subscribe,
    get data() { return data; }
  };
}
