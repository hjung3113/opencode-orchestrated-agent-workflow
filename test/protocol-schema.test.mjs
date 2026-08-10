import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = JSON.parse(readFileSync(
  new URL("../docs/design/schemas/protocol-v1.schema.json", import.meta.url),
));
const defs = schema.$defs;
const definition = (name) => defs[name];
const body = (name) => definition(name).allOf.find(({ properties }) => properties);
const zeroDigest = `sha256:${"0".repeat(64)}`;
const workspaceBaseline = {
  branch: "main",
  head: "0".repeat(40),
  status_digest: zeroDigest,
  snapshot_digest: zeroDigest,
  protected_paths: [],
};
const bootstrapRef = {
  reference_kind: "artifact",
  artifact_id: "bootstrap-1",
  path: "artifacts/bootstrap/1.json",
  digest: zeroDigest,
};

function runInstance(overrides = {}) {
  return {
    schema_version: "1.0",
    kind: "run",
    artifact_id: "run-state-1",
    run_id: "run-1",
    producer: { role: "kernel", actor_id: "kernel-1" },
    input_refs: [],
    created_at: "2026-08-04T00:00:00Z",
    state_version: 1,
    lifecycle_state: "pre_intake",
    admission_state: "pre_intake",
    bootstrap_ref: bootstrapRef,
    idempotency_key: "bootstrap-attempt-1",
    workspace_baseline: workspaceBaseline,
    budget: {
      max_concurrency: 1,
      max_execution_attempts: 2,
      max_planner_attempts: 3,
      max_graph_revisions: 2,
      max_repairs_per_finding: 0,
    },
    tasks: {},
    runtime_bindings: [],
    transitions: [],
    ...overrides,
  };
}

function protocolValidator() {
  return new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
}

test("pre-intake runs bind a bootstrap envelope before request policy admission", () => {
  const run = body("run");
  const bootstrap = body("bootstrapEnvelope");

  assert.ok(schema.oneOf.some(({ $ref }) => $ref === "#/$defs/bootstrapEnvelope"));
  assert.ok(run.properties.lifecycle_state.enum.includes("pre_intake"));
  assert.ok(run.required.includes("admission_state"));
  assert.ok(run.required.includes("bootstrap_ref"));
  assert.ok(run.required.includes("idempotency_key"));
  assert.ok(run.required.includes("workspace_baseline"));
  assert.equal(run.properties.workspace_baseline.$ref, "#/$defs/workspaceBaseline");
  assert.ok(!run.required.includes("request_ref"));
  assert.ok(!run.required.includes("effective_policy"));
  assert.deepEqual(
    bootstrap.required.filter((field) =>
      ["runtime_ref", "role", "workflow_definition", "raw_request", "idempotency_key"].includes(field)),
    ["runtime_ref", "role", "workflow_definition", "raw_request", "idempotency_key"],
  );
  assert.equal(bootstrap.properties.producer.$ref, "#/$defs/kernelProducer");
  assert.equal(bootstrap.properties.role.const, "planner");
  assert.equal(bootstrap.properties.workflow_definition.const, "intake");
});

test("schema validates pre-admission terminal runs and rejects admitted runs without policy", () => {
  const validate = protocolValidator();

  assert.equal(validate(runInstance()), true, JSON.stringify(validate.errors));
  for (const lifecycle_state of ["cancelled", "blocked"]) {
    const terminal = runInstance({ lifecycle_state });
    assert.equal(validate(terminal), true, JSON.stringify(validate.errors));
  }

  const admittedWithoutArtifacts = runInstance({
    lifecycle_state: "active",
    admission_state: "admitted",
  });
  assert.equal(validate(admittedWithoutArtifacts), false);
  assert.ok(validate.errors.some(({ keyword, params }) =>
    keyword === "required" && ["request_ref", "effective_policy"].includes(params.missingProperty)));
});

test("skills and command evidence are digest-bound protocol fields", () => {
  assert.deepEqual(definition("skill").required.sort(), [
    "digest",
    "id",
    "source",
    "version",
  ]);
  assert.ok(!body("packet").required.includes("route_evidence"));

  const observation = body("runtimeObservation");
  assert.ok(observation.required.includes("command_executions"));
  assert.equal(
    observation.properties.command_executions.items.$ref,
    "#/$defs/commandExecution",
  );
  assert.deepEqual(
    definition("commandExecution").required.sort(),
    ["argv", "command_id", "cwd", "environment_policy_id", "outcome", "output_digest"],
  );

  const evidence = definition("evidence");
  assert.equal(evidence.properties.command_ref.$ref, "#/$defs/commandEvidenceSource");
  const commandEvidenceRule = evidence.allOf.find(({ if: condition }) =>
    condition?.properties?.source?.pattern === "^command:");
  assert.deepEqual(commandEvidenceRule.then.required, ["command_ref"]);
  assert.deepEqual(
    definition("commandEvidenceSource").required.sort(),
    ["command_id", "kind", "output_digest", "runtime_ref"],
  );
});

test("preset selection and effective policy have durable schema linkage", () => {
  const request = body("request");
  const run = body("run");
  const outcome = body("outcome");

  assert.ok(request.required.includes("preset_selection"));
  assert.equal(request.properties.preset_selection.$ref, "#/$defs/presetSelection");
  assert.deepEqual(
    definition("presetSelection").required.sort(),
    ["preset", "proposed_narrowing", "rationale", "selection_evidence"],
  );
  assert.equal(run.properties.effective_policy.$ref, "#/$defs/effectivePolicy");
  assert.deepEqual(
    definition("effectivePolicy").required.sort(),
    [
      "admitted_narrowing",
      "capabilities",
      "deviations",
      "preset",
      "preset_defaults",
      "preset_selection_ref",
      "proposed_narrowing",
      "rationale",
    ],
  );
  assert.equal(outcome.properties.effective_policy.$ref, "#/$defs/effectivePolicy");
  const receiptRule = outcome.allOf.find(({ if: condition }) =>
    condition?.properties?.outcome_kind?.const === "receipt");
  assert.ok(receiptRule.then.required.includes("effective_policy"));
});

test("M0-M3 Packet artifacts remain schema-compatible without M4 route and adapter provenance", () => {
  const validate = protocolValidator();
  const legacyPacket = {
    schema_version: "1.0",
    kind: "packet",
    artifact_id: "packet-m1-legacy-1",
    run_id: "run-m1-legacy-1",
    producer: { role: "planner", actor_id: "planner-1" },
    input_refs: [],
    runtime_ref: {
      reference_kind: "repository",
      repository_snapshot: zeroDigest,
      path: "runtime.json",
      digest: zeroDigest,
    },
    created_at: "2026-08-10T00:00:00Z",
    graph_revision: 1,
    task_id: "implementation-1",
    role: "worker",
    workflow_definition: "implementation",
    objective: "make the bounded change",
    acceptance_criteria: ["the behavior is tested"],
    allowed_resources: ["target.txt"],
    forbidden_resources: [".git"],
    skills: [{
      id: "m1-local-change",
      version: "1",
      source: ".opencode/skills/m1-local-change/SKILL.md",
      digest: zeroDigest,
    }],
    capabilities: ["repository_read", "local_write", "command_execute"],
    admitted_commands: [],
    deadline_seconds: 30,
    escalation_condition: "stop on an undeclared change",
  };

  assert.equal(validate(legacyPacket), true, JSON.stringify(validate.errors));
});

test("Repair Packets may carry diagnosis evidence required by the diagnosing adapter", () => {
  const validate = protocolValidator();
  const repairPacket = {
    schema_version: "1.0",
    kind: "packet",
    artifact_id: "packet-repair-diagnosis-1",
    run_id: "run-repair-diagnosis-1",
    producer: { role: "planner", actor_id: "planner-1" },
    input_refs: [],
    runtime_ref: {
      reference_kind: "repository",
      repository_snapshot: zeroDigest,
      path: "runtime.json",
      digest: zeroDigest,
    },
    created_at: "2026-08-10T00:00:00Z",
    graph_revision: 3,
    task_id: "repair-1",
    role: "worker",
    workflow_definition: "repair",
    objective: "repair the admitted finding",
    acceptance_criteria: ["the finding is resolved"],
    allowed_resources: ["target.txt"],
    forbidden_resources: [".git"],
    skills: [{
      id: "diagnosing-bugs",
      version: "1",
      source: "https://github.com/openai/skills.git",
      digest: zeroDigest,
    }],
    capabilities: ["repository_read", "local_write", "command_execute"],
    admitted_commands: [],
    deadline_seconds: 30,
    escalation_condition: "stop on an undeclared change",
    finding_ref: bootstrapRef,
    finding_id: "finding-1",
    target_snapshot: zeroDigest,
    diagnosis_evidence: ["finding-evidence-1"],
  };

  assert.equal(validate(repairPacket), true, JSON.stringify(validate.errors));
});

test("AC-38-7 schema admits an acyclic Replan Request and typed request_route observation", () => {
  const validate = protocolValidator();
  const proposal = {
    recommended_workflow_definition: "research@1",
    reason: "the admitted worker needs one bounded external read",
    evidence_refs: [bootstrapRef],
    required_capability: "network",
  };
  const request = {
    schema_version: "1.0",
    kind: "replan_requested",
    artifact_id: "replan-request-1",
    run_id: "run-1",
    producer: { role: "worker", actor_id: "worker-1" },
    input_refs: [bootstrapRef],
    created_at: "2026-08-10T00:00:00Z",
    task_id: "task-1",
    attempt: 1,
    ...proposal,
  };
  assert.equal(validate(request), true, JSON.stringify(validate.errors));

  const observation = {
    schema_version: "1.0",
    kind: "runtime_observation",
    artifact_id: "runtime-request-route-1",
    run_id: "run-1",
    producer: { role: "runtime", actor_id: "runtime-1" },
    input_refs: [bootstrapRef],
    created_at: "2026-08-10T00:00:00Z",
    attempt_id: "worker-1",
    task_id: "task-1",
    attempt: 1,
    role: "worker",
    opencode_version: "1.18.5",
    configuration_digest: zeroDigest,
    session_id: "session-1",
    agent_identity: "worker-1",
    message_ids: [],
    agent: "worker@1",
    runtime_permission_events: [],
    command_executions: [],
    observed_changes: [],
    observed_output_snapshot: zeroDigest,
    external_reads: [],
    tool_invocations: [{
      tool_id: "request_route",
      call_id: "call-1",
      input: proposal,
      outcome: "accepted",
    }],
    exit_reason: "idle",
  };
  assert.equal(validate(observation), true, JSON.stringify(validate.errors));
});

test("AC-38-7 schema rejects malformed or spoofed Replan Request and tool provenance", () => {
  const validate = protocolValidator();
  const valid = {
    schema_version: "1.0",
    kind: "replan_requested",
    artifact_id: "replan-request-invalid-1",
    run_id: "run-1",
    producer: { role: "worker", actor_id: "worker-1" },
    input_refs: [bootstrapRef],
    created_at: "2026-08-10T00:00:00Z",
    task_id: "task-1",
    attempt: 1,
    recommended_workflow_definition: "research@1",
    reason: "the admitted worker needs one bounded external read",
    evidence_refs: [bootstrapRef],
    required_capability: "network",
  };
  const rows = [
    ["missing recommended workflow", { recommended_workflow_definition: undefined }],
    ["spoofed runtime provenance", { runtime_ref: bootstrapRef }],
    ["wrong producer role", { producer: { role: "planner", actor_id: "planner-1" } }],
  ];
  for (const [label, override] of rows) {
    const candidate = structuredClone(valid);
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) delete candidate[key];
      else candidate[key] = value;
    }
    assert.equal(validate(candidate), false, label);
  }

  const observation = {
    schema_version: "1.0",
    kind: "runtime_observation",
    artifact_id: "runtime-request-route-invalid-1",
    run_id: "run-1",
    producer: { role: "runtime", actor_id: "runtime-1" },
    input_refs: [bootstrapRef],
    created_at: "2026-08-10T00:00:00Z",
    attempt_id: "worker-1",
    task_id: "task-1",
    attempt: 1,
    role: "worker",
    opencode_version: "1.18.5",
    configuration_digest: zeroDigest,
    session_id: "session-1",
    agent_identity: "worker-1",
    message_ids: [],
    agent: "worker@1",
    runtime_permission_events: [],
    command_executions: [],
    observed_changes: [],
    observed_output_snapshot: zeroDigest,
    external_reads: [],
    tool_invocations: [{
      tool_id: "request_route",
      call_id: "call-1",
      input: valid,
      outcome: "accepted",
      unexpected: true,
    }],
    exit_reason: "idle",
  };
  assert.equal(validate(observation), false);
});
