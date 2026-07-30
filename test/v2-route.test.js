import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cli = path.join(root, 'bin/route.js');
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'v2-route.json'), 'utf8'));

function stateRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'v2-route-')); }
function inputFile(dir, value) { fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, 'input.json'); fs.writeFileSync(file, JSON.stringify(value)); return file; }
function invoke(input, state, home = os.homedir()) {
  const result = spawnSync(process.execPath, [cli, input], { encoding: 'utf8', env: { ...process.env, ORCHESTRATOR_RUN_STATE_DIR: state, HOME: home } });
  return { ...result, json: result.stdout ? JSON.parse(result.stdout) : null };
}
function invokeAsync(input, state) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, input], { env: { ...process.env, ORCHESTRATOR_RUN_STATE_DIR: state, HOME: path.join(os.tmpdir(), 'v2-route-home') } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('v2 public CLI prepares only dependency-free attempt-one packets and reuses byte-identical artifacts', () => {
  const state = stateRoot(); const input = inputFile(state, fixture);
  const first = invoke(input, state);
  assert.equal(first.status, 0); assert.equal(first.stderr, '');
  assert.deepEqual(Object.keys(first.json).sort(), ['attempt_one_packet_paths', 'graph_revision', 'prepared_task_ids', 'run_dir', 'run_id', 'run_state', 'status']);
  assert.deepEqual(first.json.prepared_task_ids, ['prepare']); assert.equal(first.json.status, 'prepared');
  const run = first.json.run_dir; const graph = JSON.parse(fs.readFileSync(path.join(run, 'graph.json'), 'utf8'));
  assert.equal(graph.revision, 1); assert.equal(graph.run_state, 'prepared'); assert.equal(graph.max_concurrency, 1);
  assert.deepEqual(graph.tasks.map(({ id, execution_state, acceptance_state }) => ({ id, execution_state, acceptance_state })), [
    { id: 'prepare', execution_state: 'blocked', acceptance_state: 'pending' }, { id: 'dependent', execution_state: 'blocked', acceptance_state: 'pending' },
  ]);
  const packet = first.json.attempt_one_packet_paths[0]; const bytes = fs.readFileSync(packet, 'utf8');
  for (const text of [
    'Run ID: v2-route-example', 'Attempt: 1', 'Initial graph revision: 1',
    'Prepare the first bounded task.', 'src/v2/**', 'Allowed paths',
    'Forbidden paths', 'Non-goals', 'Record an immutable packet.',
    'Public CLI test.', 'Decision references', 'Retry budget', '"retry_budget": 2',
    'Canonical run declaration', '"max_concurrency": 1', '"required_decision_references": []',
  ]) assert.ok(bytes.includes(text), `packet is missing ${text}`);
  assert.equal(fs.existsSync(path.join(run, 'tasks', 'dependent')), false);
  assert.equal(fs.existsSync(path.join(run, 'events', '1.json')), true);
  for (const absent of ['result.md', 'evidence-claim.json', 'verification.json', 'final-receipt.json']) assert.equal(findNamed(run, absent).length, 0);
  const reordered = { tasks: fixture.tasks.map((task) => Object.fromEntries(Object.entries(task).reverse())), max_concurrency: 1, run_id: fixture.run_id, schema_version: 2 };
  const second = invoke(inputFile(path.join(state, 'reordered'), reordered), state); assert.equal(second.status, 0); assert.equal(second.json.status, 'reused');
  assert.equal(fs.readFileSync(packet, 'utf8'), bytes); assert.deepEqual(fs.readdirSync(path.join(run, 'events')), ['1.json']);
});

test('v2 refusals use stderr only and leave recorded state unchanged', () => {
  const state = stateRoot(); const input = inputFile(state, fixture); const first = invoke(input, state); const before = fs.readFileSync(path.join(first.json.run_dir, 'run.json'), 'utf8');
  const conflict = structuredClone(fixture); conflict.tasks[0].objective = 'Different declaration.';
  const result = invoke(inputFile(path.join(state, 'conflict'), conflict), state);
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.deepEqual(JSON.parse(result.stderr), { refusal: 'v2-run-declaration-conflict' });
  assert.equal(fs.readFileSync(path.join(first.json.run_dir, 'run.json'), 'utf8'), before);
  const invalid = { ...fixture, run_id: 'invalid', max_concurrency: 2 };
  const invalidResult = invoke(inputFile(path.join(state, 'invalid'), invalid), state);
  assert.equal(invalidResult.stdout, ''); assert.deepEqual(JSON.parse(invalidResult.stderr), { refusal: 'v2-declaration-invalid' }); assert.equal(fs.existsSync(path.join(state, 'runs', 'invalid')), false);
  const unsupported = { ...fixture, run_id: 'unsupported', schema_version: 3 };
  const unsupportedResult = invoke(inputFile(path.join(state, 'unsupported'), unsupported), state);
  assert.equal(unsupportedResult.stdout, ''); assert.deepEqual(JSON.parse(unsupportedResult.stderr), { refusal: 'schema-version-unsupported' }); assert.equal(fs.existsSync(path.join(state, 'runs', 'unsupported')), false);
});

test('v2 state-root guard rejects relative, checkout, and developer-home roots before artifacts', () => {
  for (const state of ['relative-state', path.join(root, '.temporary-v2-state'), path.join(os.homedir(), '.codex', 'temporary-v2-state')]) {
    const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-input-')); const declaration = { ...fixture, run_id: `root-${Math.random().toString(16).slice(2)}` };
    const result = invoke(inputFile(inputDir, declaration), state);
    assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.equal(fs.existsSync(path.join(state, 'runs', declaration.run_id)), false);
  }
});

test('schema-less Phase-1 CLI preserves its JSON channel and key set', () => {
  const state = stateRoot(); const input = path.join(here, 'fixtures', 'executable.json'); const result = invoke(input, state);
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.deepEqual(Object.keys(result.json).sort(), ['created', 'gatePath', 'graphRevision', 'manualHandoff', 'packetPath', 'runDir', 'runId', 'selectedTask', 'status']);
});

test('v2 preparation never migrates or changes a coexisting Phase-1 run', () => {
  const state = stateRoot(); const v1Input = path.join(here, 'fixtures', 'executable.json');
  const v1 = invoke(v1Input, state); assert.equal(v1.status, 0);
  const before = treeBytes(v1.json.runDir);
  const independent = invoke(inputFile(path.join(state, 'v2-independent'), { ...fixture, run_id: 'v2-coexisting-run' }), state);
  assert.equal(independent.status, 0); assert.deepEqual(treeBytes(v1.json.runDir), before);
  const collision = invoke(inputFile(path.join(state, 'v2-collision'), { ...fixture, run_id: v1.json.runId }), state);
  assert.equal(collision.status, 1); assert.deepEqual(JSON.parse(collision.stderr), { refusal: 'v2-run-declaration-conflict' });
  assert.deepEqual(treeBytes(v1.json.runDir), before);
  const v1Reuse = invoke(v1Input, state); assert.equal(v1Reuse.status, 0); assert.equal(v1Reuse.json.created, false);
  const v2Files = findNamed(independent.json.run_dir, 'result.md').concat(findNamed(independent.json.run_dir, 'evidence-claim.json'), findNamed(independent.json.run_dir, 'verification.json'), findNamed(independent.json.run_dir, 'final-receipt.json'));
  assert.deepEqual(v2Files, []); assert.equal(fs.existsSync(path.join(independent.json.run_dir, 'tasks', 'prepare', 'attempts', '2')), false);
});

test('concurrent same-run declarations leave one event, one graph revision, and one packet set', async () => {
  const state = stateRoot(); const first = inputFile(path.join(state, 'first'), fixture); const different = structuredClone(fixture); different.tasks[0].objective = 'Conflicting concurrent declaration.';
  const second = inputFile(path.join(state, 'second'), different); const [one, two] = await Promise.all([invokeAsync(first, state), invokeAsync(second, state)]);
  assert.ok([one.status, two.status].includes(0)); assert.ok([one.status, two.status].includes(1));
  const failed = [one, two].find((result) => result.status === 1); const succeeded = [one, two].find((result) => result.status === 0);
  assert.deepEqual(JSON.parse(failed.stderr), { refusal: 'v2-run-declaration-conflict' }); assert.equal(JSON.parse(succeeded.stdout).status, 'prepared');
  const run = path.join(state, 'runs', fixture.run_id); const graph = JSON.parse(fs.readFileSync(path.join(run, 'graph.json'), 'utf8'));
  assert.equal(graph.revision, 1); assert.deepEqual(fs.readdirSync(path.join(run, 'events')), ['1.json']); assert.equal(findNamed(run, 'packet.md').length, 1);
  const expectedObjective = one.status === 0 ? fixture.tasks[0].objective : different.tasks[0].objective;
  assert.equal(JSON.parse(fs.readFileSync(path.join(run, 'run.json'), 'utf8')).declaration.tasks[0].objective, expectedObjective);
});

test('concurrent identical callers prepare once and reuse once', async () => {
  const state = stateRoot(); const first = inputFile(path.join(state, 'first'), fixture); const second = inputFile(path.join(state, 'second'), fixture);
  const results = await Promise.all([invokeAsync(first, state), invokeAsync(second, state)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [0, 0]);
  assert.deepEqual(results.map((result) => JSON.parse(result.stdout).status).sort(), ['prepared', 'reused']);
  const run = path.join(state, 'runs', fixture.run_id); assert.deepEqual(fs.readdirSync(path.join(run, 'events')), ['1.json']); assert.equal(JSON.parse(fs.readFileSync(path.join(run, 'graph.json'), 'utf8')).revision, 1);
  assert.equal(findNamed(run, 'packet.md').length, 1); assert.equal(fs.existsSync(path.join(run, 'tasks', 'prepare', 'attempts', '2')), false);
});

test('invalid non-array tasks refuses through the stable v2 declaration channel', () => {
  const state = stateRoot(); const result = invoke(inputFile(state, { ...fixture, run_id: 'bad-tasks', tasks: {} }), state);
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.deepEqual(JSON.parse(result.stderr), { refusal: 'v2-declaration-invalid' });
  assert.equal(fs.existsSync(path.join(state, 'runs', 'bad-tasks')), false);
});

function findNamed(dir, name) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name); return entry.isDirectory() ? findNamed(full, name) : entry.name === name ? [full] : [];
  });
}

function treeBytes(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name); return entry.isDirectory()
      ? treeBytes(full).map(({ path: child, bytes }) => ({ path: path.join(entry.name, child), bytes }))
      : [{ path: entry.name, bytes: fs.readFileSync(full, 'utf8') }];
  });
}
