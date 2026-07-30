export class V2RouteRefusal extends Error {
  constructor(refusal, message) {
    super(message);
    this.name = 'V2RouteRefusal';
    this.refusal = refusal;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value, required = false) {
  return Array.isArray(value) && (!required || value.length > 0) && value.every(nonEmptyString);
}

function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  return value;
}

export function assertV2Declaration(declaration) {
  if (!Number.isInteger(declaration?.schema_version) || declaration.schema_version !== 2) {
    throw new V2RouteRefusal('schema-version-unsupported', 'schema_version must be integer 2');
  }
  const errors = [];
  if (!safeId(declaration.run_id)) errors.push('run_id must be a safe identifier');
  if (declaration.max_concurrency !== 1) errors.push('max_concurrency must be integer 1');
  if (!Array.isArray(declaration.tasks) || declaration.tasks.length === 0) errors.push('tasks must be a non-empty array');

  const earlierIds = new Set();
  for (const [index, task] of (Array.isArray(declaration.tasks) ? declaration.tasks : []).entries()) {
    const prefix = `tasks[${index}]`;
    if (!isObject(task)) { errors.push(`${prefix} must be an object`); continue; }
    if (!safeId(task.id) || earlierIds.has(task.id)) errors.push(`${prefix}.id must be a unique safe identifier`);
    if (!nonEmptyString(task.objective)) errors.push(`${prefix}.objective must be a non-empty string`);
    for (const field of ['scope', 'allowed_paths', 'acceptance_criteria', 'evidence_required']) {
      if (!stringArray(task[field], true)) errors.push(`${prefix}.${field} must be a non-empty string array`);
    }
    for (const field of ['forbidden_paths', 'non_goals', 'dependencies', 'required_decision_references']) {
      if (!stringArray(task[field])) errors.push(`${prefix}.${field} must be a string array`);
    }
    if (Array.isArray(task.dependencies) && (new Set(task.dependencies).size !== task.dependencies.length || task.dependencies.some((id) => !earlierIds.has(id)))) {
      errors.push(`${prefix}.dependencies must contain unique earlier task ids`);
    }
    if (Array.isArray(task.required_decision_references) && task.required_decision_references.length !== 0) errors.push(`${prefix}.required_decision_references must be empty`);
    if (!Number.isInteger(task.retry_budget) || task.retry_budget < 0) errors.push(`${prefix}.retry_budget must be a non-negative integer`);
    if (safeId(task.id)) earlierIds.add(task.id);
  }
  if (errors.length) throw new V2RouteRefusal('v2-declaration-invalid', errors.join('; '));
  return canonicalJson(declaration);
}
