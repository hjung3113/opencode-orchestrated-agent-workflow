// Validates ORCHESTRATOR_RUN_STATE_DIR against the boundary in
// docs/development-environment.md and AGENTS.md: absolute, not inside this
// checkout, and not a developer-tool directory (Matt Pocock skills homes).

import os from 'node:os';
import path from 'node:path';

export class StateRootValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateRootValidationError';
  }
}

function isInside(candidate, ancestor) {
  const rel = path.relative(ancestor, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const DEFAULT_DEVELOPER_TOOL_DIR_NAMES = Object.freeze(['.codex', '.agents']);

/**
 * @param {string} stateRoot - candidate ORCHESTRATOR_RUN_STATE_DIR value
 * @param {object} opts
 * @param {string} opts.checkoutRoot - absolute path to this repository checkout
 * @param {string} [opts.homeDir] - absolute path to the user's home directory; defaults to os.homedir()
 * @param {string[]} [opts.developerToolDirNames] - dir names under home that are developer tooling
 */
export function assertValidStateRoot(stateRoot, opts) {
  const { checkoutRoot, homeDir = os.homedir(), developerToolDirNames = DEFAULT_DEVELOPER_TOOL_DIR_NAMES } = opts;

  if (typeof stateRoot !== 'string' || stateRoot.length === 0) {
    throw new StateRootValidationError('ORCHESTRATOR_RUN_STATE_DIR must be a non-empty string');
  }
  if (!path.isAbsolute(stateRoot)) {
    throw new StateRootValidationError(`ORCHESTRATOR_RUN_STATE_DIR must be an absolute path, got: ${stateRoot}`);
  }

  const normalizedRoot = path.normalize(stateRoot);
  const normalizedCheckout = path.normalize(checkoutRoot);

  if (isInside(normalizedRoot, normalizedCheckout)) {
    throw new StateRootValidationError(
      `ORCHESTRATOR_RUN_STATE_DIR must not be inside the checkout (${normalizedCheckout}), got: ${normalizedRoot}`,
    );
  }

  if (homeDir) {
    const normalizedHome = path.normalize(homeDir);
    for (const dirName of developerToolDirNames) {
      const devToolDir = path.normalize(path.join(normalizedHome, dirName));
      if (isInside(normalizedRoot, devToolDir)) {
        throw new StateRootValidationError(
          `ORCHESTRATOR_RUN_STATE_DIR must not be inside a developer-tool directory (${devToolDir}), got: ${normalizedRoot}`,
        );
      }
    }
  }

  return normalizedRoot;
}
