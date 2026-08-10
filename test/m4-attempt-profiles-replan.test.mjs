import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  compileAttemptProfile,
  digest,
  M4_SKILL_MANIFEST,
  OpenCodeAdapter,
  requestRoute,
  resumeRun,
} from "../scripts/local-change.mjs";

const capabilities = {
  read: ["repository_read"],
  write: ["repository_read", "local_write"],
  execute: ["repository_read", "local_write", "command_execute"],
};
const zeroDigest = `sha256:${"0".repeat(64)}`;
const repositoryRef = {
  reference_kind: "repository",
  repository_snapshot: zeroDigest,
  path: "runtime.json",
  digest: zeroDigest,
};

function skill(id) {
  const entry = M4_SKILL_MANIFEST.entries.find((candidate) => candidate.id === id);
  return {
    id: entry.id,
    version: entry.version,
    source: M4_SKILL_MANIFEST.repository,
    source_revision: M4_SKILL_MANIFEST.revision,
    source_path: entry.source_path,
    digest: entry.digest,
    adapter_id: entry.adapter_id,
    adapter_version: entry.adapter_version,
  };
}

function contract(role, workflow, admittedCapabilities, skills = []) {
  const workflowRef = workflow.includes("@") ? workflow : `${workflow}@1`;
  const packet = {
    role,
    workflow_definition: workflowRef,
    capabilities: admittedCapabilities,
    skills,
  };
  return {
    role,
    workflow_definition: workflowRef,
    preset: workflowRef === "intake@1" ? null : "local-change@1",
    envelope: { capabilities: admittedCapabilities },
    ...(role === "planner" ? { bootstrap_envelope: { capabilities: [] } } : { packet }),
  };
}

function artifactReference(artifact, path) {
  return {
    reference_kind: "artifact",
    artifact_id: artifact.artifact_id,
    path,
    digest: digest(artifact),
  };
}

function putArtifact(runDir, path, artifact) {
  mkdirSync(dirname(join(runDir, path)), { recursive: true });
  writeFileSync(join(runDir, path), `${JSON.stringify(artifact, null, 2)}\n`);
  return artifactReference(artifact, path);
}

function fixture() {
  const runDir = mkdtempSync(join(tmpdir(), "m4-replan-"));
  mkdirSync(join(runDir, "artifacts"), { recursive: true });
  const packet = {
    schema_version: "1.0",
    kind: "packet",
    artifact_id: "packet-worker-1",
    run_id: "run-1",
    producer: { role: "planner", actor_id: "planner-1" },
    input_refs: [],
    created_at: "2026-08-10T00:00:00Z",
    runtime_ref: repositoryRef,
    graph_revision: 1,
    task_id: "task-1",
    role: "worker",
    workflow_definition: "implementation",
    objective: "make the admitted local change",
    acceptance_criteria: ["the admitted change is tested"],
    allowed_resources: ["src"],
    forbidden_resources: [".git"],
    skills: [skill("implement"), skill("tdd")],
    capabilities: capabilities.execute,
    admitted_commands: [],
    deadline_seconds: 30,
    escalation_condition: "stop when the next workflow is required",
  };
  const packetRef = putArtifact(runDir, "artifacts/tasks/task-1/packet.json", packet);
  const request = {
    schema_version: "1.0",
    kind: "request",
    artifact_id: "request-1",
    run_id: "run-1",
    producer: { role: "planner", actor_id: "planner-1" },
    input_refs: [],
    created_at: "2026-08-10T00:00:00Z",
    runtime_ref: repositoryRef,
    objective: "make the admitted local change",
    scope: ["src"],
    exclusions: ["external effects"],
    ambiguities: [],
    assumptions: [],
    target_snapshot: zeroDigest,
    preset_selection: {
      preset: "local-change@1",
      selection_evidence: [{ claim: "bounded", source: "fixture", observation: "local" }],
      proposed_narrowing: null,
      rationale: "bounded local change",
    },
  };
  const requestRef = putArtifact(runDir, "artifacts/request.json", request);
  const review = {
    schema_version: "1.0",
    kind: "review",
    artifact_id: "review-1",
    run_id: "run-1",
    producer: { role: "verifier", actor_id: "verifier-1" },
    input_refs: [],
    created_at: "2026-08-10T00:00:00Z",
    runtime_ref: repositoryRef,
    task_id: "verification-1",
    attempt: 1,
    target_task_ref: packetRef,
    target_snapshot: zeroDigest,
    verdict: "finding",
    evidence: [],
    findings: [{
      finding_id: "finding-1",
      fingerprint: zeroDigest,
      criterion: "the change needs bounded repair",
      evidence: [],
    }],
  };
  const reviewRef = putArtifact(runDir, "artifacts/tasks/verification-1/attempts/1/review.json", review);
  const graph = {
    schema_version: "1.0",
    kind: "graph",
    artifact_id: "graph-1",
    run_id: "run-1",
    producer: { role: "planner", actor_id: "planner-1" },
    input_refs: [requestRef],
    created_at: "2026-08-10T00:00:00Z",
    graph_revision: 1,
    runtime_ref: repositoryRef,
    trigger_ref: requestRef,
    nodes: [{
      task_id: "task-1",
      workflow_definition: "implementation",
      packet_ref: packetRef,
      requires: [],
      read_resources: ["src"],
      write_resources: ["src"],
    }],
  };
  const graphRef = putArtifact(runDir, "artifacts/graphs/0001.json", graph);
  const binding = {
    attempt_id: "worker-1",
    task_id: "task-1",
    attempt: 1,
    session_id: "session-1",
    role: "worker",
    agent_identity: "worker-agent-1",
    agent: "worker@1",
    model: "fixture/model",
    configuration_digest: digest("worker-config"),
    binding_state: "active",
  };
  const state = {
    schema_version: "1.0",
    kind: "run",
    artifact_id: "run-state",
    run_id: "run-1",
    producer: { role: "kernel", actor_id: "kernel-m1" },
    input_refs: [],
    created_at: "2026-08-10T00:00:00Z",
    state_version: 1,
    lifecycle_state: "active",
    admission_state: "admitted",
    bootstrap_ref: repositoryRef,
    request_ref: requestRef,
    active_graph_ref: graphRef,
    idempotency_key: "run-1",
    workspace_baseline: {
      branch: "main",
      head: "0".repeat(40),
      status_digest: zeroDigest,
      snapshot_digest: zeroDigest,
      protected_paths: [],
    },
    effective_policy: {
      preset: "local-change@1",
      preset_selection_ref: requestRef,
      preset_defaults: {
        capabilities: capabilities.execute,
        budget: {
          max_concurrency: 1,
          max_execution_attempts: 4,
          max_planner_attempts: 5,
          max_graph_revisions: 4,
          max_repairs_per_finding: 1,
        },
        evidence_expectations: ["worker evidence"],
        verification_expectations: ["fresh verifier"],
        completion_conditions: ["compare and swap"],
      },
      capabilities: capabilities.execute,
      proposed_narrowing: null,
      admitted_narrowing: null,
      deviations: [],
      rationale: "fixture policy",
    },
    budget: {
      max_concurrency: 1,
      max_execution_attempts: 4,
      max_planner_attempts: 5,
      max_graph_revisions: 4,
      max_repairs_per_finding: 1,
    },
    tasks: {
      "task-1": { task_state: "active", attempts: 1 },
      "verification-1": { task_state: "artifacts_published", attempts: 1, artifact_ref: reviewRef },
    },
    runtime_bindings: [binding],
    transitions: [{
      sequence: 1,
      event_id: "review-admitted-1",
      from_state_version: 0,
      to_state_version: 1,
      event_kind: "review_admitted",
      record_refs: [reviewRef],
    }],
  };
  writeFileSync(join(runDir, "run.json"), `${JSON.stringify(state, null, 2)}\n`);
  const context = {
    runDir,
    run_id: state.run_id,
    task_id: binding.task_id,
    attempt_id: binding.attempt_id,
    attempt: binding.attempt,
    session_id: binding.session_id,
    agent_identity: binding.agent_identity,
    configuration_digest: binding.configuration_digest,
    packet_ref: packetRef,
    state_version: state.state_version,
  };
  const proposal = {
    recommended_workflow_definition: "repair@1",
    reason: "the finding requires the repair workflow",
    evidence_refs: [reviewRef],
    required_capability: "local_write",
  };
  return { runDir, state, binding, packetRef, proposal, context };
}

function jsonTree(runDir) {
  const files = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".json")) files.push([path.slice(`${runDir}/`.length), readFileSync(path, "utf8")]);
    }
  };
  visit(runDir);
  return files.sort((left, right) => left[0].localeCompare(right[0]));
}

function runRoute(fixtureValue, context = fixtureValue.context, proposal = fixtureValue.proposal) {
  return requestRoute(context, proposal);
}

test("AC-38-1 generated profiles intersect role, workflow, preset, envelope, Packet, and skills", () => {
  const adapterRunDir = mkdtempSync(join(tmpdir(), "m4-profile-adapter-"));
  const adapter = new OpenCodeAdapter({ workspace: process.cwd(), runDir: adapterRunDir });
  const rows = [
    ["planner", contract("planner", "intake", [], []), [], []],
    ["read-only worker", contract("worker", "implementation", capabilities.read, []), ["read", "request_route"], []],
    ["writing worker", contract("worker", "implementation", capabilities.write, [skill("tdd")]), ["read", "edit", "write", "request_route"], ["tdd@1"]],
    ["replan worker", contract("worker", "implementation", capabilities.execute, [skill("tdd")]), ["read", "edit", "write", "request_route"], ["tdd@1"]],
    ["verifier", contract("verifier", "verification", capabilities.read, [skill("code-review")]), ["read"], []],
  ];

  try {
    for (const [label, admitted, expectedTools, expectedSkills] of rows) {
      const resolved = adapter.resolvedAgentForAttempt(admitted);
      assert.equal(resolved.selectable, false, `${label} remains non-user-selectable`);
      assert.deepEqual(
        Object.entries(resolved.tools).filter(([, enabled]) => enabled).map(([name]) => name),
        expectedTools,
        label,
      );
      assert.deepEqual(resolved.skills, expectedSkills, label);
      assert.match(resolved.configuration_digest, /^sha256:[a-f0-9]{64}$/);
    }
  } finally {
    rmSync(adapterRunDir, { recursive: true, force: true });
  }
});

test("AC-38-2 profiles deny every forbidden model surface and keep digests deterministic", () => {
  const admitted = contract("worker", "implementation", capabilities.execute, [skill("tdd")]);
  const first = compileAttemptProfile(admitted);
  const second = compileAttemptProfile(structuredClone(admitted));
  assert.deepEqual(first, second);
  for (const profile of [
    compileAttemptProfile(contract("planner", "intake", [], [])),
    first,
    compileAttemptProfile(contract("verifier", "verification", capabilities.read, [skill("code-review")])),
  ]) {
    assert.equal(profile.agent.permission["*"], "deny");
    const forbiddenSurfaces = ["bash", "task", "webfetch", "websearch", "mcp", "question", "glob", "grep", "list", "lsp"];
    for (const surface of forbiddenSurfaces) {
      assert.notEqual(profile.agent.tools[surface], true, surface);
      assert.notEqual(profile.agent.permission[surface], "allow", surface);
    }
  }
  assert.equal(first.agent.tools.external_directory, false);
  assert.equal(first.agent.permission.external_directory, "deny");
});

test("AC-38-2 replanning permission comes only from the versioned Workflow Definition", () => {
  const admitted = contract("worker", "implementation", capabilities.execute, [skill("tdd")]);
  const forged = {
    ...admitted,
    permits_replanning: false,
    packet: { ...admitted.packet, permits_replanning: false },
  };
  assert.equal(compileAttemptProfile(forged).agent.tools.request_route, true);
});

test("AC-38-3 AC-38-4 valid request_route publishes one no-authority pair through one CAS", () => {
  const value = fixture();
  try {
    const result = runRoute(value);
    assert.equal(result.status, "accepted");
    assert.equal(result.no_mutation, false);
    assert.equal(result.replan_request_ref.artifact_id.startsWith("replan-"), true);
    assert.equal(result.runtime_observation_ref.artifact_id.startsWith("runtime-"), true);
    const after = JSON.parse(readFileSync(join(value.runDir, "run.json")));
    assert.equal(after.state_version, 2);
    assert.deepEqual(after.transitions.at(-1).event_kind, "replan_requested");
    assert.deepEqual(after.transitions.at(-1).record_refs, [
      result.replan_request_ref,
      result.runtime_observation_ref,
    ]);
    assert.equal(after.runtime_bindings[0].binding_state, "idle");
    assert.equal(after.tasks["task-1"].task_state, "active");
    assert.equal(after.active_graph_ref.artifact_id, "graph-1");
    const repeat = runRoute(value);
    assert.deepEqual(repeat, result);
    assert.deepEqual(
      JSON.parse(readFileSync(join(value.runDir, "run.json"))).transitions,
      after.transitions,
    );
    const request = JSON.parse(readFileSync(join(value.runDir, result.replan_request_ref.path)));
    const observation = JSON.parse(readFileSync(join(value.runDir, result.runtime_observation_ref.path)));
    assert.equal(request.runtime_ref, undefined);
    assert.equal(request.producer.role, "worker");
    assert.equal(request.source_packet_ref.artifact_id, value.packetRef.artifact_id);
    assert.equal(observation.input_refs[0].artifact_id, request.artifact_id);
    assert.equal(observation.tool_invocations[0].tool_id, "request_route");
    assert.equal(observation.tool_invocations[0].outcome, "accepted");
    assert.equal(after.tasks["task-1"].artifact_ref, undefined);
    assert.equal(after.runtime_bindings.length, 1);
  } finally {
    rmSync(value.runDir, { recursive: true, force: true });
  }
});

test("AC-38-5 malformed, stale, within-authority, incompatible, and state-conflict routes reject without mutation", () => {
  const stale = [
    ["Run", { run_id: "stale-run" }, "stale"],
    ["Task", { task_id: "stale-task" }, "stale"],
    ["Attempt", { attempt_id: "stale-attempt" }, "stale"],
    ["Packet", {
      packet_ref: {
        reference_kind: "artifact",
        artifact_id: "stale-packet",
        path: "artifacts/tasks/task-1/packet.json",
        digest: zeroDigest,
      },
    }, "stale"],
    ["session", { session_id: "stale-session" }, "stale"],
    ["configuration", { configuration_digest: digest("stale-config") }, "stale"],
  ];
  const rows = [
    ["malformed", (value) => ({ ...value.proposal, state_version: 1 }), "malformed"],
    ...stale.map(([label, override, code]) => [label, (value) => value.proposal, code, override]),
    ["within authority", (value) => ({ ...value.proposal, recommended_workflow_definition: "implementation@1", required_capability: "repository_read" }), "within_authority"],
    ["incompatible workflow", (value) => ({ ...value.proposal, recommended_workflow_definition: "verification@1" }), "incompatible_workflow"],
    ["state conflict", (value) => value.proposal, "state_conflict", { state_version: 0 }],
  ];
  for (const [label, makeProposal, code, contextOverride] of rows) {
    const value = fixture();
    try {
      const before = jsonTree(value.runDir);
      const context = { ...value.context, ...(contextOverride ?? {}) };
      const result = requestRoute(context, makeProposal(value));
      assert.deepEqual(result, { status: "rejected", reason_code: code, no_mutation: true }, label);
      assert.deepEqual(jsonTree(value.runDir), before, label);
    } finally {
      rmSync(value.runDir, { recursive: true, force: true });
    }
  }
});

test("AC-38-6 resume reconciles both prepared request_route boundaries exactly once", async () => {
  for (const crashAt of ["after_replan_request_preparation", "after_replan_observation_preparation"]) {
    const value = fixture();
    try {
      assert.throws(
        () => requestRoute({ ...value.context, hooks: { crashAt } }, value.proposal),
        (error) => error.code === "simulated_crash",
        crashAt,
      );
      const beforeResume = JSON.parse(readFileSync(join(value.runDir, "run.json")));
      assert.equal(beforeResume.transitions.some(({ event_kind }) => event_kind === "replan_requested"), false);
      const resumed = await resumeRun(value.runDir);
      assert.equal(resumed.checkpoint, "replan_requested", crashAt);
      const afterResume = JSON.parse(readFileSync(join(value.runDir, "run.json")));
      assert.equal(afterResume.transitions.filter(({ event_kind }) => event_kind === "replan_requested").length, 1, crashAt);
      assert.equal(jsonTree(value.runDir).filter(([path]) => path.includes("replan-") || path.includes("runtime-replan-")).length, 2, crashAt);
      const second = await resumeRun(value.runDir);
      assert.equal(second.next_action, null, crashAt);
      assert.equal(JSON.parse(readFileSync(join(value.runDir, "run.json"))).state_version, afterResume.state_version, crashAt);
    } finally {
      rmSync(value.runDir, { recursive: true, force: true });
    }
  }
});
