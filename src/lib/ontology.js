/**
 * Ontology YAML Parser
 * Parses ontology schema and instance files
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { join, basename } from 'path';

/**
 * Load all YAML files from storage directory
 * @param {string} storagePath - Path to storage directory
 * @returns {object} Parsed ontology data
 */
export function loadOntology(storagePath) {
  if (!existsSync(storagePath)) {
    throw new Error(`Storage path not found: ${storagePath}`);
  }

  const files = readdirSync(storagePath).filter(f => f.endsWith('.yml'));
  const schema = { components: {}, classes: {}, relations: {} };
  const instances = [];

  for (const file of files) {
    const content = readFileSync(join(storagePath, file), 'utf8');
    const docs = parseYamlDocuments(content);
    
    for (const doc of docs) {
      processDocument(doc, schema, instances, file);
    }
  }

  return { schema, instances };
}

/**
 * Parse multi-document YAML content
 * @param {string} content - YAML content
 * @returns {Array} Array of parsed documents
 */
function parseYamlDocuments(content) {
  const docs = content.split(/^---$/m).filter(d => d.trim());
  return docs.map(d => parseYaml(d));
}

/**
 * Process a single YAML document
 */
function processDocument(doc, schema, instances, sourceFile) {
  if (!doc || doc.kind !== 'Ontology') return;

  if (doc.schema) {
    mergeSchema(schema, doc.schema);
  }

  if (doc.spec?.classes) {
    for (const inst of doc.spec.classes) {
      instances.push({ ...inst, _source: sourceFile });
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
