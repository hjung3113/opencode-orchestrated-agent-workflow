function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function readVerificationResult(resultText, selectedTaskId, evidenceClaimPath, executionState) {
  const result = JSON.parse(resultText);
  if (result === null || Array.isArray(result) || typeof result !== 'object') {
    throw new Error('verification result must be a JSON object');
  }
  if (result.task_id !== selectedTaskId) throw new Error('verification result task_id must match the selected task');
  if (!['passed', 'failed'].includes(result.verdict)) throw new Error('verification result verdict must be passed or failed');
  if (!isNonEmptyString(result.verified_by)) throw new Error('verification result verified_by must be a non-empty string');
  if (result.evidence_claim_path !== evidenceClaimPath) throw new Error('verification result evidence_claim_path must match the recorded evidence claim');
  if (!Array.isArray(result.criteria_results) || result.criteria_results.length === 0 || !result.criteria_results.every((item) =>
    item !== null && !Array.isArray(item) && typeof item === 'object' && isNonEmptyString(item.criterion) && isNonEmptyString(item.evidence) && ['passed', 'failed'].includes(item.result))) {
    throw new Error('verification result criteria_results must contain criterion, result, and evidence');
  }
  if (result.verdict === 'passed' && (executionState !== 'succeeded' || result.criteria_results.some((item) => item.result !== 'passed'))) {
    throw new Error('a passed verification result requires a succeeded task and all criteria passed');
  }
  return result;
}
