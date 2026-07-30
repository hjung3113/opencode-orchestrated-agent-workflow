import path from 'node:path';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function assertStringList(value, field, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || !value.every(isNonEmptyString)) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
}

export function readEvidenceClaim(claimText, selectedTaskId) {
  const claim = JSON.parse(claimText);
  if (claim === null || Array.isArray(claim) || typeof claim !== 'object') {
    throw new Error('evidence claim must be a JSON object');
  }
  if (claim.task_id !== selectedTaskId) {
    throw new Error('evidence claim task_id must match the selected task');
  }
  assertStringList(claim.commands, 'evidence claim commands');
  assertStringList(claim.changed_files, 'evidence claim changed_files', true);
  if (claim.changed_files.some((file) => path.isAbsolute(file) || file.split('/').includes('..'))) {
    throw new Error('evidence claim changed_files must be repository-relative without .. segments');
  }
  if (!Array.isArray(claim.acceptance_mapping) || claim.acceptance_mapping.length === 0 || !claim.acceptance_mapping.every((item) =>
    item !== null && !Array.isArray(item) && typeof item === 'object' && isNonEmptyString(item.criterion) && isNonEmptyString(item.evidence))) {
    throw new Error('evidence claim acceptance_mapping must contain criterion and evidence strings');
  }
  return claim;
}
