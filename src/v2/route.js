import fs from 'node:fs';
import path from 'node:path';

import { assertV2Declaration, canonicalJson, V2RouteRefusal } from './declaration.js';
import { assertValidStateRoot } from '../state-root.js';

function atomicWriteJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function atomicWriteText(filePath, text) {
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, filePath);
}

function acquireLock(lockPath) {
  for (;;) {
    try { fs.mkdirSync(lockPath); return; } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

function renderPacket(task, declaration, graphRevision) {
  const list = (items) => items.map((item) => `- ${item}`).join('\n');
  return `# V2 task attempt one: ${task.id}

## Binding

- Run ID: ${declaration.run_id}
- Attempt: 1
- Initial graph revision: ${graphRevision}

## Objective

${task.objective}

## Scope

${list(task.scope)}

## Allowed paths

${list(task.allowed_paths)}

## Forbidden paths

${list(task.forbidden_paths) || '- (none declared)'}

## Non-goals

${list(task.non_goals) || '- (none declared)'}

## Acceptance criteria

${list(task.acceptance_criteria)}

## Evidence required

${list(task.evidence_required)}

## Decision references

- (none; required_decision_references is empty)

## Retry budget

- ${task.retry_budget}

## Declaration

\`\`\`json
${JSON.stringify(canonicalJson(task), null, 2)}
\`\`\`

## Canonical run declaration

\`\`\`json
${JSON.stringify(canonicalJson(declaration), null, 2)}
\`\`\`
`;
}

function preparedTask(task) {
  return {
    id: task.id,
    dependencies: task.dependencies,
    execution_state: 'blocked',
    acceptance_state: 'pending',
    retry_budget: task.retry_budget,
    required_decision_references: [],
  };
}

function existingResult(runDir, declaration) {
  const runPath = path.join(runDir, 'run.json');
  if (!fs.existsSync(runPath)) return null;
  const recorded = JSON.parse(fs.readFileSync(runPath, 'utf8'));
  if (JSON.stringify(canonicalJson(recorded.declaration)) !== JSON.stringify(declaration)) {
    throw new V2RouteRefusal('v2-run-declaration-conflict', `run ${declaration.run_id} has a different declaration`);
  }
  const graph = JSON.parse(fs.readFileSync(path.join(runDir, 'graph.json'), 'utf8'));
  const preparedTaskIds = declaration.tasks.filter((task) => task.dependencies.length === 0).map((task) => task.id);
  return { status: 'reused', runId: declaration.run_id, runDir, graph, preparedTaskIds, attemptOnePacketPaths: preparedTaskIds.map((id) => path.join(runDir, 'tasks', id, 'attempts', '1', 'packet.md')) };
}

export function routeV2(input, opts) {
  const declaration = assertV2Declaration(input);
  const stateRoot = assertValidStateRoot(opts.stateRoot, { checkoutRoot: opts.checkoutRoot, homeDir: opts.homeDir });
  const runsDir = path.join(stateRoot, 'runs');
  const runDir = path.join(runsDir, declaration.run_id);
  const lockPath = path.join(runsDir, '.locks', declaration.run_id);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  acquireLock(lockPath);
  try {
    const reused = existingResult(runDir, declaration);
    if (reused) return reused;
    if (fs.existsSync(runDir)) throw new V2RouteRefusal('v2-run-declaration-conflict', `run ${declaration.run_id} is incomplete`);
    fs.mkdirSync(runDir, { recursive: true });
    const preparedTaskIds = declaration.tasks.filter((task) => task.dependencies.length === 0).map((task) => task.id);
    const graph = { revision: 1, run_state: 'prepared', max_concurrency: 1, tasks: declaration.tasks.map(preparedTask) };
    atomicWriteJson(path.join(runDir, 'run.json'), { schema_version: 2, run_id: declaration.run_id, run_state: 'prepared', declaration });
    atomicWriteJson(path.join(runDir, 'graph.json'), graph);
    fs.mkdirSync(path.join(runDir, 'events'), { recursive: true });
    atomicWriteJson(path.join(runDir, 'events', '1.json'), { sequence: 1, type: 'route-prepared', run_id: declaration.run_id, graph_revision: 1, prepared_task_ids: preparedTaskIds });
    const attemptOnePacketPaths = [];
    for (const task of declaration.tasks.filter((candidate) => candidate.dependencies.length === 0)) {
      const packetPath = path.join(runDir, 'tasks', task.id, 'attempts', '1', 'packet.md');
      fs.mkdirSync(path.dirname(packetPath), { recursive: true });
      atomicWriteText(packetPath, renderPacket(task, declaration, 1));
      attemptOnePacketPaths.push(packetPath);
    }
    return { status: 'prepared', runId: declaration.run_id, runDir, graph, preparedTaskIds, attemptOnePacketPaths };
  } finally {
    fs.rmdirSync(lockPath);
  }
}
