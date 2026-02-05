/**
 * Instance Operations
 * CRUD operations for ontology instances
 */
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { serializeInstance } from './ontology.js';

/**
 * Save instance to storage
 * @param {string} storagePath - Storage directory
 * @param {object} instance - Instance to save
 * @param {string} namespace - Namespace
 */
export function saveInstance(storagePath, instance, namespace = 'stormy') {
  const filename = `${instance._class.toLowerCase()}-${instance._id}.yml`;
  const filePath = join(storagePath, filename);
  
  // Remove internal fields before saving
  const cleanInstance = { ...instance };
  delete cleanInstance._source;
  
  const yaml = serializeInstance(cleanInstance, namespace);
  writeFileSync(filePath, yaml, 'utf8');
  
  return filePath;
}

/**
 * Delete instance from storage
 * @param {string} storagePath - Storage directory
 * @param {object} instance - Instance to delete
 */
export function deleteInstance(storagePath, instance) {
  const filename = instance._source || 
    `${instance._class.toLowerCase()}-${instance._id}.yml`;
  const filePath = join(storagePath, filename);
  
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Update instance property
 * @param {object} instance - Instance to update
 * @param {string} columnId - Column ID (e.g., 'identity.name')
 * @param {*} value - New value
 */
export function updateInstanceProperty(instance, columnId, value) {
  const [localName, property] = columnId.split('.');
  
  if (!instance.components) {
    instance.components = {};
  }
  if (!instance.components[localName]) {
    instance.components[localName] = {};
  }
  
  instance.components[localName][property] = value;
  return instance;
}

/**
 * Get instance property value
 * @param {object} instance - Instance
 * @param {string} columnId - Column ID (e.g., 'identity.name')
 */
export function getInstanceProperty(instance, columnId) {
  const [localName, property] = columnId.split('.');
  return instance.components?.[localName]?.[property];
}

/**
 * Create new instance with default values
 * @param {string} className - Class name
 * @param {string} id - Instance ID
 * @param {Array} columns - Column definitions
 */
export function createNewInstance(className, id, columns) {
  const instance = {
    _class: className,
    _id: id,
    components: {},
    relations: {}
  };

  // Initialize component structure
  for (const col of columns) {
    if (!instance.components[col.localName]) {
      instance.components[col.localName] = {};
    }
    instance.components[col.localName][col.property] = getDefaultValue(col.type);
  }

  return instance;
}

/**
 * Get default value for property type
 */
function getDefaultValue(type) {
  switch (type) {
    case 'bool': return false;
    case 'date': return new Date().toISOString();
    case 'string[]': return [];
    case 'bool[]': return [];
    default: return '';
  }
}
