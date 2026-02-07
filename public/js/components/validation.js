/**
 * Data Validation Component
 * Type checking, required fields, relation integrity
 */

/**
 * Validation error object
 */
class ValidationError {
  constructor(field, message, type = 'error') {
    this.field = field;
    this.message = message;
    this.type = type; // 'error' | 'warning'
  }
}

/**
 * Validate a value against a type
 */
function validateType(value, type, required = false) {
  const errors = [];

  // Check required
  if (required && (value === null || value === undefined || value === '')) {
    errors.push(new ValidationError(null, 'Field is required', 'error'));
    return errors;
  }

  // Skip type check for empty non-required fields
  if (value === null || value === undefined || value === '') {
    return errors;
  }

  switch (type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(new ValidationError(null, `Expected string, got ${typeof value}`));
      }
      break;

    case 'int':
    case 'integer':
      if (!Number.isInteger(Number(value))) {
        errors.push(new ValidationError(null, 'Expected integer'));
      }
      break;

    case 'float':
    case 'double':
    case 'number':
      if (isNaN(Number(value))) {
        errors.push(new ValidationError(null, 'Expected number'));
      }
      break;

    case 'bool':
    case 'boolean':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        errors.push(new ValidationError(null, 'Expected boolean'));
      }
      break;

    case 'date':
      if (isNaN(Date.parse(value))) {
        errors.push(new ValidationError(null, 'Invalid date format'));
      }
      break;

    case 'string[]':
    case 'array':
      if (!Array.isArray(value)) {
        try {
          JSON.parse(value);
        } catch {
          errors.push(new ValidationError(null, 'Expected array'));
        }
      }
      break;

    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        try {
          JSON.parse(value);
        } catch {
          errors.push(new ValidationError(null, 'Expected object'));
        }
      }
      break;
  }

  return errors;
}

/**
 * Validate relation target exists
 */
function validateRelationTarget(targetId, instances) {
  if (!targetId) {
    return [new ValidationError(null, 'Relation target is empty')];
  }

  const exists = instances.some(i => i._id === targetId);
  if (!exists) {
    return [new ValidationError(null, `Target entity "${targetId}" not found`, 'warning')];
  }

  return [];
}

/**
 * Validate cardinality constraints
 */
function validateCardinality(relations, cardinality) {
  const errors = [];
  const count = Array.isArray(relations) ? relations.length : (relations ? 1 : 0);

  switch (cardinality) {
    case 'oto': // one-to-one
      if (count > 1) {
        errors.push(new ValidationError(null, 'One-to-one relation allows only 1 target'));
      }
      break;

    case 'otm': // one-to-many
      // No constraint on count
      break;

    case 'mto': // many-to-one
      if (count > 1) {
        errors.push(new ValidationError(null, 'Many-to-one relation allows only 1 target'));
      }
      break;

    case 'mtm': // many-to-many
      // No constraint on count
      break;
  }

  return errors;
}

/**
 * Validate an entire instance
 */
function validateInstance(instance, schema, allInstances) {
  const errors = [];
  const classDef = schema.classes?.[instance._class];
  
  if (!classDef) {
    errors.push(new ValidationError('_class', `Unknown class: ${instance._class}`));
    return errors;
  }

  // Validate components
  for (const [localName, componentClass] of Object.entries(classDef.components || {})) {
    const component = schema.components?.[componentClass];
    if (!component?.properties) continue;

    for (const [propName, propDef] of Object.entries(component.properties)) {
      const value = instance.components?.[localName]?.[propName];
      const fieldId = `${localName}.${propName}`;
      
      const typeErrors = validateType(value, propDef.type, propDef.required);
      for (const err of typeErrors) {
        err.field = fieldId;
        errors.push(err);
      }
    }
  }

  // Validate relations
  for (const [relName, targets] of Object.entries(instance.relations || {})) {
    const relDef = schema.relations?.[relName];
    
    if (!relDef) {
      errors.push(new ValidationError(`relations.${relName}`, `Unknown relation: ${relName}`, 'warning'));
      continue;
    }

    // Check cardinality
    const cardErrors = validateCardinality(targets, relDef.cardinality);
    for (const err of cardErrors) {
      err.field = `relations.${relName}`;
      errors.push(err);
    }

    // Check targets exist
    for (const target of (Array.isArray(targets) ? targets : [targets])) {
      const targetId = typeof target === 'string' ? target : target._to;
      const targetErrors = validateRelationTarget(targetId, allInstances);
      for (const err of targetErrors) {
        err.field = `relations.${relName}`;
        errors.push(err);
      }
    }
  }

  return errors;
}

/**
 * Validation state manager
 */
function createValidationState() {
  return {
    errors: new Map(), // Map<instanceId, Map<fieldId, ValidationError[]>>
    
    setErrors(instanceId, fieldId, errors) {
      if (!this.errors.has(instanceId)) {
        this.errors.set(instanceId, new Map());
      }
      this.errors.get(instanceId).set(fieldId, errors);
    },

    getErrors(instanceId, fieldId) {
      return this.errors.get(instanceId)?.get(fieldId) || [];
    },

    hasErrors(instanceId, fieldId = null) {
      if (!this.errors.has(instanceId)) return false;
      if (fieldId === null) {
        for (const errs of this.errors.get(instanceId).values()) {
          if (errs.length > 0) return true;
        }
        return false;
      }
      return (this.errors.get(instanceId)?.get(fieldId)?.length || 0) > 0;
    },

    clear(instanceId = null) {
      if (instanceId) {
        this.errors.delete(instanceId);
      } else {
        this.errors.clear();
      }
    }
  };
}

/**
 * Validation component for Alpine.js
 */
function validationManager() {
  return {
    validationState: createValidationState(),
    showValidationPanel: false,
    validationSummary: [],

    validateCell(instance, columnId, value) {
      const store = Alpine.store('editor');
      const col = store.columns.find(c => c.id === columnId);
      
      if (!col) return [];
      
      const errors = validateType(value, col.type, col.required);
      this.validationState.setErrors(instance._id, columnId, errors);
      
      return errors;
    },

    validateRow(instance) {
      const store = Alpine.store('editor');
      const errors = validateInstance(instance, store.schema, store.instances);
      
      // Group by field
      for (const err of errors) {
        const fieldId = err.field || '_instance';
        const existing = this.validationState.getErrors(instance._id, fieldId);
        this.validationState.setErrors(instance._id, fieldId, [...existing, err]);
      }
      
      return errors;
    },

    validateAll() {
      const store = Alpine.store('editor');
      this.validationState.clear();
      this.validationSummary = [];

      for (const instance of store.instances) {
        const errors = this.validateRow(instance);
        if (errors.length > 0) {
          this.validationSummary.push({
            instanceId: instance._id,
            instanceClass: instance._class,
            errors
          });
        }
      }

      this.showValidationPanel = this.validationSummary.length > 0;
      return this.validationSummary;
    },

    getCellValidationClass(instanceId, columnId) {
      if (this.validationState.hasErrors(instanceId, columnId)) {
        const errors = this.validationState.getErrors(instanceId, columnId);
        const hasError = errors.some(e => e.type === 'error');
        return hasError ? 'ring-2 ring-red-500' : 'ring-2 ring-yellow-500';
      }
      return '';
    },

    getCellValidationTooltip(instanceId, columnId) {
      const errors = this.validationState.getErrors(instanceId, columnId);
      return errors.map(e => e.message).join(', ');
    },

    closeValidationPanel() {
      this.showValidationPanel = false;
    }
  };
}
