// Phase-1 `/route`: an intake manifest -> either one blocked human gate or
// one immutable packet for the first selected manual worker handoff, never a
// launched worker.
//
// Authority: design doc sections 2.3, 2.4, 7.2; ADR-0002; issue #2.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { assertValidManifest } from './manifest.js';
import { assertValidStateRoot } from './state-root.js';
import { GATE_ID, readGateAnswer, renderGateMarkdown } from './gate.js';
import { readResultClaim } from './tasks/result-claim.js';

export class UnsupportedAmbiguityClassificationError extends Error {
  constructor(classification) {
    super(
        `Phase-1 /route only handles clarification-required and executable ` +
        `outcomes; got classification "${classification}".`,
    );
    this.name = 'UnsupportedAmbiguityClassificationError';
  }
}

export class RouteStructureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RouteStructureError';
  }
}

// Deterministic run id: identical manifests produce the identical run
// directory, which is what makes re-routing an unchanged manifest a no-op
// instead of a second gate.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function computeRunId(manifest) {
  const canonical = JSON.stringify(canonicalize(manifest));
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function renderRequestMarkdown(manifest) {
  const scope = manifest.scope.map((item) => `- ${item}`).join('\n');
  const exclusions = manifest.exclusions.length > 0
    ? manifest.exclusions.map((item) => `- ${item}`).join('\n')
    : '- (none declared)';
  const safeAssumptions = manifest.safe_assumptions.length > 0
    ? manifest.safe_assumptions.map((item) => `- ${item}`).join('\n')
    : '- (none declared)';

  return `# Request

## Human request

${manifest.human_request}

## Objective

${manifest.objective}

## Scope

${scope}

## Exclusions

${exclusions}

## Safe assumptions

${safeAssumptions}

## Ambiguity classification

${manifest.ambiguity.classification}
`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assertFile(filePath, description) {
  if (!fs.existsSync(filePath)) {
    throw new RouteStructureError(`required ${description} is missing: ${filePath}`);
  }
}

function renderList(items, empty = '(none declared)') {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${empty}`;
}

function renderPacket(task, { graphRevision, decisionArtifacts, preconditions }) {
  return `# Task: ${task.id}

## Objective

${task.objective}

## Inputs and source artifacts

${renderList([
  'request.md — the validated human request and declared scope',
  'decisions.json — accepted human decision provenance',
  'graph.json — host-owned task selection and graph revision',
  ...decisionArtifacts,
])}

## Allowed paths

${renderList(task.allowed_paths)}

## Forbidden paths

${renderList(task.forbidden_paths)}

## Non-goals

${renderList(task.non_goals)}

## Expected outputs

- A scoped implementation outcome for: ${task.objective}
- A concise worker result claim and evidence claim after manual execution (not created by /route)

## Acceptance criteria

- The implementation satisfies the stated objective within the declared allowed paths.
- The implementation does not perform the declared exclusions or non-goals.

## Evidence required

- Changed-file list mapped to the objective and scope.
- Relevant verification command results.

## Preconditions and dependent tasks

${renderList(preconditions, 'No dependent tasks; this is the only selected Phase-1 task.')}

## Graph binding

- Task ID: ${task.id}
- Graph revision: ${graphRevision}

## Manual worker handoff

Give this immutable packet to one worker manually. Do not launch a worker from /route.
`;
}

function manifestTasks(manifest) {
  if (manifest.tasks === undefined) {
    return [{
      id: 'task-1',
      objective: manifest.objective,
      scope: manifest.scope,
      allowed_paths: manifest.allowed_paths,
      forbidden_paths: manifest.forbidden_paths,
      non_goals: manifest.non_goals,
      dependencies: [],
      legacy: true,
    }];
  }
  return manifest.tasks;
}

function makeTask(candidate, graphRevision, executionState) {
  const task = {
    id: candidate.id,
    execution_state: executionState,
    acceptance_state: 'pending',
    graph_revision: graphRevision,
    dependencies: candidate.dependencies,
  };
  if (candidate.legacy) return task;
  return {
    ...task,
    objective: candidate.objective,
    scope: candidate.scope,
    allowed_paths: candidate.allowed_paths,
    forbidden_paths: candidate.forbidden_paths,
    non_goals: candidate.non_goals,
  };
}

function assertGraphHasOneSelectedTask(graph, packetPath, executionStates) {
  if (!Number.isInteger(graph.revision) || graph.revision < 1) {
    throw new RouteStructureError('graph.json must contain a positive integer revision');
  }
  if (typeof graph.selected_task !== 'string') {
    throw new RouteStructureError('graph.json must select exactly one task');
  }
  if (!Array.isArray(graph.tasks) || graph.tasks.length === 0) {
    throw new RouteStructureError('graph.json must contain at least one declared task');
  }
  const task = graph.tasks.find((item) => item.id === graph.selected_task);
  if (task.id !== graph.selected_task || !executionStates.includes(task.execution_state) || task.graph_revision !== graph.revision) {
    throw new RouteStructureError(`graph.json selected task must be ${executionStates.join(' or ')} and bound to the current graph revision`);
  }
  assertFile(packetPath, 'immutable task packet');
  const tasksDir = path.dirname(path.dirname(packetPath));
  for (const candidate of graph.tasks) {
    if (candidate.id === graph.selected_task) continue;
    if (candidate.execution_state !== 'blocked' || candidate.graph_revision !== graph.revision) {
      throw new RouteStructureError('unselected graph tasks must remain blocked and bound to the current graph revision');
    }
    if (fs.existsSync(path.join(tasksDir, candidate.id, 'packet.md'))) {
      throw new RouteStructureError('unselected graph tasks must not have task packets');
    }
  }
}

function recordedGraph(graph, outcome) {
  const revision = graph.revision + 1;
  return {
    ...graph,
    revision,
    tasks: graph.tasks.map((task) => ({
      ...task,
      execution_state: task.id === graph.selected_task ? outcome : task.execution_state,
      graph_revision: revision,
    })),
  };
}

function assertBlockedGraph(graph, manifest) {
  const expectedTasks = manifest.tasks === undefined
    ? []
    : manifestTasks(manifest).map((candidate) => makeTask(candidate, 1, 'blocked'));
  if (graph.revision !== 1 || graph.status !== 'blocked' || graph.selected_task !== null) {
    throw new RouteStructureError('blocked graph.json must remain at revision one with no selected task');
  }
  if (!Array.isArray(graph.tasks) || graph.tasks.length !== expectedTasks.length || !Array.isArray(graph.gates) || graph.gates.length !== 1 || graph.gates[0] !== GATE_ID) {
    throw new RouteStructureError('blocked graph.json must contain the original human gate and declared tasks only');
  }
  for (const [index, task] of graph.tasks.entries()) {
    const expected = expectedTasks[index];
    if (task.id !== expected.id || task.execution_state !== 'blocked' || task.graph_revision !== 1) {
      throw new RouteStructureError('blocked graph.json must retain declared tasks as blocked records');
    }
  }
}

function assertSelectedDecisionProvenance(graph, decisions, runDir) {
  if (!Array.isArray(graph.decision_artifacts)) {
    throw new RouteStructureError('selected graph.json must contain a decision_artifacts array');
  }
  for (const artifact of graph.decision_artifacts) {
    if (typeof artifact !== 'string') {
      throw new RouteStructureError('graph.json decision artifacts must be paths');
    }
    assertFile(path.join(runDir, artifact), 'recorded decision source artifact');
    if (!decisions.decisions.some((decision) => decision?.source_gate === artifact)) {
      throw new RouteStructureError(`decisions.json must retain provenance for ${artifact}`);
    }
  }

  if (!Array.isArray(graph.gates)) {
    throw new RouteStructureError('selected graph.json must contain a gates array');
  }
  if (!graph.gates.includes(GATE_ID)) return;

  const sourceGate = `gates/${GATE_ID}.md`;
  if (graph.decision_artifacts.length !== 1 || graph.decision_artifacts[0] !== sourceGate) {
    throw new RouteStructureError('answered-gate graph.json must retain its sole gate decision artifact');
  }
  const gate = readGateAnswer(fs.readFileSync(path.join(runDir, sourceGate), 'utf8'));
  const decision = decisions.decisions.find((item) => item?.id === `decision-${GATE_ID}`);
  if (gate.status !== 'answered' || !gate.answer || !decision || decision.source_gate !== sourceGate || decision.answer !== gate.answer) {
    throw new RouteStructureError('answered-gate decision provenance must match the recorded gate answer');
  }
}

function baseGraph(manifest) {
  const tasks = manifest.tasks === undefined
    ? []
    : manifestTasks(manifest).map((candidate) => makeTask(candidate, 1, 'blocked'));
  return {
    revision: 1,
    status: 'blocked',
    selected_task: null,
    tasks,
    gates: [GATE_ID],
  };
}

function routedGraph(graph, decisionArtifacts, manifest) {
  const revision = graph.revision + 1;
  const candidates = manifestTasks(manifest);
  const tasks = candidates.map((candidate, index) => makeTask(candidate, revision, index === 0 ? 'pending' : 'blocked'));
  const task = tasks[0];
  return {
    revision,
    status: 'ready-for-manual-handoff',
    selected_task: task.id,
    tasks,
    gates: graph.gates,
    decision_artifacts: decisionArtifacts,
    request_objective: manifest.objective,
  };
}

/**
 * Route a validated manifest into its Phase-1 stopping point: one unanswered
 * human gate or one immutable packet for manual handoff. Re-routing an
 * already-selected task is idempotent and never rewrites its packet.
 *
 * @param {object} manifest - intake manifest (see src/manifest.js)
 * @param {object} opts
 * @param {string} opts.stateRoot - candidate ORCHESTRATOR_RUN_STATE_DIR
 * @param {string} opts.checkoutRoot - absolute path to this repository checkout
 * @param {string} [opts.homeDir] - absolute path to the user's home directory
 */
export function route(manifest, opts) {
  assertValidManifest(manifest);
  const stateRoot = assertValidStateRoot(opts.stateRoot, {
    checkoutRoot: opts.checkoutRoot,
    homeDir: opts.homeDir,
  });

  const classification = manifest.ambiguity.classification;
  if (!['clarification-required', 'executable'].includes(classification)) {
    throw new UnsupportedAmbiguityClassificationError(classification);
  }

  const runId = computeRunId(manifest);
  const runDir = path.join(stateRoot, 'runs', runId);
  const graphPath = path.join(runDir, 'graph.json');
  const decisionsPath = path.join(runDir, 'decisions.json');
  const requestPath = path.join(runDir, 'request.md');
  const gatesDir = path.join(runDir, 'gates');
  const gatePath = path.join(gatesDir, `${GATE_ID}.md`);
  const tasksDir = path.join(runDir, 'tasks');
  const candidates = manifestTasks(manifest);
  const selectedCandidate = candidates[0];
  const packetPath = path.join(tasksDir, selectedCandidate.id, 'packet.md');

  if (fs.existsSync(graphPath)) {
    assertFile(requestPath, 'request artifact');
    assertFile(decisionsPath, 'decision provenance artifact');
    const graph = readJson(graphPath);

    if (graph.selected_task !== null) {
      const decisions = readJson(decisionsPath);
      if (!Array.isArray(decisions.decisions)) {
        throw new RouteStructureError('decisions.json must contain a decisions array');
      }
      assertSelectedDecisionProvenance(graph, decisions, runDir);
      const selectedTask = graph.tasks.find((task) => task.id === graph.selected_task);
      if (selectedTask.execution_state === 'pending') {
        assertGraphHasOneSelectedTask(graph, packetPath, ['pending']);
        const resultPath = path.join(tasksDir, graph.selected_task, 'result.md');
        const claim = fs.existsSync(resultPath)
          ? readResultClaim(fs.readFileSync(resultPath, 'utf8'))
          : { status: undefined, outcome: undefined };
        if (claim.status === 'complete') {
          if (!['succeeded', 'failed'].includes(claim.outcome)) {
            throw new RouteStructureError('a complete result claim must contain outcome: succeeded or outcome: failed');
          }
          const updatedGraph = recordedGraph(graph, claim.outcome);
          writeJson(graphPath, updatedGraph);
          return {
            runId,
            runDir,
            created: false,
            graph: updatedGraph,
            gatePath: fs.existsSync(gatePath) ? gatePath : null,
            requestPath,
            decisionsPath,
            packetPath,
            manualHandoff: `Give ${packetPath} to one worker manually. /route did not launch a worker.`,
          };
        }
      } else {
        assertGraphHasOneSelectedTask(graph, packetPath, ['succeeded', 'failed']);
      }
      return {
        runId,
        runDir,
        created: false,
        graph,
        gatePath: fs.existsSync(gatePath) ? gatePath : null,
        requestPath,
        decisionsPath,
        packetPath,
        manualHandoff: `Give ${packetPath} to one worker manually. /route did not launch a worker.`,
      };
    }

    if (classification !== 'clarification-required') {
      throw new RouteStructureError('an executable run with no selected task is structurally incomplete');
    }
    assertBlockedGraph(graph, manifest);
    assertFile(gatePath, 'human gate artifact');
    const gate = readGateAnswer(fs.readFileSync(gatePath, 'utf8'));
    if (gate.status === 'unanswered') {
      return { runId, runDir, created: false, graph, gatePath, requestPath, decisionsPath };
    }
    if (gate.status !== 'answered' || !gate.answer) {
      throw new RouteStructureError('an answered human gate must contain status: answered and a non-empty answer: value');
    }

    const decisions = readJson(decisionsPath);
    if (!Array.isArray(decisions.decisions)) {
      throw new RouteStructureError('decisions.json must contain a decisions array');
    }
    const decision = {
      id: `decision-${GATE_ID}`,
      source_gate: `gates/${GATE_ID}.md`,
      answer: gate.answer,
      recorded_by: 'human',
    };
    if (!decisions.decisions.some((item) => item?.id === decision.id)) {
      decisions.decisions.push(decision);
      writeJson(decisionsPath, decisions);
    }

    const selectedGraph = routedGraph(graph, [decision.source_gate], manifest);
    fs.mkdirSync(path.dirname(packetPath), { recursive: true });
    fs.writeFileSync(packetPath, renderPacket(selectedCandidate, {
      graphRevision: selectedGraph.revision,
      decisionArtifacts: [decision.source_gate],
      preconditions: [`Human gate ${GATE_ID} answered: ${gate.answer}`],
    }), 'utf8');
    writeJson(graphPath, selectedGraph);
    return {
      runId,
      runDir,
      created: true,
      graph: selectedGraph,
      gatePath,
      requestPath,
      decisionsPath,
      packetPath,
      manualHandoff: `Give ${packetPath} to one worker manually. /route did not launch a worker.`,
    };
  }

  if (fs.existsSync(runDir)) {
    throw new RouteStructureError(`run directory exists but required graph artifact is missing: ${graphPath}`);
  }

  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(requestPath, renderRequestMarkdown(manifest), 'utf8');
  writeJson(decisionsPath, { decisions: [] });

  if (classification === 'executable') {
    const tasks = candidates.map((candidate, index) => makeTask(candidate, 1, index === 0 ? 'pending' : 'blocked'));
    const graph = {
      revision: 1,
      status: 'ready-for-manual-handoff',
      selected_task: selectedCandidate.id,
      tasks,
      gates: [],
      decision_artifacts: [],
      request_objective: manifest.objective,
    };
    fs.mkdirSync(path.dirname(packetPath), { recursive: true });
    fs.writeFileSync(packetPath, renderPacket(selectedCandidate, {
      graphRevision: graph.revision,
      decisionArtifacts: [],
      preconditions: [],
    }), 'utf8');
    writeJson(graphPath, graph);
    return {
      runId,
      runDir,
      created: true,
      graph,
      gatePath: null,
      requestPath,
      decisionsPath,
      packetPath,
      manualHandoff: `Give ${packetPath} to one worker manually. /route did not launch a worker.`,
    };
  }

  fs.mkdirSync(gatesDir, { recursive: true });

  const graph = baseGraph(manifest);
  writeJson(graphPath, graph);

  fs.writeFileSync(gatePath, renderGateMarkdown(manifest.ambiguity), 'utf8');

  return {
    runId,
    runDir,
    created: true,
    graph,
    gatePath,
    requestPath,
    decisionsPath,
  };
}
