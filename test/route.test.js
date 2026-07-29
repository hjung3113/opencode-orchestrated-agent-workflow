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
  assert.deepEqual({ ...selected.graph.tasks[0], packet_digest: undefined }, {
    id: 'task-1',
    execution_state: 'pending',
    acceptance_state: 'pending',
    graph_revision: 2,
    dependencies: [],
    packet_digest: undefined,
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
  assert.match(selected.graph.tasks[0].packet_digest, /^[a-f0-9]{64}$/);
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

test('an answered gate with mismatched existing provenance fails before task or packet selection', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');
  const blocked = route(manifest, { stateRoot, checkoutRoot });
  answerGate(blocked);
  fs.writeFileSync(blocked.decisionsPath, `${JSON.stringify({ decisions: [{
    id: 'decision-gate-1',
    source_gate: 'gates/other-gate.md',
    answer: 'Exclude blocked runs.',
    recorded_by: 'worker',
  }] }, null, 2)}\n`, 'utf8');

  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);
  const graph = JSON.parse(fs.readFileSync(path.join(blocked.runDir, 'graph.json'), 'utf8'));
  assert.equal(graph.selected_task, null);
  assert.equal(fs.existsSync(path.join(blocked.runDir, 'tasks', 'task-1', 'packet.md')), false);
});

test('selected packet digest rejects tampering', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('executable.json');
  const selected = route(manifest, { stateRoot, checkoutRoot });
  fs.appendFileSync(selected.packetPath, '\ntampered\n', 'utf8');
  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);
});

test('selected graph requires manual-handoff status and pending execution and acceptance states', () => {
  const manifest = loadFixture('executable.json');
  for (const [field, value] of [
    ['status', 'blocked'],
    ['execution_state', 'succeeded'],
    ['acceptance_state', 'passed'],
  ]) {
    const stateRoot = makeTmpStateRoot();
    const selected = route(manifest, { stateRoot, checkoutRoot });
    const graphPath = path.join(selected.runDir, 'graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    if (field === 'status') graph.status = value;
    else graph.tasks[0][field] = value;
    fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
    assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);
  }
});

test('a blocked graph with a pre-existing packet is rejected without overwriting that packet', () => {
  const stateRoot = makeTmpStateRoot();
  const manifest = loadFixture('clarification-required.json');
  const blocked = route(manifest, { stateRoot, checkoutRoot });
  answerGate(blocked);
  const packetPath = path.join(blocked.runDir, 'tasks', 'task-1', 'packet.md');
  fs.mkdirSync(path.dirname(packetPath), { recursive: true });
  fs.writeFileSync(packetPath, 'pre-existing packet', 'utf8');

  assert.throws(() => route(manifest, { stateRoot, checkoutRoot }), RouteStructureError);
  assert.equal(fs.readFileSync(packetPath, 'utf8'), 'pre-existing packet');
  const graph = JSON.parse(fs.readFileSync(path.join(blocked.runDir, 'graph.json'), 'utf8'));
  assert.equal(graph.selected_task, null);
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
  const rerouted = route(manifest, { stateRoot, checkoutRoot });
  assert.equal(rerouted.created, false);
  assert.equal(fs.readFileSync(rerouted.packetPath, 'utf8'), packet);
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
