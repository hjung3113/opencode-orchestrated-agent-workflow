// Renders a Slice A0 human gate: question, consequence, options, a
// non-binding recommendation, and the current answer state
// (design doc section 2.3 / 7.2).

export const GATE_ID = 'gate-1';

export function renderGateMarkdown(ambiguity) {
  const optionsList = ambiguity.options.map((option) => `- ${option}`).join('\n');
  return `# Gate: ${GATE_ID}

## Question

${ambiguity.question}

## Consequence

${ambiguity.consequence}

## Options

${optionsList}

## Recommendation (non-binding)

${ambiguity.recommendation}

## Answer

status: unanswered
answer:
`;
}

/**
 * Read the deliberately small, human-editable answer record from a gate.
 * A gate is usable only when the human has made both its state and answer
 * explicit; an answered status without an answer is a structural failure.
 */
export function readGateAnswer(gateText) {
  const status = /^status:\s*(\S[^\r\n]*)\s*$/m.exec(gateText)?.[1];
  const answer = /^answer:\s*(\S[^\r\n]*)\s*$/m.exec(gateText)?.[1];
  return { status, answer };
}
