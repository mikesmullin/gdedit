/**
 * Instance Operations
 * CRUD operations for ontology instances
 */
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { serializeInstance } from './ontology.js';
import {
  listOntologyFiles,
  parseStorageFile,
  serializeStorageFileContent,
  getRelativeStoragePath
} from './storage-format.js';

/**
 * Find which file contains a given instance
 * @param {string} storagePath - Storage directory  
 * @param {string} instanceId - Instance ID
 * @param {string} instanceClass - Instance class
 * @returns {string|null} Filename if found, null otherwise
 */
function findInstanceFile(storagePath, instanceId, instanceClass) {
  const files = listOntologyFiles(storagePath);
  
  for (const filePath of files) {
    const { docs } = parseStorageFile(filePath);

    for (const doc of docs) {
      if (!doc || doc.kind !== 'Ontology') continue;

      const found = doc.spec?.classes?.some(
        c => c._id === instanceId && c._class === instanceClass
      );
      if (found) return getRelativeStoragePath(storagePath, filePath);
    }
  }
  
  return null;
}

/**
 * Save instance to storage
 * Updates existing file if instance came from a multi-doc file,
 * otherwise creates/updates a dedicated file for the instance.
 * 
 * @param {string} storagePath - Storage directory
 * @param {object} instance - Instance to save
 * @param {string} namespace - Namespace
 */
export function saveInstance(storagePath, instance, namespace = 'stormy') {
  const sourceFile = instance._source;
  
  // Remove internal fields before saving
  const cleanInstance = { ...instance };
  delete cleanInstance._source;
  
  // If instance has a source file, try to update it in place
  if (sourceFile) {
    const sourceFilePath = join(storagePath, sourceFile);
    if (existsSync(sourceFilePath)) {
      const updated = updateInstanceInFile(sourceFilePath, cleanInstance, namespace);
      if (updated) return sourceFilePath;
    }
  }
  
  // Check if instance exists in ANY file before creating a new one
  const existingFile = findInstanceFile(storagePath, cleanInstance._id, cleanInstance._class);
  if (existingFile) {
    const existingPath = join(storagePath, existingFile);
    const updated = updateInstanceInFile(existingPath, cleanInstance, namespace);
    if (updated) return existingPath;
  }
  
  // Fallback: create dedicated file for this NEW instance
  const filePath = join(storagePath, instance._class, `${instance._id}.md`);
  mkdirSync(dirname(filePath), { recursive: true });
  
  const yamlDoc = serializeInstance(cleanInstance, namespace);
  const body = `# ${instance._class}/${instance._id}\n\n`;
  const content = `---\n${yamlDoc.trim()}\n---\n${body}`;
  writeFileSync(filePath, content, 'utf8');
  
  return filePath;
}

/**
 * Update an instance within a multi-document YAML file
 * @param {string} filePath - Path to the YAML file
 * @param {object} instance - Updated instance data
 * @param {string} namespace - Namespace
 * @returns {boolean} True if updated, false if not found
 */
function updateInstanceInFile(filePath, instance, namespace) {
  const { docs, body } = parseStorageFile(filePath);
  
  let found = false;
  for (const doc of docs) {
    if (!doc || doc.kind !== 'Ontology') continue;

    if (doc.spec?.classes) {
      const idx = doc.spec.classes.findIndex(
        c => c._id === instance._id && c._class === instance._class
      );

      if (idx !== -1) {
        doc.spec.classes[idx] = instance;
        found = true;
        break;
      }
    }
  }
  
  if (found) {
    const newContent = serializeStorageFileContent(filePath, docs, body);
    writeFileSync(filePath, newContent, 'utf8');
  }
  
  return found;
}

/**
 * Delete instance from storage
 * Handles both dedicated files and multi-document files
 * 
 * @param {string} storagePath - Storage directory
 * @param {object} instance - Instance to delete
 */
export function deleteInstance(storagePath, instance) {
  const sourceFile = instance._source;
  
  if (sourceFile) {
    const sourceFilePath = join(storagePath, sourceFile);
    if (existsSync(sourceFilePath)) {
      const removed = removeInstanceFromFile(sourceFilePath, instance);
      if (removed) return true;
    }
  }
  
  // Fallback: try dedicated markdown file (new format)
  const newFilePath = join(storagePath, instance._class, `${instance._id}.md`);
  if (existsSync(newFilePath)) {
    unlinkSync(newFilePath);
    return true;
  }

  // Legacy fallback: old dedicated yaml file
  const filename = `${instance._class.toLowerCase()}-${instance._id}.yml`;
  const filePath = join(storagePath, filename);
  
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Remove an instance from a multi-document YAML file
 * @param {string} filePath - Path to the YAML file
 * @param {object} instance - Instance to remove
 * @returns {boolean} True if removed
 */
function removeInstanceFromFile(filePath, instance) {
  const { docs, body } = parseStorageFile(filePath);
  
  let found = false;
  for (const doc of docs) {
    if (!doc || doc.kind !== 'Ontology') continue;

    if (doc.spec?.classes) {
      const idx = doc.spec.classes.findIndex(
        c => c._id === instance._id && c._class === instance._class
      );

      if (idx !== -1) {
        doc.spec.classes.splice(idx, 1);
        found = true;
        break;
      }
    }
  }

  if (found) {
    const remainingDocs = docs.filter(doc => {
      if (!doc) return false;
      if (doc.schema) return true;
      if (doc.spec?.classes && Array.isArray(doc.spec.classes)) {
        return doc.spec.classes.length > 0;
      }
      return false;
    });

    if (remainingDocs.length > 0) {
      const newContent = serializeStorageFileContent(filePath, remainingDocs, body);
      writeFileSync(filePath, newContent, 'utf8');
    } else {
      unlinkSync(filePath);
    }
  }
  
  return found;
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
