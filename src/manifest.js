// Slice A0 intake-manifest validation.
//
// The manifest is the only input `/route` accepts for Slice A0. It carries
// the human request, objective, scope, exclusions, safe assumptions, and
// exactly one ambiguity classification (design doc section 7.2, section
// 5.1). No inference or model call happens here: a manifest that declares
// `clarification-required` must already carry the gate content it wants
// materialized (question, consequence, options, non-binding recommendation).

export const AMBIGUITY_CLASSIFICATIONS = Object.freeze([
  'executable',
  'assumption-permitted',
  'clarification-required',
]);

export class ManifestValidationError extends Error {
  constructor(errors) {
    super(`intake manifest failed validation: ${errors.join('; ')}`);
    this.name = 'ManifestValidationError';
    this.errors = errors;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonEmptyStringArray(value) {
  return isStringArray(value) && value.length > 0 && value.every((item) => item.trim().length > 0);
}

/**
 * Structurally validate an intake manifest. Returns a list of error
 * messages; an empty list means the manifest is well-formed. Does not
 * touch the filesystem and does not classify ambiguity itself.
 */
export function validateManifest(manifest) {
  const errors = [];

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be a JSON object'];
  }

  if (!isNonEmptyString(manifest.human_request)) {
    errors.push('human_request must be a non-empty string');
  }
  if (!isNonEmptyString(manifest.objective)) {
    errors.push('objective must be a non-empty string');
  }
  if (!isNonEmptyStringArray(manifest.scope)) {
    errors.push('scope must be a non-empty array of non-empty strings');
  }
  if (!isNonEmptyStringArray(manifest.allowed_paths)) {
    errors.push('allowed_paths must be a non-empty array of non-empty strings');
  }
  if (!isStringArray(manifest.forbidden_paths)) {
    errors.push('forbidden_paths must be an array of strings');
  }
  if (!isStringArray(manifest.non_goals)) {
    errors.push('non_goals must be an array of strings');
  }
  if (!isStringArray(manifest.exclusions)) {
    errors.push('exclusions must be an array of strings');
  }
  if (!isStringArray(manifest.safe_assumptions)) {
    errors.push('safe_assumptions must be an array of strings');
  }

  const ambiguity = manifest.ambiguity;
  if (ambiguity === null || typeof ambiguity !== 'object' || Array.isArray(ambiguity)) {
    errors.push('ambiguity must be an object with exactly one classification');
  } else {
    const classification = ambiguity.classification;
    if (typeof classification !== 'string' || !AMBIGUITY_CLASSIFICATIONS.includes(classification)) {
      errors.push(
        `ambiguity.classification must be exactly one of: ${AMBIGUITY_CLASSIFICATIONS.join(', ')}`,
      );
    } else if (classification === 'clarification-required') {
      if (!isNonEmptyString(ambiguity.question)) {
        errors.push('ambiguity.question must be a non-empty string when classification is clarification-required');
      }
      if (!isNonEmptyString(ambiguity.consequence)) {
        errors.push('ambiguity.consequence must be a non-empty string when classification is clarification-required');
      }
      if (!isNonEmptyStringArray(ambiguity.options) || ambiguity.options.length < 2) {
        errors.push('ambiguity.options must contain at least two non-empty strings when classification is clarification-required');
      }
      if (!isNonEmptyString(ambiguity.recommendation)) {
        errors.push('ambiguity.recommendation must be a non-empty string when classification is clarification-required');
      }
    }
  }

  return errors;
}

/**
 * Validate a manifest and throw ManifestValidationError if it is malformed
 * or incomplete. Returns the manifest unchanged on success.
 */
export function assertValidManifest(manifest) {
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new ManifestValidationError(errors);
  }
  return manifest;
}
