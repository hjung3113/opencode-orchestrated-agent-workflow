export function readResultClaim(resultText) {
  const status = /^status:\s*(\S[^\r\n]*)\s*$/m.exec(resultText)?.[1];
  const outcome = /^outcome:\s*(\S[^\r\n]*)\s*$/m.exec(resultText)?.[1];
  return { status, outcome };
}
