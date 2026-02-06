/**
 * Instance Operations
 * CRUD operations for ontology instances
 */
import { writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { serializeInstance } from './ontology.js';

/**
 * Find which file contains a given instance
 * @param {string} storagePath - Storage directory  
 * @param {string} instanceId - Instance ID
 * @param {string} instanceClass - Instance class
 * @returns {string|null} Filename if found, null otherwise
 */
function findInstanceFile(storagePath, instanceId, instanceClass) {
  const files = readdirSync(storagePath).filter(f => f.endsWith('.yml'));
  
  for (const file of files) {
    const content = readFileSync(join(storagePath, file), 'utf8');
    const docs = content.split(/^---$/m).filter(d => d.trim());
    
    for (const docStr of docs) {
      try {
        const doc = parseYaml(docStr);
        if (!doc || doc.kind !== 'Ontology') continue;
        
        const found = doc.spec?.classes?.some(
          c => c._id === instanceId && c._class === instanceClass
        );
        if (found) return file;
      } catch {
        // Skip malformed docs
      }
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
  const filename = `${instance._class.toLowerCase()}-${instance._id}.yml`;
  const filePath = join(storagePath, filename);
  
  const yaml = serializeInstance(cleanInstance, namespace);
  writeFileSync(filePath, yaml, 'utf8');
  
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
  const content = readFileSync(filePath, 'utf8');
  const docSeparator = '\n---\n';
  const docs = content.split(/^---$/m);
  
  let found = false;
  const updatedDocs = docs.map(docStr => {
    if (!docStr.trim()) return docStr;
    
    try {
      const doc = parseYaml(docStr);
      if (!doc || doc.kind !== 'Ontology') return docStr;
      
      // Check if this doc contains our instance
      if (doc.spec?.classes) {
        const idx = doc.spec.classes.findIndex(
          c => c._id === instance._id && c._class === instance._class
        );
        
        if (idx !== -1) {
          // Update the instance in place
          doc.spec.classes[idx] = instance;
          found = true;
          return stringifyYaml(doc);
        }
      }
      
      return docStr;
    } catch {
      return docStr;
    }
  });
  
  if (found) {
    // Rejoin documents, preserving the --- separators
    // Ensure each doc ends with newline before the separator
    const newContent = updatedDocs
      .map((d, i) => {
        const trimmed = d.trim();
        if (i === 0) return trimmed;
        return trimmed;
      })
      .filter(d => d) // Remove empty docs
      .join('\n---\n');
    writeFileSync(filePath, newContent + '\n', 'utf8');
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
  
  // Fallback: try dedicated file
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
  const content = readFileSync(filePath, 'utf8');
  const docs = content.split(/^---$/m);
  
  let found = false;
  const updatedDocs = docs.map(docStr => {
    if (!docStr.trim()) return docStr;
    
    try {
      const doc = parseYaml(docStr);
      if (!doc || doc.kind !== 'Ontology') return docStr;
      
      if (doc.spec?.classes) {
        const idx = doc.spec.classes.findIndex(
          c => c._id === instance._id && c._class === instance._class
        );
        
        if (idx !== -1) {
          doc.spec.classes.splice(idx, 1);
          found = true;
          
          // If no more instances in this doc, return empty to remove it
          if (doc.spec.classes.length === 0) {
            return '';
          }
          return stringifyYaml(doc);
        }
      }
      
      return docStr;
    } catch {
      return docStr;
    }
  });
  
  if (found) {
    const newContent = updatedDocs
      .map(d => d.trim())
      .filter(d => d)
      .join('\n---\n');
    
    if (newContent.trim()) {
      writeFileSync(filePath, newContent + '\n', 'utf8');
    } else {
      // File is now empty, delete it
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
