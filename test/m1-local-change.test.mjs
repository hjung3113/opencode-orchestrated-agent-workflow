import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  admitArtifact,
  admitBudget,
  BudgetExceeded,
  digest,
  OpenCodeAdapter,
  resolveArtifactReference,
  runLocalChange,
  workspaceSnapshot,
} from "../scripts/local-change.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const schema = JSON.parse(readFileSync(join(repository, "docs/design/schemas/protocol-v1.schema.json")));
const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);

function git(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: options.encoding ?? "utf8",
    ...(options.encoding === null ? {} : { stdio: ["ignore", "pipe", "pipe"] }),
  });
}

function walkJson(directory) {
  const paths = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) paths.push(...walkJson(path));
    else if (path.endsWith(".json")) paths.push(path);
  }
  return paths;
}

function readArtifact(runDir, reference) {
  const artifact = JSON.parse(readFileSync(join(runDir, reference.path)));
  assert.equal(digest(artifact), reference.digest, `${reference.path} digest is not bound`);
  return artifact;
}

function snapshotStatus(cwd) {
  return git(cwd, ["status", "--porcelain=v1", "-z"], { encoding: "buffer" });
}

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "m1-fake-workspace-"));
  const runRoot = mkdtempSync(join(tmpdir(), "m1-fake-runs-"));
  git(workspace, ["init", "-q", "-b", "main"]);
  git(workspace, ["config", "user.email", "m1@example.invalid"]);
  git(workspace, ["config", "user.name", "M1 Test"]);
  writeFileSync(join(workspace, "protected.txt"), "base\n");
  git(workspace, ["add", "protected.txt"]);
  git(workspace, ["commit", "-qm", "fixture"]);
  writeFileSync(join(workspace, "protected.txt"), "user dirty\n");
  mkdirSync(join(workspace, ".opencode/skills/m1-local-change"), { recursive: true });
  writeFileSync(
    join(workspace, ".opencode/skills/m1-local-change/SKILL.md"),
    "---\nname: m1-local-change\nversion: 1\n---\n",
  );
  return { workspace, runRoot };
}

class FakeRuntime {
  constructor(options) {
    Object.assign(this, options);
    this.configurationDigest = digest("fake-config");
    this.version = "fake-1";
    this.nextSession = 0;
  }

  async start() {}

  preflightObservation({ attemptId, role, binding, artifactId }) {
    return this.observation({ attemptId, role, binding, artifactId, snapshot: this.baselineSnapshot });
  }

  async newAttempt({ role, attemptId, taskId, attempt }) {
    this.nextSession += 1;
    const identity = this.scenario.identityCollision && role === "verifier"
      ? this.workerIdentity : digest(`fake-${role}`);
    const binding = {
      attempt_id: attemptId,
      ...(taskId ? { task_id: taskId } : {}),
      attempt,
      session_id: `fake-session-${this.nextSession}`,
      role,
      agent_identity: identity,
      agent: `m1-${role}`,
      model: "fake/model",
      configuration_digest: this.configurationDigest,
      binding_state: "active",
    };
    if (role === "worker") this.workerIdentity = identity;
    return { binding, agent: { name: binding.agent, model: { providerID: "fake", modelID: "model" } } };
  }

  observation({ attemptId, role, binding, artifactId = `runtime-${attemptId}`, snapshot, exitReason = "idle", taskId, attempt }) {
    return {
      schema_version: "1.0",
      kind: "runtime_observation",
      artifact_id: artifactId,
      run_id: this.runId,
      producer: { role: "runtime", actor_id: "fake-runtime" },
      input_refs: [],
      created_at: "2026-08-04T00:00:00.000Z",
      attempt_id: attemptId,
      ...(taskId ? { task_id: taskId } : {}),
      ...(role === "worker" || role === "verifier" ? { attempt } : {}),
      role,
      opencode_version: this.version,
      configuration_digest: this.configurationDigest,
      server_id: "fake-server",
      session_id: binding.session_id,
      agent_identity: binding.agent_identity,
      message_ids: [],
      agent: binding.agent,
      model: binding.model,
      runtime_permission_events: [],
      command_executions: [],
      observed_changes: [],
      observed_output_snapshot: snapshot.digest,
      external_reads: [],
      exit_reason: exitReason,
    };
  }

  async execute({ role, attemptId, taskId, attempt, binding, prompt, beforeSnapshot }) {
    const scenario = this.scenario;
    if (scenario.deadline && role === scenario.deadlineRole) {
      const exitReason = scenario.deadline === "confirmed" ? "deadline_exceeded" : "cancel_unconfirmed";
      return {
        binding: { ...binding, binding_state: scenario.deadline === "confirmed" ? "cancelled" : "unreachable" },
        text: "",
        snapshot: beforeSnapshot,
        changes: [],
        attempt_failed: true,
        stop_confirmed: scenario.deadline === "confirmed",
        observation: this.observation({
          attemptId,
          role,
          binding,
          artifactId: `runtime-${attemptId}-deadline`,
          snapshot: beforeSnapshot,
          exitReason,
          taskId,
          attempt,
        }),
      };
    }
    let text;
    let workerProposalPhase = false;
    if (attemptId === "planner-request") {
      text = JSON.stringify({
        objective: this.requestText,
        scope: [this.targetFile],
        exclusions: ["user branch", "external effects"],
        ambiguities: [],
        assumptions: [],
        target_snapshot: this.baselineSnapshot.digest,
        preset_selection: {
          preset: "local-change@1",
          selection_evidence: [{ claim: "bounded request", source: "intake", observation: "one local file" }],
          proposed_narrowing: scenario.proposedNarrowing ?? null,
          rationale: "bounded local change",
        },
      });
    } else if (attemptId === "planner-graph-1") {
      text = JSON.stringify({
        graph: { nodes: [{ task_id: "implementation-1", workflow_definition: "implementation", requires: [], read_resources: [], write_resources: [this.targetFile] }] },
        packet: {
          objective: this.requestText,
          acceptance_criteria: ["the target exists"],
          forbidden_resources: [".git"],
          skills: [],
          capabilities: ["repository_read", "local_write", "command_execute"],
          admitted_commands: scenario.undeclaredCommand ? [{ command_id: "evil", argv: ["sh"], cwd: ".", timeout_seconds: 1 }] : [],
          deadline_seconds: scenario.packetDeadline ?? 3,
          escalation_condition: "stop on a violation",
        },
      });
    } else if (attemptId === "worker-implementation-1") {
      workerProposalPhase = this.workerProposalPhase === true;
      if (!workerProposalPhase) {
        if (!scenario.idleWithoutResult) writeFileSync(join(this.workspace, this.targetFile), this.expectedContent);
        if (scenario.undeclaredPathChange) writeFileSync(join(this.workspace, "unexpected.txt"), "unexpected\n");
        this.workerProposalPhase = true;
        text = JSON.stringify({ status: "edit complete" });
      } else {
        text = JSON.stringify({
          claims: ["fake worker completed"],
          evidence: [{ claim: "the requested file was written", source: "worker-report", observation: "the target was written" }],
          changed_resources: scenario.idleWithoutResult ? [] : [this.targetFile],
        });
      }
    } else if (attemptId === "planner-graph-2") {
      text = JSON.stringify({
        carry_forward_task_id: "implementation-1",
        verifier_task: { task_id: "verification-1", workflow_definition: "verification", requires: ["implementation-1"], read_resources: [this.targetFile], write_resources: [] },
        verifier_packet: {
          objective: "verify target",
          acceptance_criteria: ["target matches"],
          forbidden_resources: [".git"],
          capabilities: ["repository_read"],
          admitted_commands: [],
          deadline_seconds: 3,
          escalation_condition: "block on mismatch",
        },
      });
    } else if (attemptId === "verifier-1") {
      if (scenario.postReviewMutation) writeFileSync(join(this.workspace, this.targetFile), "drift\n");
      text = scenario.malformedVerifier
        ? "not structured review"
        : JSON.stringify({
          verdict: "pass",
          findings: [],
          evidence: [{ claim: "target matches", source: "verifier-read", observation: "read target bytes" }],
        });
    } else {
      throw new Error(`unexpected fake attempt ${attemptId}`);
    }
    const snapshot = workspaceSnapshot(this.workspace);
    if (workerProposalPhase && attemptId === "worker-implementation-1") {
      const proposal = JSON.parse(text);
      proposal.output_snapshot = snapshot.digest;
      text = JSON.stringify(proposal);
    }
    return {
      binding: { ...binding, binding_state: "idle" },
      text,
      snapshot,
      changes: [],
      events: ["session.idle"],
      observation: this.observation({
        attemptId,
        role,
        binding,
        snapshot,
        taskId,
        attempt,
      }),
    };
  }

  async stop() {}
}

function fakeFactory(scenario) {
  return (options) => new FakeRuntime({ ...options, scenario });
}

function lastRun(runRoot) {
  const runId = readdirSync(join(runRoot, "runs")).sort().at(-1);
  return join(runRoot, "runs", runId);
}

async function assertBlockedScenario(scenario) {
  const { workspace, runRoot } = fixture();
  try {
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt with the requested local change.",
      runtimeFactory: fakeFactory(scenario),
      hooks: scenario.hooks,
    }));
    const runDir = lastRun(runRoot);
    const state = JSON.parse(readFileSync(join(runDir, "run.json")));
    const failure = JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/failure.json")));
    assert.equal(state.lifecycle_state, "blocked");
    assert.equal(failure.outcome_kind, "block");
    assert.equal(validate(state), true, JSON.stringify(validate.errors));
    assert.equal(validate(failure), true, JSON.stringify(validate.errors));
    if (!scenario.hooks?.afterResultRefCas) {
      assert.equal(statSync(join(runDir, "artifacts/promotions/promotion-1.json"), { throwIfNoEntry: false }), undefined);
    }
    assert.equal(statSync(join(runDir, "artifacts/outcomes/0001.json"), { throwIfNoEntry: false }), undefined);
    return { runDir, state, failure };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
}

test("real adapter deadline blocks before the outer test timeout", { timeout: 30_000 }, async () => {
  const { workspace, runRoot } = fixture();
  let adapter;
  try {
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt with the requested local change.",
      runtimeFactory: (options) => {
        adapter = new OpenCodeAdapter({
          ...options,
          attemptDeadlineSeconds: 1,
        });
        const realApi = adapter.api.bind(adapter);
        adapter.api = async (path, requestOptions = {}) => {
          if (path.endsWith("/message") && requestOptions.signal) {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                requestOptions.signal.removeEventListener("abort", onAbort);
                reject(new Error("deadline test did not abort"));
              }, 10_000);
              const onAbort = () => {
                clearTimeout(timer);
                requestOptions.signal.removeEventListener("abort", onAbort);
                reject(new Error("deadline test request aborted"));
              };
              requestOptions.signal.addEventListener("abort", onAbort, { once: true });
            });
          }
          if (path.endsWith("/abort")) return { status: 200, body: true };
          if (path === "/session/status") return { status: 200, body: {} };
          return realApi(path, requestOptions);
        };
        return adapter;
      },
    }));

    const runDir = lastRun(runRoot);
    const state = JSON.parse(readFileSync(join(runDir, "run.json")));
    const failure = JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/failure.json")));
    assert.equal(state.lifecycle_state, "blocked");
    assert.equal(validate(state), true, JSON.stringify(validate.errors));
    assert.equal(validate(failure), true, JSON.stringify(validate.errors));
    assert.ok(["deadline_exceeded", "cancel_unconfirmed"].includes(failure.block_type));
    assert.equal(failure.block_type, "deadline_exceeded");
    const bootstrap = readArtifact(runDir, state.bootstrap_ref);
    assert.equal(bootstrap.deadline_seconds, 1);
    const deadlineRuntimeRef = failure.artifact_refs.find(({ path }) => path.includes("planner-request-deadline"));
    assert.ok(deadlineRuntimeRef, "typed deadline runtime evidence is missing");
    const deadlineRuntime = readArtifact(runDir, deadlineRuntimeRef);
    assert.equal(validate(deadlineRuntime), true, JSON.stringify(validate.errors));
    assert.equal(deadlineRuntime.exit_reason, "deadline_exceeded");
    for (const path of [
      "artifacts/tasks/implementation-1/attempts/1/result.json",
      "artifacts/tasks/verification-1/attempts/1/review.json",
      "artifacts/promotions/promotion-1.json",
      "artifacts/outcomes/0001.json",
    ]) {
      assert.equal(statSync(join(runDir, path), { throwIfNoEntry: false }), undefined, path);
    }
    assert.ok(adapter?.server, "the real OpenCode server was not started");
    assert.ok(adapter.server.exitCode !== null || adapter.server.signalCode !== null, "runtime server did not stop");
    assert.deepEqual(
      readdirSync(runDir).filter((name) => name.startsWith("task-workspace-")),
      [],
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("real local-change@1 run preserves the user worktree and emits the verified trace", { timeout: 360_000 }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), "m1-local-change-workspace-"));
  const runRoot = mkdtempSync(join(tmpdir(), "m1-local-change-runs-"));
  try {
    git(workspace, ["init", "-q", "-b", "main"]);
    git(workspace, ["config", "user.email", "m1@example.invalid"]);
    git(workspace, ["config", "user.name", "M1 Test"]);
    writeFileSync(join(workspace, "protected.txt"), "base\n");
    git(workspace, ["add", "protected.txt"]);
    git(workspace, ["commit", "-qm", "fixture"]);
    writeFileSync(join(workspace, "protected.txt"), "user dirty\n");
    mkdirSync(join(workspace, ".opencode/skills/m1-local-change"), { recursive: true });
    writeFileSync(
      join(workspace, ".opencode/skills/m1-local-change/SKILL.md"),
      "---\nname: m1-local-change\nversion: 1\n---\n\n# M1 local-change skill\n",
    );

    const beforeHead = git(workspace, ["rev-parse", "HEAD"]).trim();
    const beforeStatus = snapshotStatus(workspace);
    const expectedContent = "local change completed\n";
    const result = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt with the requested local change.",
      expectedContent,
    });
    const runDir = result.run_dir;
    const state = JSON.parse(readFileSync(join(runDir, "run.json")));

    assert.equal(result.user_workspace_unchanged, true);
    assert.equal(result.inspect.derived_status, "completed");
    assert.equal(JSON.parse(execFileSync(
      process.execPath,
      ["scripts/local-change.mjs", "inspect", "--workspace", workspace, "--run-root", runRoot, "--run-id", result.run_id],
      { cwd: repository, encoding: "utf8" },
    )).derived_status, "completed");
    assert.equal(git(workspace, ["rev-parse", "HEAD"]).trim(), beforeHead);
    assert.deepEqual(snapshotStatus(workspace), beforeStatus);
    assert.equal(readFileSync(join(workspace, "protected.txt"), "utf8"), "user dirty\n");
    assert.equal(statSync(join(workspace, "change.txt"), { throwIfNoEntry: false }), undefined);

    assert.deepEqual(state.budget, {
      max_concurrency: 1,
      max_execution_attempts: 2,
      max_planner_attempts: 3,
      max_graph_revisions: 2,
      max_repairs_per_finding: 0,
    });
    assert.equal(state.admission_state, "admitted");
    assert.equal(state.lifecycle_state, "completed");
    assert.deepEqual(state.transitions.map(({ event_kind }) => event_kind), [
      "request_admitted",
      "graph_revision_1_admitted",
      "implementation_dispatched",
      "implementation_result_admitted",
      "graph_revision_2_admitted",
      "verification_dispatched",
      "review_admitted",
      "receipt_admitted",
    ]);
    assert.equal(state.transitions[0].from_state_version, 1);
    assert.equal(state.transitions[0].to_state_version, 2);
    assert.ok(state.request_ref);
    assert.ok(state.effective_policy);
    assert.equal(state.workspace_baseline.branch, "main");
    assert.equal(state.workspace_baseline.head, beforeHead);
    assert.equal(state.workspace_baseline.status_digest, digest(beforeStatus));
    assert.ok(state.workspace_baseline.protected_paths.includes("protected.txt"));
    assert.ok(state.workspace_baseline.protected_paths.includes(".opencode/skills/m1-local-change/SKILL.md"));

    const bootstrap = readArtifact(runDir, state.bootstrap_ref);
    assert.equal(bootstrap.producer.role, "kernel");
    assert.equal(bootstrap.role, "planner");
    assert.equal(bootstrap.workflow_definition, "intake");
    assert.deepEqual(bootstrap.admitted_commands, []);
    const bootstrapRuntime = readArtifact(runDir, bootstrap.runtime_ref);
    assert.equal(bootstrapRuntime.attempt_id, "planner-request");
    assert.equal(bootstrapRuntime.role, "planner");

    const request = readArtifact(runDir, state.request_ref);
    assert.equal(request.kind, "request");
    assert.equal(request.preset_selection.preset, "local-change@1");
    assert.equal(state.effective_policy.preset_selection_ref.digest, state.request_ref.digest);
    assert.equal(state.effective_policy.preset_selection_ref.path, state.request_ref.path);

    const graphOne = JSON.parse(readFileSync(join(runDir, "artifacts/graphs/0001.json")));
    const graphTwo = JSON.parse(readFileSync(join(runDir, "artifacts/graphs/0002.json")));
    assert.equal(graphOne.graph_revision, 1);
    assert.equal(graphOne.nodes.length, 1);
    assert.equal(graphOne.nodes[0].workflow_definition, "implementation");
    assert.equal(graphTwo.graph_revision, 2);
    assert.equal(graphTwo.parent_revision_ref.path, "artifacts/graphs/0001.json");
    assert.equal(graphTwo.trigger_ref.path, "artifacts/tasks/implementation-1/attempts/1/result.json");
    assert.deepEqual(graphTwo.nodes.map(({ task_id }) => task_id), ["implementation-1", "verification-1"]);

    const implementationPacket = readArtifact(runDir, graphOne.nodes[0].packet_ref);
    const verificationPacket = readArtifact(runDir, graphTwo.nodes[1].packet_ref);
    assert.equal(implementationPacket.role, "worker");
    assert.equal(verificationPacket.role, "verifier");
    assert.equal(implementationPacket.skills[0].id, "m1-local-change");
    assert.equal(implementationPacket.skills[0].version, "1");
    assert.equal(implementationPacket.skills[0].digest, digest(readFileSync(join(workspace, ".opencode/skills/m1-local-change/SKILL.md"))));
    assert.equal(implementationPacket.admitted_commands[0].command_id, "verify-change");

    const resultArtifact = readArtifact(runDir, state.tasks["implementation-1"].artifact_ref);
    const review = readArtifact(runDir, state.tasks["verification-1"].artifact_ref);
    const promotion = JSON.parse(readFileSync(join(runDir, "artifacts/promotions/promotion-1.json")));
    const receipt = JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/0001.json")));
    assert.equal(resultArtifact.output_snapshot, review.target_snapshot);
    assert.equal(review.verdict, "pass");
    assert.deepEqual(review.findings, []);
    assert.equal(promotion.verified_snapshot, resultArtifact.output_snapshot);
    assert.equal(promotion.promoted_snapshot, resultArtifact.output_snapshot);
    assert.equal(promotion.expected_ref_oid, null);
    assert.match(promotion.promoted_ref_oid, /^[a-f0-9]{40}$/);
    assert.equal(receipt.accepted_snapshot, resultArtifact.output_snapshot);
    assert.equal(receipt.verified_snapshot, resultArtifact.output_snapshot);
    assert.equal(receipt.promoted_snapshot, resultArtifact.output_snapshot);
    assert.equal(receipt.outcome_kind, "receipt");
    assert.equal(git(runDir, ["--git-dir", "result-repository.git", "show", `${promotion.promoted_ref_oid}:change.txt`]), expectedContent);

    const workerRuntime = readArtifact(runDir, resultArtifact.runtime_ref);
    const verifierRuntime = readArtifact(runDir, review.runtime_ref);
    assert.equal(workerRuntime.exit_reason, "idle");
    assert.equal(verifierRuntime.exit_reason, "idle");
    assert.notEqual(workerRuntime.agent_identity, verifierRuntime.agent_identity);
    assert.equal(workerRuntime.command_executions.length, 1);
    const command = workerRuntime.command_executions[0];
    assert.equal(command.command_id, "verify-change");
    assert.equal(command.outcome, "succeeded");
    assert.equal(command.environment_policy_id, "local-change-sandbox-v1");
    const commandEvidence = resultArtifact.evidence.find(({ source }) => source === "command:verify-change");
    assert.equal(commandEvidence.command_ref.runtime_ref.digest, resultArtifact.runtime_ref.digest);
    assert.equal(commandEvidence.command_ref.output_digest, command.output_digest);

    const runtimeBindings = state.runtime_bindings;
    assert.deepEqual(runtimeBindings.map(({ role }) => role), ["planner", "planner", "worker", "planner", "verifier"]);
    assert.deepEqual(runtimeBindings.filter(({ role }) => role === "planner").map(({ attempt }) => attempt), [1, 2, 3]);
    assert.equal(new Set(runtimeBindings.map(({ session_id }) => session_id)).size, 5);
    assert.equal(new Set(runtimeBindings.map(({ agent_identity }) => agent_identity)).size, 3);

    for (const path of [join(runDir, "run.json"), ...walkJson(join(runDir, "artifacts"))]) {
      const artifact = JSON.parse(readFileSync(path));
      assert.equal(validate(artifact), true, `${path}: ${JSON.stringify(validate.errors)}`);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("M1 injectable runtime seam fails closed for adversarial Attempt cases", { timeout: 30_000 }, async () => {
  for (const scenario of [
    { malformedVerifier: true },
    { identityCollision: true },
    { postReviewMutation: true },
    { idleWithoutResult: true },
    { undeclaredPathChange: true },
    { deadline: "confirmed", deadlineRole: "worker" },
    { deadline: "unconfirmed", deadlineRole: "worker" },
  ]) {
    const { failure } = await assertBlockedScenario(scenario);
    if (scenario.deadline === "unconfirmed") assert.equal(failure.block_type, "cancel_unconfirmed");
  }
});

test("M1 kernel admits immutable producer-owned artifacts and detects Result/reference digest drift", () => {
  const runDir = mkdtempSync(join(tmpdir(), "m1-artifact-admission-"));
  const ctx = { runDir, admittedRefs: [] };
  const observation = {
    schema_version: "1.0",
    kind: "runtime_observation",
    artifact_id: "runtime-test",
    run_id: "run-test",
    producer: { role: "runtime", actor_id: "fake-runtime" },
    input_refs: [],
    created_at: "2026-08-04T00:00:00.000Z",
    attempt_id: "planner-test",
    role: "planner",
    opencode_version: "fake-1",
    configuration_digest: digest("fake-config"),
    session_id: "fake-session",
    agent_identity: digest("fake-agent"),
    message_ids: [],
    agent: "m1-planner",
    model: "fake/model",
    runtime_permission_events: [],
    command_executions: [],
    observed_changes: [],
    observed_output_snapshot: digest("snapshot"),
    external_reads: [],
    exit_reason: "idle",
  };
  try {
    const reference = admitArtifact(ctx, "artifacts/runtime/test.json", observation);
    assert.throws(() => admitArtifact(ctx, "artifacts/runtime/test.json", observation), /immutable artifact already exists/);
    writeFileSync(join(runDir, reference.path), JSON.stringify({ ...observation, observed_output_snapshot: digest("tampered") }));
    assert.throws(() => resolveArtifactReference(ctx, reference), /digest or id mismatch/);
    assert.throws(() => admitArtifact(ctx, "artifacts/runtime/other.json", observation, "wrong-owner"), /producer ownership mismatch/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("M1 shared admissions enforce cumulative planner, execution, and revision budgets", () => {
  const state = {
    budget: {
      max_planner_attempts: 3,
      max_execution_attempts: 2,
      max_graph_revisions: 2,
    },
    runtime_bindings: [
      { role: "planner" }, { role: "planner" }, { role: "planner" },
      { role: "worker" }, { role: "verifier" },
    ],
    transitions: [
      { event_kind: "graph_revision_1_admitted" },
      { event_kind: "graph_revision_2_admitted" },
    ],
  };
  for (const kind of ["planner_attempt", "execution_attempt", "graph_revision"]) {
    assert.throws(() => admitBudget(state, kind), BudgetExceeded);
  }
});

test("M1 ignores undeclared planner commands and rejects Result Ref drift before Promotion", { timeout: 30_000 }, async () => {
  const { workspace, runRoot } = fixture();
  try {
    const result = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt with the requested local change.",
      runtimeFactory: fakeFactory({ undeclaredCommand: true }),
    });
    const packet = JSON.parse(readFileSync(join(result.run_dir, "artifacts/tasks/implementation-1/attempts/1/packet.json")));
    assert.equal(packet.admitted_commands[0].command_id, "verify-change");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }

  await assertBlockedScenario({
    hooks: {
      afterResultRefCas: ({ resultRepo, resultRefName, resultCommit }) => {
        const tree = git(resultRepo, ["rev-parse", `${resultCommit}^{tree}`]).trim();
        const driftCommit = git(resultRepo, [
          "-c", "user.name=M1 Drift", "-c", "user.email=m1@example.invalid",
          "commit-tree", tree, "-m", "drift",
        ]).trim();
        git(resultRepo, ["update-ref", resultRefName, driftCommit]);
      },
    },
  });
});

test("M1 admission preserves policy, evidence, deadline, and run-root boundaries", { timeout: 30_000 }, async () => {
  const narrowed = await assertBlockedScenario({
    proposedNarrowing: { capabilities: ["repository_read"] },
  });
  assert.match(narrowed.failure.summary, /narrowing|required capability/i);

  const deadlineFixture = fixture();
  try {
    const result = await runLocalChange({
      workspace: deadlineFixture.workspace,
      runRoot: deadlineFixture.runRoot,
      requestText: "Add change.txt with the requested local change.",
      runtimeFactory: fakeFactory({ packetDeadline: 3 }),
    });
    const packet = JSON.parse(readFileSync(join(
      result.run_dir,
      "artifacts/tasks/implementation-1/attempts/1/packet.json",
    )));
    assert.equal(packet.deadline_seconds, 3);
  } finally {
    rmSync(deadlineFixture.workspace, { recursive: true, force: true });
    rmSync(deadlineFixture.runRoot, { recursive: true, force: true });
  }

  const evidence = await assertBlockedScenario({
    hooks: {
      beforeResultAdmission: ({ workerResult, commandExecution, workerRuntimeRef }) => {
        workerResult.evidence.push({
          claim: "the admitted command confirmed the requested file content",
          source: `command:${commandExecution.command_id}`,
          observation: "kernel runner returned succeeded",
          command_ref: {
            kind: "command_execution",
            runtime_ref: workerRuntimeRef,
            command_id: commandExecution.command_id,
            output_digest: digest("wrong output"),
          },
        });
      },
    },
  });
  assert.match(evidence.failure.summary, /command Evidence/i);

  const linked = fixture();
  const aliasRoot = mkdtempSync(join(tmpdir(), "m1-linked-root-"));
  const inside = join(linked.workspace, "run-state");
  mkdirSync(inside);
  const alias = join(aliasRoot, "runs");
  symlinkSync(inside, alias, "dir");
  try {
    await assert.rejects(() => runLocalChange({
      workspace: linked.workspace,
      runRoot: alias,
      requestText: "Add change.txt with the requested local change.",
      runtimeFactory: fakeFactory({}),
    }), /run root must be outside/);
  } finally {
    rmSync(linked.workspace, { recursive: true, force: true });
    rmSync(linked.runRoot, { recursive: true, force: true });
    rmSync(aliasRoot, { recursive: true, force: true });
  }
});

test("bootstrap cites the repository policy used for intake", { timeout: 30_000 }, async () => {
  const { workspace, runRoot } = fixture();
  try {
    writeFileSync(join(workspace, "AGENTS.md"), "# Repository policy\nKeep the change local.\n");
    git(workspace, ["add", "AGENTS.md"]);
    git(workspace, ["commit", "-qm", "repository policy"]);
    const result = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt with the requested local change.",
      runtimeFactory: fakeFactory({}),
    });
    const state = JSON.parse(readFileSync(join(result.run_dir, "run.json")));
    const bootstrap = readArtifact(result.run_dir, state.bootstrap_ref);
    assert.equal(bootstrap.repository_policy_refs.length, 1);
    assert.deepEqual(bootstrap.repository_policy_refs[0], {
      reference_kind: "repository",
      repository_snapshot: bootstrap.repository_policy_refs[0].repository_snapshot,
      path: "AGENTS.md",
      digest: digest(readFileSync(join(workspace, "AGENTS.md"))),
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("public run rejects caller-authored execution controls", () => {
  const { workspace, runRoot } = fixture();
  try {
    assert.throws(() => execFileSync(process.execPath, [
      "scripts/local-change.mjs", "run", "--workspace", workspace,
      "--run-root", runRoot, "--request", "Add the requested local change.",
      "--target-file", "caller-controlled.txt", "--content", "caller-controlled",
    ], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /execution controls/i);
    assert.equal(statSync(join(runRoot, "runs"), { throwIfNoEntry: false }), undefined);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("public run requires an explicit human request and creates no Run when omitted", () => {
  const { workspace, runRoot } = fixture();
  try {
    assert.throws(() => execFileSync(process.execPath, [
      "scripts/local-change.mjs", "run", "--workspace", workspace, "--run-root", runRoot,
    ], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /--request|usage/i);
    assert.equal(statSync(join(runRoot, "runs"), { throwIfNoEntry: false }), undefined);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("command Evidence binds its declared source to the admitted command", { timeout: 30_000 }, async () => {
  const evidence = await assertBlockedScenario({
    hooks: {
      beforeResultAdmission: ({ workerResult, commandExecution, workerRuntimeRef }) => {
        workerResult.evidence.push({
          claim: "the admitted command confirmed the requested file content",
          source: "command:undeclared",
          observation: "kernel runner returned succeeded",
          command_ref: {
            kind: "command_execution",
            runtime_ref: workerRuntimeRef,
            command_id: commandExecution.command_id,
            output_digest: commandExecution.output_digest,
          },
        });
      },
    },
  });
  assert.match(evidence.failure.summary, /command Evidence/i);
});

test("the production command seam denies outbound network access", { timeout: 30_000 }, async () => {
  const network = await assertBlockedScenario({
    hooks: {
      commandOverride: () => ({
        command_id: "verify-change",
        argv: [process.execPath, "-e", "require('node:net').connect(80, '1.1.1.1')"],
        cwd: ".",
        timeout_seconds: 3,
      }),
    },
  });
  assert.match(network.failure.summary, /admitted command failed|unsupported_capability_enforcement/i);
});
