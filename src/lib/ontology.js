/**
 * Ontology YAML Parser
 * Parses ontology schema and instance files
 */
import { existsSync } from 'fs';
import { stringify as stringifyYaml } from 'yaml';
import { join } from 'path';
import {
  listOntologyFiles,
  parseStorageFile,
  getRelativeStoragePath,
  extractWikiLinks
} from './storage-format.js';

/**
 * Load all YAML files from storage directory
 * @param {string} storagePath - Path to storage directory
 * @returns {object} Parsed ontology data
 */
export function loadOntology(storagePath) {
  if (!existsSync(storagePath)) {
    throw new Error(`Storage path not found: ${storagePath}`);
  }

  const files = listOntologyFiles(storagePath);
  const schema = { components: {}, classes: {}, relations: {} };
  const instances = [];

  for (const filePath of files) {
    const { docs, body } = parseStorageFile(filePath);
    const sourceFile = getRelativeStoragePath(storagePath, filePath);
    
    for (const doc of docs) {
      processDocument(doc, schema, instances, sourceFile, body);
    }
  }

  return { schema, instances };
}

/**
 * Process a single YAML document
 */
function processDocument(doc, schema, instances, sourceFile, markdownBody = '') {
  if (!doc || doc.kind !== 'Ontology') return;

  if (doc.schema) {
    mergeSchema(schema, doc.schema);
  }

  if (doc.spec?.classes) {
    for (const inst of doc.spec.classes) {
      const mergedRelations = { ...(inst.relations || {}) };
      if (markdownBody) {
        const links = extractWikiLinks(markdownBody);
        if (links.length > 0) {
          const ids = links.map(l => l.id);
          const uniqueIds = [...new Set(ids)];
          if (uniqueIds.length > 0) {
            mergedRelations.LINKS_TO = uniqueIds;
          }
        }
      }

      instances.push({
        ...inst,
        relations: mergedRelations,
        _source: sourceFile
      });
    }
  }
}

/**
 * Merge schema definitions
 */
function mergeSchema(target, source) {
  if (source.components) {
    Object.assign(target.components, source.components);
  }
  if (source.classes) {
    Object.assign(target.classes, source.classes);
  }
  if (source.relations) {
    Object.assign(target.relations, source.relations);
  }
}

/**
 * Get flattened columns for a class
 * @param {object} schema - Schema object
 * @param {string} className - Class name
 * @returns {Array} Array of column definitions
 */
export function getClassColumns(schema, className) {
  const classDef = schema.classes[className];
  if (!classDef?.components) return [];

  const columns = [];
  
  for (const [localName, componentClass] of Object.entries(classDef.components)) {
    const component = schema.components[componentClass];
    if (!component?.properties) continue;

    for (const [propName, propDef] of Object.entries(component.properties)) {
      columns.push({
        id: `${localName}.${propName}`,
        localName,
        property: propName,
        component: componentClass,
        type: propDef.type || 'string',
        required: propDef.required || false
      });
    }
  }

  return columns;
}

/**
 * Get relations for a class
 * @param {object} schema - Schema object
 * @param {string} className - Class name
 * @returns {Array} Array of relation definitions
 */
export function getClassRelations(schema, className) {
  const relations = [];
  
  for (const [name, def] of Object.entries(schema.relations || {})) {
    if (def.domain === className) {
      relations.push({ name, ...def, direction: 'outgoing' });
    }
    if (def.range === className) {
      relations.push({ name, ...def, direction: 'incoming' });
    }
  }

  return relations;
}

/**
 * Serialize instance to YAML
 * @param {object} instance - Instance object
 * @param {string} namespace - Namespace
 * @returns {string} YAML string
 */
export function serializeInstance(instance, namespace) {
  const doc = {
    apiVersion: 'agent/v1',
    kind: 'Ontology',
    metadata: { namespace },
    spec: {
      classes: [instance]
    }
  };
  
  return stringifyYaml(doc);
}
