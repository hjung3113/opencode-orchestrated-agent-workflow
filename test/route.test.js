import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  computeRunId,
  route,
  RouteStructureError,
  UnsupportedAmbiguityClassificationError,
} from '../src/route.js';
import { ManifestValidationError, validateManifest } from '../src/manifest.js';
import { StateRootValidationError } from '../src/state-root.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkoutRoot = path.resolve(here, '..');
const fixturesDir = path.join(here, 'fixtures');
const cliPath = path.join(checkoutRoot, 'bin', 'route.js');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
}

function makeTmpStateRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'route-a0-'));
}

function makeTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'route-a0-home-'));
}

function listAllFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAllFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function answerGate(blocked, answer = 'Exclude blocked runs.') {
  fs.writeFileSync(
    blocked.gatePath,
    `${fs.readFileSync(blocked.gatePath, 'utf8').replace('status: unanswered', 'status: answered').replace('answer:\n', `answer: ${answer}\n`)}`,
    'utf8',
  );
}

function writeResultClaim(routed, content) {
  const resultPath = path.join(
    routed.runDir,
    'tasks',
    routed.graph.selected_task,
    'result.md',
  );
  fs.writeFileSync(resultPath, content, 'utf8');
  return resultPath;
}

function writeEvidenceClaim(routed, claim) {
  const claimPath = path.join(
    routed.runDir,
    'tasks',
    routed.graph.selected_task,
    'evidence-claim.json',
  );
  fs.writeFileSync(claimPath, typeof claim === 'string' ? claim : `${JSON.stringify(claim, null, 2)}\n`, 'utf8');
  return claimPath;
}

function validEvidenceClaim(taskId) {
  return {
    task_id: taskId,
    commands: ['npm test'],
    changed_files: [],
    acceptance_mapping: [{
      criterion: 'The implementation satisfies the stated objective within the declared allowed paths.',
      evidence: 'npm test passed',
    }],
  };
}

function writeVerificationResult(routed, result) {
  const resultPath = path.join(routed.runDir, 'tasks', routed.graph.selected_task, 'verification.json');
  fs.writeFileSync(resultPath, typeof result === 'string' ? result : `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return resultPath;
}

function validVerificationResult(taskId, verdict = 'passed') {
  return {
    task_id: taskId,
    verdict,
    verified_by: 'independent-verifier',
    evidence_claim_path: `tasks/${taskId}/evidence-claim.json`,
    criteria_results: [{ criterion: 'Record the declared graph contract.', result: verdict, evidence: 'Observed graph.json.' }],
  };
}

test('clarification-required manifest writes request, empty decisions, revision-one blocked graph, and one unanswered gate', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');

  const result = route(manifest, { stateRoot, checkoutRoot });

  assert.equal(result.created, true);
  assert.equal(fs.existsSync(result.requestPath), true);
  assert.equal(fs.existsSync(result.decisionsPath), true);
  assert.equal(fs.existsSync(result.gatePath), true);

  const decisions = JSON.parse(fs.readFileSync(result.decisionsPath, 'utf8'));
  assert.deepEqual(decisions, { decisions: [] });

  assert.equal(result.graph.revision, 1);
  assert.equal(result.graph.status, 'blocked');
  assert.equal(result.graph.selected_task, null);
  assert.deepEqual(result.graph.tasks, []);
  assert.equal(result.graph.gates.length, 1);

  const gateFiles = fs.readdirSync(path.dirname(result.gatePath));
  assert.deepEqual(gateFiles, ['gate-1.md']);

  const gateText = fs.readFileSync(result.gatePath, 'utf8');
  assert.match(gateText, /## Question/);
  assert.match(gateText, /## Consequence/);
  assert.match(gateText, /## Options/);
  assert.match(gateText, /## Recommendation \(non-binding\)/);
  assert.match(gateText, /## Answer/);
  assert.match(gateText, /status: unanswered/);
  assert.match(gateText, /Should the export include runs still blocked on a human gate\?/);
});

test('blocked graph selects no task and no packet is rendered', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');

  const result = route(manifest, { stateRoot, checkoutRoot });

  assert.equal(result.graph.selected_task, null);
  const allFiles = listAllFiles(result.runDir);
  const packetFiles = allFiles.filter((f) => path.basename(f) === 'packet.md');
  assert.deepEqual(packetFiles, []);
});

test('no worker process, result.md, or evidence-claim artifact is created', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');

  const result = route(manifest, { stateRoot, checkoutRoot });

  const allFiles = listAllFiles(result.runDir);
  assert.equal(fs.existsSync(path.join(result.runDir, 'tasks')), false);
  assert.deepEqual(
    allFiles.filter((f) => path.basename(f) === 'result.md'),
    [],
  );
  assert.deepEqual(
    allFiles.filter((f) => path.basename(f) === 'evidence-claim.json'),
    [],
  );
});

test('re-routing the unchanged manifest is idempotent: no second gate, graph revision unchanged', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');

  const first = route(manifest, { stateRoot, checkoutRoot });
  const second = route(manifest, { stateRoot, checkoutRoot });

  assert.equal(first.runId, second.runId);
  assert.equal(second.created, false);
  assert.equal(second.graph.revision, 1);

  const gateFiles = fs.readdirSync(path.join(second.runDir, 'gates'));
  assert.deepEqual(gateFiles, ['gate-1.md']);
});

test('malformed manifest (missing objective) is rejected before any run artifact is written', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('malformed-missing-objective.json');

  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), ManifestValidationError);
  assert.deepEqual(fs.readdirSync(stateRoot), []);
});

test('manifest with more than one field on ambiguity.classification value is rejected', () => {
  const manifest = loadFixture('clarification-required.json');
  const bad = { ...manifest, ambiguity: { ...manifest.ambiguity, classification: ['clarification-required'] } };
  const errors = validateManifest(bad);
  assert.ok(errors.length > 0);
});

test('packet scope fields are separate typed manifest fields', () => {
  const manifest = loadFixture('executable.json');
  const errors = validateManifest({
    ...manifest,
    allowed_paths: ['src/export.js'],
    forbidden_paths: 'src/ui/**',
    non_goals: ['Build a dashboard or UI'],
  });
  assert.ok(errors.includes('forbidden_paths must be an array of strings'));
});

test('manifest with assumption-permitted classification is rejected before routing', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');
  const assumptionPermitted = {
    ...manifest,
    ambiguity: { classification: 'assumption-permitted' },
  };

  assert.throws(
    () => route(assumptionPermitted, { stateRoot, checkoutRoot }),
    UnsupportedAmbiguityClassificationError,
  );
  assert.deepEqual(fs.readdirSync(stateRoot), []);
});

test('an answered gate is recorded as decision provenance before one pending task and immutable packet are selected', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');
  const blocked = route(manifest, { stateRoot, checkoutRoot });

  answerGate(blocked);
  const selected = route(manifest, { stateRoot, checkoutRoot });

  assert.equal(selected.graph.revision, 2);
  assert.equal(selected.graph.selected_task, 'task-1');
  assert.equal(selected.graph.tasks.length, 1);
  assert.deepEqual(selected.graph.tasks[0], {
    id: 'task-1',
    execution_state: 'pending',
    acceptance_state: 'pending',
    graph_revision: 2,
    dependencies: [],
  });
  const decisions = JSON.parse(fs.readFileSync(selected.decisionsPath, 'utf8'));
  assert.deepEqual(decisions, {
    decisions: [{
      id: 'decision-gate-1',
      source_gate: 'gates/gate-1.md',
      answer: 'Exclude blocked runs.',
      recorded_by: 'human',
    }],
  });
  const packet = fs.readFileSync(selected.packetPath, 'utf8');
  for (const heading of [
    '## Objective',
    '## Inputs and source artifacts',
    '## Allowed paths',
    '## Forbidden paths',
    '## Non-goals',
    '## Expected outputs',
    '## Acceptance criteria',
    '## Evidence required',
    '## Preconditions and dependent tasks',
  ]) assert.match(packet, new RegExp(heading));
  assert.match(packet, /## Allowed paths\n\n- src\/export\.js/);
  assert.match(packet, /## Forbidden paths\n\n- src\/ui\/\*\*/);
  assert.match(packet, /## Non-goals\n\n- Build a dashboard or UI/);
  assert.match(packet, /Graph revision: 2/);
  assert.match(selected.manualHandoff, /Give .*packet\.md to one worker manually/);

  const rerouted = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(rerouted.created, false);
  assert.equal(fs.readFileSync(rerouted.packetPath, 'utf8'), packet);
});

test('deep manifest differences receive distinct run IDs and distinct gate or executable runs', () => {
  const stateRoot = makeTmpStateRoot();
  const gate = loadFixture('clarification-required.json');
  const changedGate = {
    ...gate,
    scope: [...gate.scope, 'test/export-format.test.js'],
    ambiguity: { ...gate.ambiguity, recommendation: 'Include blocked runs after audience confirmation.' },
  };
  const executable = loadFixture('executable.json');
  const changedExecutable = {
    ...executable,
    exclusions: [...executable.exclusions, 'No retry queue'],
  };

  assert.notEqual(computeRunId(gate), computeRunId(changedGate));
  assert.notEqual(computeRunId(executable), computeRunId(changedExecutable));
  const firstGate = route(gate, { stateRoot, checkoutRoot });
  const secondGate = route(changedGate, { stateRoot, checkoutRoot });
  const firstExecutable = route(executable, { stateRoot, checkoutRoot });
  const secondExecutable = route(changedExecutable, { stateRoot, checkoutRoot });

  assert.notEqual(firstGate.runId, secondGate.runId);
  assert.notEqual(firstGate.runDir, secondGate.runDir);
  assert.notEqual(firstExecutable.runId, secondExecutable.runId);
  assert.notEqual(firstExecutable.runDir, secondExecutable.runDir);
});

test('a selected answered-gate run rejects removed or mismatched decision provenance on re-route', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');
  const blocked = route(manifest, { stateRoot, checkoutRoot });
  answerGate(blocked);
  const selected = route(manifest, { stateRoot, checkoutRoot });

  fs.writeFileSync(selected.decisionsPath, `${JSON.stringify({ decisions: [] }, null, 2)}\n`, 'utf8');
  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);

  fs.writeFileSync(selected.decisionsPath, `${JSON.stringify({
    decisions: [{
      id: 'decision-gate-1',
      source_gate: 'gates/gate-1.md',
      answer: 'Include blocked runs.',
      recorded_by: 'human',
    }],
  }, null, 2)}\n`, 'utf8');
  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);

  fs.writeFileSync(selected.decisionsPath, `${JSON.stringify({
    decisions: [{
      id: 'decision-gate-1',
      source_gate: 'gates/gate-1.md',
      answer: 'Exclude blocked runs.',
      recorded_by: 'human',
    }],
  }, null, 2)}\n`, 'utf8');
  fs.unlinkSync(selected.gatePath);
  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);
});

test('an executable manifest selects one pending task and emits a manual handoff without claims or worker process artifacts', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('executable.json');
  const result = route(manifest, { stateRoot, checkoutRoot });

  assert.equal(result.created, true);
  assert.equal(result.graph.revision, 1);
  assert.equal(result.graph.selected_task, 'task-1');
  assert.equal(result.graph.tasks.length, 1);
  assert.equal(result.graph.tasks[0].execution_state, 'pending');
  assert.equal(result.graph.tasks[0].graph_revision, 1);
  assert.equal(result.gatePath, null);
  assert.equal(fs.existsSync(result.packetPath), true);
  assert.match(result.manualHandoff, /did not launch a worker/);

  const allFiles = listAllFiles(result.runDir);
  assert.deepEqual(allFiles.filter((file) => /(?:result\.md|evidence-claim\.json)$/.test(file)), []);
  assert.equal(fs.existsSync(path.join(result.runDir, 'tasks', 'task-1', 'worker-claim.json')), false);

  const packet = fs.readFileSync(result.packetPath, 'utf8');
  const legacyPrefix = `# Task: task-1

## Objective

Give operators a daily CSV of failed runs for triage.

## Inputs and source artifacts
`;
  assert.equal(packet.slice(0, legacyPrefix.length), legacyPrefix);
  assert.match(packet, /## Acceptance criteria\n\n- The implementation satisfies the stated objective within the declared allowed paths\./);
  assert.match(packet, /## Evidence required\n\n- Changed-file list mapped to the objective and scope\./);
  assert.match(packet, /No dependent tasks; this is the only selected Phase-1 task\./);
  const rerouted = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(rerouted.created, false);
  assert.equal(fs.readFileSync(rerouted.packetPath, 'utf8'), packet);
});

test('an executable bounded sequence records every task but packetizes only the first selected task', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('bounded-sequence.json');
  const result = route(manifest, { stateRoot, checkoutRoot });

  assert.equal(result.graph.selected_task, 'task-define-contract');
  assert.equal(result.graph.tasks.length, 2);
  assert.deepEqual(result.graph.tasks.map((task) => ({
    id: task.id,
    execution_state: task.execution_state,
    dependencies: task.dependencies,
  })), [
    { id: 'task-define-contract', execution_state: 'pending', dependencies: [] },
    { id: 'task-update-workflow', execution_state: 'blocked', dependencies: ['task-define-contract'] },
  ]);
  assert.equal(fs.existsSync(path.join(result.runDir, 'tasks', 'task-define-contract', 'packet.md')), true);
  assert.equal(fs.existsSync(path.join(result.runDir, 'tasks', 'task-update-workflow', 'packet.md')), false);
  assert.equal(fs.existsSync(path.join(result.runDir, 'tasks', 'task-define-contract', 'worker-claim.json')), false);
  const allFiles = listAllFiles(result.runDir);
  assert.deepEqual(allFiles.filter((file) => /(?:result\.md|evidence-claim\.json)$/.test(file)), []);

  const packet = fs.readFileSync(result.packetPath, 'utf8');
  assert.match(packet, /# Task: task-define-contract/);
  assert.match(packet, /Define the bounded graph artifact contract\./);
  assert.match(packet, /## Scope\n\n- docs\/contracts\/\*\*/);
  assert.equal((packet.match(/## Inputs and source artifacts/g) || []).length, 1);
  assert.match(packet, /## Acceptance criteria\n\n- Record the declared graph contract\./);
  assert.match(packet, /## Evidence required\n\n- Run the contract tests\./);
  assert.match(packet, /- Dependent: task-update-workflow/);
  assert.doesNotMatch(packet, /The implementation satisfies the stated objective/);
  const rerouted = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(rerouted.created, false);
  assert.equal(fs.readFileSync(rerouted.packetPath, 'utf8'), packet);
});

test('a later route records one complete result claim without promoting later tasks or rewriting the packet', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('bounded-sequence.json');
  const first = route(manifest, { stateRoot, checkoutRoot });
  const packet = fs.readFileSync(first.packetPath, 'utf8');

  const withoutResult = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(withoutResult.graph.revision, 1);
  assert.equal(withoutResult.graph.tasks[0].execution_state, 'pending');
  assert.equal(fs.readFileSync(withoutResult.packetPath, 'utf8'), packet);

  writeResultClaim(first, '## Outcome\n\nstatus: pending\n');
  const incomplete = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(incomplete.graph.revision, 1);
  assert.equal(incomplete.graph.tasks[0].execution_state, 'pending');

  writeResultClaim(first, '## Outcome\n\nstatus: complete\noutcome: succeeded\n');
  const recorded = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(recorded.created, false);
  assert.equal(recorded.graph.revision, 2);
  assert.equal(recorded.graph.selected_task, 'task-define-contract');
  assert.deepEqual(recorded.graph.tasks.map((task) => ({
    id: task.id,
    execution_state: task.execution_state,
    acceptance_state: task.acceptance_state,
    evidence_claim: task.evidence_claim,
    graph_revision: task.graph_revision,
  })), [
    { id: 'task-define-contract', execution_state: 'succeeded', acceptance_state: 'pending', evidence_claim: null, graph_revision: 2 },
    { id: 'task-update-workflow', execution_state: 'blocked', acceptance_state: 'pending', evidence_claim: undefined, graph_revision: 2 },
  ]);
  assert.equal(fs.existsSync(path.join(recorded.runDir, 'tasks', 'task-update-workflow', 'packet.md')), false);
  assert.equal(fs.readFileSync(recorded.packetPath, 'utf8'), packet);
  assert.equal(fs.existsSync(path.join(recorded.runDir, 'tasks', 'task-define-contract', 'evidence-claim.json')), false);
  assert.equal(fs.existsSync(path.join(recorded.runDir, 'tasks', 'task-define-contract', 'verification.json')), false);
  assert.equal(fs.existsSync(path.join(recorded.runDir, 'final-receipt.json')), false);

  const rerouted = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(rerouted.graph.revision, 2);
  assert.equal(fs.readFileSync(rerouted.packetPath, 'utf8'), packet);
});

test('a complete failed result claim is recorded for a legacy manifest without changing its task shape', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('executable.json');
  const first = route(manifest, { stateRoot, checkoutRoot });
  const packet = fs.readFileSync(first.packetPath, 'utf8');

  writeResultClaim(first, '## Outcome\n\nstatus: complete\noutcome: failed\n');
  const recorded = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(recorded.graph.revision, 2);
  assert.deepEqual(recorded.graph.tasks, [{
    id: 'task-1',
    execution_state: 'failed',
    acceptance_state: 'pending',
    evidence_claim: null,
    graph_revision: 2,
    dependencies: [],
  }]);
  assert.equal(fs.readFileSync(recorded.packetPath, 'utf8'), packet);
});

test('a complete result claim with no recognized outcome fails without rewriting graph or packet', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('executable.json');
  const first = route(manifest, { stateRoot, checkoutRoot });
  const graph = fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8');
  const packet = fs.readFileSync(first.packetPath, 'utf8');

  writeResultClaim(first, '## Outcome\n\nstatus: complete\noutcome: maybe\n');
  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);
  assert.equal(fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8'), graph);
  assert.equal(fs.readFileSync(first.packetPath, 'utf8'), packet);
});

test('a complete result records one valid evidence-claim reference without accepting it or changing later tasks', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('bounded-sequence.json');
  const first = route(manifest, { stateRoot, checkoutRoot });
  const packet = fs.readFileSync(first.packetPath, 'utf8');

  writeResultClaim(first, '## Outcome\n\nstatus: complete\noutcome: succeeded\n');
  writeEvidenceClaim(first, validEvidenceClaim(first.graph.selected_task));
  const recorded = route(manifest, { stateRoot, checkoutRoot });

  assert.equal(recorded.graph.revision, 2);
  assert.deepEqual(recorded.graph.tasks.map((task) => ({
    id: task.id,
    execution_state: task.execution_state,
    acceptance_state: task.acceptance_state,
    evidence_claim: task.evidence_claim,
    graph_revision: task.graph_revision,
  })), [
    {
      id: 'task-define-contract',
      execution_state: 'succeeded',
      acceptance_state: 'pending',
      evidence_claim: { path: 'tasks/task-define-contract/evidence-claim.json' },
      graph_revision: 2,
    },
    {
      id: 'task-update-workflow',
      execution_state: 'blocked',
      acceptance_state: 'pending',
      evidence_claim: undefined,
      graph_revision: 2,
    },
  ]);
  assert.equal(fs.existsSync(path.join(recorded.runDir, 'tasks', 'task-update-workflow', 'packet.md')), false);
  assert.equal(fs.readFileSync(recorded.packetPath, 'utf8'), packet);
  assert.equal(fs.existsSync(path.join(recorded.runDir, 'tasks', 'task-define-contract', 'verification.json')), false);
  assert.equal(fs.existsSync(path.join(recorded.runDir, 'final-receipt.json')), false);

  const rerouted = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(rerouted.graph.revision, 2);
  assert.deepEqual(rerouted.graph.tasks[0].evidence_claim, { path: 'tasks/task-define-contract/evidence-claim.json' });
  assert.equal(fs.readFileSync(rerouted.packetPath, 'utf8'), packet);
});

test('a terminal task records an independent passed or failed verification without changing execution, packet, or later tasks', () => {
  for (const [outcome, verdict] of [['succeeded', 'passed'], ['failed', 'failed']]) {
    const stateRoot = makeTmpStateRoot();
    const first = route(loadFixture('bounded-sequence.json'), { stateRoot, checkoutRoot });
    const packet = fs.readFileSync(first.packetPath, 'utf8');
    writeResultClaim(first, `## Outcome\n\nstatus: complete\noutcome: ${outcome}\n`);
    writeEvidenceClaim(first, validEvidenceClaim(first.graph.selected_task));
    const terminal = route(loadFixture('bounded-sequence.json'), { stateRoot, checkoutRoot });
    writeVerificationResult(terminal, validVerificationResult(first.graph.selected_task, verdict));

    const accepted = route(loadFixture('bounded-sequence.json'), { stateRoot, checkoutRoot });
    assert.equal(accepted.graph.revision, 3);
    assert.deepEqual(accepted.graph.tasks.map((task) => ({
      id: task.id, execution_state: task.execution_state, acceptance_state: task.acceptance_state,
      verification: task.verification, graph_revision: task.graph_revision,
    })), [
      { id: 'task-define-contract', execution_state: outcome, acceptance_state: verdict, verification: { path: 'tasks/task-define-contract/verification.json' }, graph_revision: 3 },
      { id: 'task-update-workflow', execution_state: 'blocked', acceptance_state: 'pending', verification: undefined, graph_revision: 3 },
    ]);
    assert.equal(fs.readFileSync(accepted.packetPath, 'utf8'), packet);
    assert.equal(fs.existsSync(path.join(accepted.runDir, 'tasks', 'task-update-workflow', 'packet.md')), false);
    assert.equal(fs.existsSync(path.join(accepted.runDir, 'final-receipt.json')), false);

    const rerouted = route(loadFixture('bounded-sequence.json'), { stateRoot, checkoutRoot });
    assert.equal(rerouted.graph.revision, 3);
    assert.equal(fs.readFileSync(rerouted.packetPath, 'utf8'), packet);
  }
});

test('a legacy task retains its shape through independent verification recording', () => {
  const stateRoot = makeTmpStateRoot();
  const first = route(loadFixture('executable.json'), { stateRoot, checkoutRoot });
  writeResultClaim(first, '## Outcome\n\nstatus: complete\noutcome: succeeded\n');
  writeEvidenceClaim(first, validEvidenceClaim('task-1'));
  const terminal = route(loadFixture('executable.json'), { stateRoot, checkoutRoot });
  writeVerificationResult(terminal, validVerificationResult('task-1'));
  const accepted = route(loadFixture('executable.json'), { stateRoot, checkoutRoot });
  assert.deepEqual(accepted.graph.tasks, [{
    id: 'task-1', execution_state: 'succeeded', acceptance_state: 'passed',
    evidence_claim: { path: 'tasks/task-1/evidence-claim.json' },
    verification: { path: 'tasks/task-1/verification.json' }, graph_revision: 3, dependencies: [],
  }]);
});

test('verification is ignored before a terminal claim and rejected without a recorded evidence claim', () => {
  const pendingRoot = makeTmpStateRoot();
  const pending = route(loadFixture('executable.json'), { stateRoot: pendingRoot, checkoutRoot });
  writeVerificationResult(pending, validVerificationResult('task-1'));
  const ignored = route(loadFixture('executable.json'), { stateRoot: pendingRoot, checkoutRoot });
  assert.equal(ignored.graph.revision, 1);
  assert.equal(ignored.graph.tasks[0].acceptance_state, 'pending');

  const missingEvidenceRoot = makeTmpStateRoot();
  const first = route(loadFixture('executable.json'), { stateRoot: missingEvidenceRoot, checkoutRoot });
  writeResultClaim(first, '## Outcome\n\nstatus: complete\noutcome: succeeded\n');
  const terminal = route(loadFixture('executable.json'), { stateRoot: missingEvidenceRoot, checkoutRoot });
  writeVerificationResult(terminal, validVerificationResult('task-1'));
  const graph = fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8');
  assert.throws(() => route(loadFixture('executable.json'), { stateRoot: missingEvidenceRoot, checkoutRoot }), RouteStructureError);
  assert.equal(fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8'), graph);
});

test('an invalid terminal verification result fails before graph or packet rewrite', () => {
  const valid = validVerificationResult('task-1');
  const cases = [
    '{not json', {}, { ...valid, task_id: 'other-task' }, { ...valid, verdict: 'maybe' },
    { ...valid, verified_by: ' ' }, { ...valid, evidence_claim_path: 'tasks/task-1/other.json' },
    { ...valid, criteria_results: [] }, { ...valid, criteria_results: [{ criterion: 'c', result: 'maybe', evidence: 'e' }] },
    { ...valid, criteria_results: [{ criterion: 'c', result: 'failed', evidence: 'e' }] },
  ];
  for (const verification of cases) {
    const stateRoot = makeTmpStateRoot();
    const first = route(loadFixture('executable.json'), { stateRoot, checkoutRoot });
    writeResultClaim(first, '## Outcome\n\nstatus: complete\noutcome: succeeded\n');
    writeEvidenceClaim(first, validEvidenceClaim('task-1'));
    const terminal = route(loadFixture('executable.json'), { stateRoot, checkoutRoot });
    const graph = fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8');
    const packet = fs.readFileSync(first.packetPath, 'utf8');
    writeVerificationResult(terminal, verification);
    assert.throws(() => route(loadFixture('executable.json'), { stateRoot, checkoutRoot }), RouteStructureError);
    assert.equal(fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8'), graph);
    assert.equal(fs.readFileSync(first.packetPath, 'utf8'), packet);
  }
});

test('a passed verification requires a succeeded execution state', () => {
  const stateRoot = makeTmpStateRoot();
  const first = route(loadFixture('executable.json'), { stateRoot, checkoutRoot });
  writeResultClaim(first, '## Outcome\n\nstatus: complete\noutcome: failed\n');
  writeEvidenceClaim(first, validEvidenceClaim('task-1'));
  const terminal = route(loadFixture('executable.json'), { stateRoot, checkoutRoot });
  const graph = fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8');
  writeVerificationResult(terminal, validVerificationResult('task-1', 'passed'));
  assert.throws(() => route(loadFixture('executable.json'), { stateRoot, checkoutRoot }), RouteStructureError);
  assert.equal(fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8'), graph);
});

test('a pending task ignores an evidence claim until it has a complete result claim', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('executable.json');
  const first = route(manifest, { stateRoot, checkoutRoot });

  writeEvidenceClaim(first, '{not json');
  const rerouted = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(rerouted.graph.revision, 1);
  assert.equal(rerouted.graph.tasks[0].execution_state, 'pending');
  assert.equal('evidence_claim' in rerouted.graph.tasks[0], false);
});

test('an invalid complete evidence claim fails structurally before graph or packet rewrite', () => {
  const cases = [
    '{not json',
    { commands: ['npm test'], changed_files: ['src/route.js'], acceptance_mapping: [{ criterion: 'c', evidence: 'e' }] },
    { task_id: 1, commands: ['npm test'], changed_files: ['src/route.js'], acceptance_mapping: [{ criterion: 'c', evidence: 'e' }] },
    { task_id: 'task-1', commands: [], changed_files: ['src/route.js'], acceptance_mapping: [{ criterion: 'c', evidence: 'e' }] },
    { task_id: 'task-1', commands: 'npm test', changed_files: ['src/route.js'], acceptance_mapping: [{ criterion: 'c', evidence: 'e' }] },
    { task_id: 'task-1', commands: ['npm test'], changed_files: 'src/route.js', acceptance_mapping: [{ criterion: 'c', evidence: 'e' }] },
    { task_id: 'task-1', commands: ['npm test'], changed_files: ['/src/route.js'], acceptance_mapping: [{ criterion: 'c', evidence: 'e' }] },
    { task_id: 'task-1', commands: ['npm test'], changed_files: ['src/../route.js'], acceptance_mapping: [{ criterion: 'c', evidence: 'e' }] },
    { task_id: 'other-task', commands: ['npm test'], changed_files: ['src/route.js'], acceptance_mapping: [{ criterion: 'c', evidence: 'e' }] },
    { task_id: 'task-1', commands: ['npm test'], changed_files: ['src/route.js'] },
    { task_id: 'task-1', commands: ['npm test'], changed_files: ['src/route.js'], acceptance_mapping: [{ criterion: 'c' }] },
    { task_id: 'task-1', commands: ['npm test'], changed_files: ['src/route.js'], acceptance_mapping: [{ criterion: '', evidence: 'e' }] },
  ];

  for (const claim of cases) {
    const stateRoot = makeTmpStateRoot();
    const first = route(loadFixture('executable.json'), { stateRoot, checkoutRoot });
    const graph = fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8');
    const packet = fs.readFileSync(first.packetPath, 'utf8');
    writeResultClaim(first, '## Outcome\n\nstatus: complete\noutcome: succeeded\n');
    writeEvidenceClaim(first, claim);

    assert.throws(() => route(loadFixture('executable.json'), { stateRoot, checkoutRoot }), RouteStructureError);
    assert.equal(fs.readFileSync(path.join(first.runDir, 'graph.json'), 'utf8'), graph);
    assert.equal(fs.readFileSync(first.packetPath, 'utf8'), packet);
  }
});

test('a declared sequence requires complete per-task scope before writing a run', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('bounded-sequence.json');
  const invalid = {
    ...manifest,
    tasks: manifest.tasks.map((task, index) => index === 1 ? { ...task, allowed_paths: [] } : task),
  };

  assert.match(validateManifest(invalid).join(' '), /tasks\[1\]\.allowed_paths/);
  assert.throws(() => route(invalid, { stateRoot, checkoutRoot }), ManifestValidationError);
  assert.equal(fs.existsSync(path.join(stateRoot, 'runs')), false);
});

test('a declared candidate needs observable criteria and evidence before any run artifact is written', () => {
  const manifest = loadFixture('bounded-sequence.json');
  for (const field of ['acceptance_criteria', 'evidence_required']) {
    for (const value of [undefined, [], 'text', [1], [' ']]) {
      const stateRoot = makeTmpStateRoot();
      const invalid = { ...manifest, tasks: manifest.tasks.map((task, index) => index === 0 ? { ...task, [field]: value } : task) };
      assert.match(validateManifest(invalid).join(' '), new RegExp(`tasks\\[0\\]\\.${field}`));
      assert.throws(() => route(invalid, { stateRoot, checkoutRoot }), ManifestValidationError);
      assert.equal(fs.existsSync(path.join(stateRoot, 'runs')), false);
    }
  }
});

test('a declared task id must be a safe packet directory segment before any run artifact is written', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('bounded-sequence.json');
  const invalid = {
    ...manifest,
    tasks: manifest.tasks.map((task, index) => index === 0 ? { ...task, id: '../outside-run' } : task),
  };

  assert.match(validateManifest(invalid).join(' '), /tasks\[0\]\.id must be a safe path segment/);
  assert.throws(() => route(invalid, { stateRoot, checkoutRoot }), ManifestValidationError);
  assert.equal(fs.existsSync(path.join(stateRoot, 'runs')), false);
});

test('a gate-blocked declared sequence records all candidates without selecting or packetizing one', () => {
  const stateRoot = makeTmpStateRoot();
  const gateManifest = loadFixture('clarification-required.json');
  const sequence = loadFixture('bounded-sequence.json');
  const manifest = { ...gateManifest, tasks: sequence.tasks };

  const blocked = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(blocked.graph.status, 'blocked');
  assert.equal(blocked.graph.selected_task, null);
  assert.deepEqual(blocked.graph.tasks.map((task) => ({
    id: task.id,
    execution_state: task.execution_state,
    dependencies: task.dependencies,
  })), [
    { id: 'task-define-contract', execution_state: 'blocked', dependencies: [] },
    { id: 'task-update-workflow', execution_state: 'blocked', dependencies: ['task-define-contract'] },
  ]);
  assert.equal(fs.existsSync(path.join(blocked.runDir, 'tasks')), false);

  answerGate(blocked);
  const selected = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(selected.graph.revision, 2);
  assert.equal(selected.graph.selected_task, 'task-define-contract');
  assert.equal(fs.existsSync(path.join(selected.runDir, 'tasks', 'task-define-contract', 'packet.md')), true);
  assert.equal(fs.existsSync(path.join(selected.runDir, 'tasks', 'task-update-workflow', 'packet.md')), false);
  assert.equal(fs.existsSync(path.join(selected.runDir, 'tasks', 'task-define-contract', 'worker-claim.json')), false);
  const packet = fs.readFileSync(selected.packetPath, 'utf8');
  assert.match(packet, /Human gate gate-1 answered: Exclude blocked runs\./);
  assert.match(packet, /- Dependent: task-update-workflow/);
});

test('an answered status without a recorded answer fails structurally without selecting a task', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');
  const blocked = route(manifest, { stateRoot, checkoutRoot });
  fs.writeFileSync(blocked.gatePath, fs.readFileSync(blocked.gatePath, 'utf8').replace('status: unanswered', 'status: answered'), 'utf8');

  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);
  const graph = JSON.parse(fs.readFileSync(path.join(blocked.runDir, 'graph.json'), 'utf8'));
  assert.equal(graph.selected_task, null);
});

test('missing required route artifacts fail structurally rather than appearing complete', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('executable.json');
  const routed = route(manifest, { stateRoot, checkoutRoot });
  fs.unlinkSync(routed.packetPath);

  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);
});

test('a missing graph artifact fails structurally rather than reinitializing the run', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');
  const routed = route(manifest, { stateRoot, checkoutRoot });
  fs.unlinkSync(path.join(routed.runDir, 'graph.json'));

  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);
});

test('relative state root is rejected', () => {
  const manifest = loadFixture('clarification-required.json');
  assert.throws(
    () => route(manifest, { stateRoot: 'relative/path', checkoutRoot }),
    StateRootValidationError,
  );
});

test('state root inside the checkout is rejected', () => {
  const manifest = loadFixture('clarification-required.json');
  const insideCheckout = path.join(checkoutRoot, '.orchestrator-state');
  assert.throws(
    () => route(manifest, { stateRoot: insideCheckout, checkoutRoot }),
    StateRootValidationError,
  );
  assert.equal(fs.existsSync(insideCheckout), false);
});

test('state root inside a developer-tool directory is rejected', () => {
  const manifest = loadFixture('clarification-required.json');
  const homeDir = makeTmpHome();
  const devToolStateRoot = path.join(homeDir, '.codex', 'skills', 'state');

  assert.throws(
    () => route(manifest, { stateRoot: devToolStateRoot, checkoutRoot, homeDir }),
    StateRootValidationError,
  );
  assert.equal(fs.existsSync(devToolStateRoot), false);

  const agentsStateRoot = path.join(homeDir, '.agents', 'state');
  assert.throws(
    () => route(manifest, { stateRoot: agentsStateRoot, checkoutRoot, homeDir }),
    StateRootValidationError,
  );
});

test('state root inside a developer-tool directory is rejected through the public route() seam even when homeDir is omitted', () => {
  const manifest = loadFixture('clarification-required.json');
  const realHome = os.homedir();
  const devToolStateRoot = path.join(realHome, '.codex', 'skills', 'state');

  assert.throws(
    () => route(manifest, { stateRoot: devToolStateRoot, checkoutRoot }),
    StateRootValidationError,
  );
  assert.equal(fs.existsSync(devToolStateRoot), false);

  const agentsStateRoot = path.join(realHome, '.agents', 'state');
  assert.throws(
    () => route(manifest, { stateRoot: agentsStateRoot, checkoutRoot }),
    StateRootValidationError,
  );
  assert.equal(fs.existsSync(agentsStateRoot), false);
});

test('a valid external state root outside the checkout and developer-tool dirs is accepted', () => {
  const homeDir = makeTmpHome();
  const stateRoot = path.join(homeDir, '.local', 'state', 'opencode-orchestrated-agent-workflow');
  const manifest = loadFixture('clarification-required.json');

  const result = route(manifest, { stateRoot, checkoutRoot, homeDir });
  assert.equal(result.created, true);
});

test('CLI: routes a clarification-required manifest and is idempotent on re-run', () => {
  const stateRoot = makeTmpStateRoot();
  const manifestPath = path.join(fixturesDir, 'clarification-required.json');

  const firstOut = execFileSync('node', [cliPath, manifestPath], {
    env: { ...process.env, ORCHESTRATOR_RUN_STATE_DIR: stateRoot },
    encoding: 'utf8',
  });
  const first = JSON.parse(firstOut);
  assert.equal(first.created, true);
  assert.equal(first.graphRevision, 1);
  assert.equal(first.status, 'blocked');
  assert.equal(first.selectedTask, null);

  const secondOut = execFileSync('node', [cliPath, manifestPath], {
    env: { ...process.env, ORCHESTRATOR_RUN_STATE_DIR: stateRoot },
    encoding: 'utf8',
  });
  const second = JSON.parse(secondOut);
  assert.equal(second.created, false);
  assert.equal(second.runId, first.runId);
  assert.equal(second.graphRevision, 1);
});

test('CLI: emits a manual handoff for an executable manifest', () => {
  const stateRoot = makeTmpStateRoot();
  const manifestPath = path.join(fixturesDir, 'executable.json');
  const output = JSON.parse(execFileSync('node', [cliPath, manifestPath], {
    env: { ...process.env, ORCHESTRATOR_RUN_STATE_DIR: stateRoot },
    encoding: 'utf8',
  }));

  assert.equal(output.selectedTask, 'task-1');
  assert.equal(output.packetPath.endsWith('/tasks/task-1/packet.md'), true);
  assert.match(output.manualHandoff, /one worker manually/);
});

test('CLI: rejects a relative ORCHESTRATOR_RUN_STATE_DIR with a non-zero exit', () => {
  const manifestPath = path.join(fixturesDir, 'clarification-required.json');
  assert.throws(() => {
    execFileSync('node', [cliPath, manifestPath], {
      env: { ...process.env, ORCHESTRATOR_RUN_STATE_DIR: 'relative/path' },
      encoding: 'utf8',
    });
  });
});
