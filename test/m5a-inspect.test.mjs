import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  admitArtifact,
  digest,
  runLocalChange,
  workspaceSnapshot,
} from "../scripts/local-change.mjs";

const repository = resolveDir();
const schema = JSON.parse(readFileSync(join(repository, "docs/design/schemas/protocol-v1.schema.json")));
const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
const inspectRequest = "Inspect the repository and report the content of notes.txt without changing anything.";
const resource = "notes.txt";
const resourceContent = "repository notes: the answer is 42\n";

let observedOpenCodeVersion = null;
try {
  observedOpenCodeVersion = execFileSync("opencode", ["--version"], { encoding: "utf8" }).trim() || null;
} catch {
  observedOpenCodeVersion = null;
}
const opencodeUnavailableSkip = observedOpenCodeVersion
  ? false : "the opencode executable is not observable on PATH";
const providerUnavailableSkip = opencodeUnavailableSkip
  || (process.env.ZHIPU_API_KEY
    ? false : "ZHIPU_API_KEY must be supplied externally for the real-provider Issue #48 gate");

function resolveDir() {
  return fileURLToPath(new URL("..", import.meta.url));
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "m5a-inspect-workspace-"));
  const runRoot = mkdtempSync(join(tmpdir(), "m5a-inspect-runs-"));
  git(workspace, ["init", "-q", "-b", "main"]);
  git(workspace, ["config", "user.email", "m5a@example.invalid"]);
  git(workspace, ["config", "user.name", "M5a Test"]);
  writeFileSync(join(workspace, resource), resourceContent);
  mkdirSync(join(workspace, ".opencode/skills/m1-local-change"), { recursive: true });
  writeFileSync(
    join(workspace, ".opencode/skills/m1-local-change/SKILL.md"),
    "---\nname: m1-local-change\nversion: 1\n---\n",
  );
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-qm", "M5a fixture"]);
  return {
    workspace,
    runRoot,
    before: {
      head: git(workspace, ["rev-parse", "HEAD"]).trim(),
      branch: git(workspace, ["branch", "--show-current"]).trim(),
      status: git(workspace, ["status", "--porcelain=v1", "-z"]),
      snapshot: workspaceSnapshot(workspace).digest,
    },
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function walkJson(root) {
  const paths = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, name.name);
    if (name.isDirectory()) paths.push(...walkJson(path));
    else if (path.endsWith(".json")) paths.push(path);
  }
  return paths;
}

class InspectProvider {
  constructor(options) {
    Object.assign(this, options);
    this.configurationDigest = digest("m5a-inspect-provider");
    this.version = "m5a-fixture-1";
    this.sessionNumber = 0;
  }

  async start() {}

  async stop() {}

  async newAttempt({ role, attemptId, taskId, attempt }) {
    this.sessionNumber += 1;
    return {
      binding: {
        attempt_id: attemptId,
        ...(taskId ? { task_id: taskId } : {}),
        attempt,
        session_id: `m5a-session-${this.sessionNumber}`,
        role,
        agent_identity: digest(`m5a-${role}`),
        agent: `m1-${role}`,
        model: "fixture/model",
        configuration_digest: this.configurationDigest,
        binding_state: "active",
      },
    };
  }

  observation({ attemptId, role, binding, snapshot, taskId, attempt }) {
    return {
      schema_version: "1.0",
      kind: "runtime_observation",
      artifact_id: `runtime-${attemptId}`,
      run_id: this.runId,
      producer: { role: "runtime", actor_id: "m5a-inspect-provider" },
      input_refs: [],
      created_at: "2026-08-18T00:00:00.000Z",
      attempt_id: attemptId,
      ...(taskId ? { task_id: taskId } : {}),
      ...(role === "worker" || role === "verifier" ? { attempt } : {}),
      role,
      opencode_version: this.version,
      configuration_digest: this.configurationDigest,
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
      exit_reason: "idle",
    };
  }

  preflightObservation({ attemptId, role, binding, artifactId }) {
    return {
      ...this.observation({ attemptId, role, binding, snapshot: this.baselineSnapshot, artifactId }),
      artifact_id: artifactId,
    };
  }

  async execute({ role, attemptId, taskId, attempt, binding }) {
    const scenario = this.scenario ?? {};
    let text;
    if (attemptId === "planner-request") {
      text = JSON.stringify({
        objective: this.requestText,
        scope: [resource],
        exclusions: ["local writes", "external effects"],
        ambiguities: [],
        assumptions: [],
        target_snapshot: this.baselineSnapshot.digest,
        preset_selection: {
          preset: scenario.presetSwitch ? "local-change@1" : "inspect@1",
          selection_evidence: [{ claim: "read-only report request", source: "intake", observation: "the request asks to inspect without changing" }],
          proposed_narrowing: scenario.proposedNarrowing ?? null,
          rationale: "repository-only inspect fixture",
        },
      });
    } else if (attemptId === "planner-graph-1") {
      text = JSON.stringify({
        graph: { nodes: [{ task_id: "research-1", workflow_definition: "research", requires: [], read_resources: [resource], write_resources: [] }] },
        packet: {
          objective: this.requestText,
          acceptance_criteria: ["the report cites repository evidence"],
          capabilities: scenario.packetCapabilities ?? ["repository_read"],
          admitted_commands: [],
          deadline_seconds: 3,
        },
      });
    } else if (attemptId === "worker-research-1") {
      text = JSON.stringify({
        claims: [`the repository file ${resource} is cited`],
        evidence: [{ claim: `${resource} contains the repository answer`, source: resource, observation: "the cited file content was read" }],
      });
    } else if (attemptId === "planner-graph-2") {
      text = JSON.stringify({
        carry_forward_task_id: "research-1",
        verifier_task: { task_id: "verification-1", workflow_definition: "verification", requires: ["research-1"], read_resources: [resource], write_resources: [] },
        verifier_packet: {
          objective: "verify the cited report",
          acceptance_criteria: ["the cited report matches repository content"],
          capabilities: ["repository_read"],
          admitted_commands: [],
          deadline_seconds: 3,
        },
      });
    } else {
      text = JSON.stringify({
        verdict: "pass",
        findings: [],
        evidence: [{ claim: "the cited report matches repository content", source: "verifier-read", observation: "the cited file supports the claims" }],
      });
    }
    const snapshot = workspaceSnapshot(this.workspace);
    return {
      binding: { ...binding, binding_state: "idle" },
      text,
      snapshot,
      changes: [],
      events: ["session.idle"],
      observation: this.observation({ attemptId, role, binding, snapshot, taskId, attempt }),
    };
  }
}

function inspectFactory(scenario) {
  return (options) => new InspectProvider({ ...options, scenario });
}

async function inspectRunFixture(scenario) {
  const paths = fixture();
  try {
    const result = await runLocalChange({
      workspace: paths.workspace,
      runRoot: paths.runRoot,
      requestText: inspectRequest,
      runtimeFactory: inspectFactory(scenario),
    });
    return { ...paths, result, runDir: result.run_dir };
  } catch (error) {
    const runsRoot = join(paths.runRoot, "runs");
    const runDir = existsSync(runsRoot) && readdirSync(runsRoot).length > 0
      ? join(runsRoot, readdirSync(runsRoot)[0]) : null;
    return { ...paths, error, runDir };
  } finally {
    // disposal is the caller's responsibility through dispose(paths)
  }
}

function dispose(paths) {
  rmSync(paths.workspace, { recursive: true, force: true });
  rmSync(paths.runRoot, { recursive: true, force: true });
}

async function assertInspectBlocked(scenario) {
  const paths = fixture();
  try {
    await assert.rejects(() => runLocalChange({
      workspace: paths.workspace,
      runRoot: paths.runRoot,
      requestText: inspectRequest,
      runtimeFactory: inspectFactory(scenario),
    }));
    const runDir = join(paths.runRoot, "runs", readdirSync(join(paths.runRoot, "runs"))[0]);
    const state = readJson(join(runDir, "run.json"));
    const failure = readJson(join(runDir, "artifacts/outcomes/failure.json"));
    assert.equal(state.lifecycle_state, "blocked");
    assert.equal(failure.outcome_kind, "block");
    assert.equal(validate(state), true, JSON.stringify(validate.errors));
    assert.equal(validate(failure), true, JSON.stringify(validate.errors));
    return { failure, state };
  } finally {
    dispose(paths);
  }
}

function assertWorkspaceUnchanged(paths) {
  assert.equal(git(paths.workspace, ["rev-parse", "HEAD"]).trim(), paths.before.head);
  assert.equal(git(paths.workspace, ["branch", "--show-current"]).trim(), paths.before.branch);
  assert.equal(git(paths.workspace, ["status", "--porcelain=v1", "-z"]), paths.before.status);
  assert.equal(workspaceSnapshot(paths.workspace).digest, paths.before.snapshot);
}

let completedRunPromise;

function completedRun() {
  if (!completedRunPromise) {
    completedRunPromise = inspectRunFixture({}).then((paths) => {
      if (paths.error) {
        dispose(paths);
        throw paths.error;
      }
      return paths;
    });
  }
  return completedRunPromise;
}

test.after(async () => {
  if (completedRunPromise) {
    const paths = await completedRun().catch(() => null);
    if (paths) dispose(paths);
  }
});

test("AC-48-1 inspect@1 is admitted as the second v1 preset through the M1 structured linkage", { timeout: 60_000 }, async () => {
  const ran = await completedRun();
  try {
    const state = readJson(join(ran.runDir, "run.json"));
    assert.equal(state.lifecycle_state, "completed");
    assert.equal(state.admission_state, "admitted");
    assert.equal(state.effective_policy.preset, "inspect@1");
    assert.deepEqual(state.effective_policy.capabilities, ["repository_read"]);
    assert.equal(state.effective_policy.preset_selection_ref.digest, state.request_ref.digest);
    assert.equal(state.effective_policy.preset_selection_ref.path, state.request_ref.path);
    const request = readJson(join(ran.runDir, state.request_ref.path));
    assert.equal(request.preset_selection.preset, "inspect@1");
    assert.ok(request.preset_selection.selection_evidence.length > 0);
    assert.equal(request.preset_selection.proposed_narrowing, null);
    assert.ok(request.preset_selection.rationale.length > 0);
    assert.equal(state.effective_policy.admitted_narrowing, null);
    assert.equal(state.effective_policy.rationale, request.preset_selection.rationale);
    for (const path of [join(ran.runDir, "run.json"), ...walkJson(join(ran.runDir, "artifacts"))]) {
      const artifact = readJson(path);
      assert.equal(validate(artifact), true, `${path}: ${JSON.stringify(validate.errors)}`);
    }
    assertWorkspaceUnchanged(ran);
  } finally {
    // shared fixture disposal happens in test.after
  }
});

test("AC-48-2 inspect@1 admits repository read only and rejects write, command, network, commit, and external mutation capabilities", { timeout: 60_000 }, async () => {
  for (const scenario of [
    { proposedNarrowing: { capabilities: ["repository_read", "local_write"] } },
    { proposedNarrowing: { capabilities: ["repository_read", "network"] } },
    { packetCapabilities: ["repository_read", "command_execute", "local_commit", "external_mutation"] },
  ]) {
    const { failure } = await assertInspectBlocked(scenario);
    assert.match(failure.summary, /policy narrowing widens inspect@1 capabilities/, JSON.stringify(scenario));
  }
  const ran = await completedRun();
  const researchPacket = readJson(join(ran.runDir, "artifacts/tasks/research-1/attempts/1/packet.json"));
  const verificationPacket = readJson(join(ran.runDir, "artifacts/tasks/verification-1/attempts/1/packet.json"));
  assert.deepEqual(researchPacket.capabilities, ["repository_read"]);
  assert.deepEqual(researchPacket.admitted_commands, []);
  assert.deepEqual(verificationPacket.capabilities, ["repository_read"]);
});

test("AC-48-3 repository-only inspect@1 runs through real OpenCode with planner, research, and verifier Attempts to a Receipt", { timeout: 420_000, skip: providerUnavailableSkip }, async () => {
  const paths = fixture();
  try {
    const result = await runLocalChange({
      workspace: paths.workspace,
      runRoot: paths.runRoot,
      requestText: inspectRequest,
    });
    const runDir = result.run_dir;
    const state = readJson(join(runDir, "run.json"));
    assert.equal(state.lifecycle_state, "completed");
    assert.equal(state.effective_policy.preset, "inspect@1");
    const roles = state.runtime_bindings.map(({ role }) => role);
    assert.deepEqual(roles, ["planner", "planner", "worker", "planner", "verifier"]);
    const researchBinding = state.runtime_bindings.find(({ attempt_id }) => attempt_id === "worker-research-1");
    const verifierBinding = state.runtime_bindings.find(({ attempt_id }) => attempt_id === "verifier-1");
    assert.notEqual(researchBinding.agent_identity, verifierBinding.agent_identity);
    const resultArtifact = readJson(join(runDir, state.tasks["research-1"].artifact_ref.path));
    const review = readJson(join(runDir, state.tasks["verification-1"].artifact_ref.path));
    assert.equal(review.verdict, "pass");
    assert.deepEqual(resultArtifact.changed_resources, []);
    assert.equal(resultArtifact.output_snapshot, paths.before.snapshot);
    assert.ok(resultArtifact.evidence.length > 0);
    assert.ok(resultArtifact.evidence.every(({ source }) => source === resource));
    const receipt = readJson(join(runDir, "artifacts/outcomes/0001.json"));
    assert.equal(receipt.outcome_kind, "receipt");
    assert.equal(receipt.preset, "inspect@1");
    assert.equal(result.user_workspace_unchanged, true);
    assertWorkspaceUnchanged(paths);
    for (const path of [join(runDir, "run.json"), ...walkJson(join(runDir, "artifacts"))]) {
      const artifact = readJson(path);
      assert.equal(validate(artifact), true, `${path}: ${JSON.stringify(validate.errors)}`);
    }
  } finally {
    dispose(paths);
  }
});

test("AC-48-4 fabricated Promotion, Result Ref mutation, or promotion_ref on an inspect@1 outcome is rejected closed with no mutation", { timeout: 60_000 }, async () => {
  const ran = await completedRun();
  try {
    const runDir = ran.runDir;
    const ctx = { runDir, runId: ran.result.run_id, admittedRefs: [] };
    const receiptPath = join(runDir, "artifacts/outcomes/0001.json");
    const receipt = readJson(receiptPath);
    assert.equal("promotion_ref" in receipt, false);
    assert.equal(Object.keys(receipt).some((key) => /appl/i.test(key)), false,
      "an inspect@1 Receipt must carry no Application claim field");
    assert.equal(existsSync(join(runDir, "artifacts/promotions")), false);
    assert.equal(existsSync(join(runDir, "result-repository.git")), false);
    const fabricatedPromotion = {
      schema_version: "1.0",
      kind: "promotion",
      artifact_id: "promotion-1",
      run_id: ran.result.run_id,
      producer: { role: "kernel", actor_id: "kernel-m1" },
      input_refs: [],
      created_at: "2026-08-18T00:00:00.000Z",
      verified_snapshot: receipt.accepted_snapshot,
      result_ref: `refs/orchestrator/results/${ran.result.run_id}`,
      expected_ref_oid: null,
      promoted_ref_oid: "0123456789012345678901234567890123456789",
      promoted_resources: [],
      promoted_snapshot: receipt.accepted_snapshot,
    };
    assert.equal(validate(fabricatedPromotion), true, JSON.stringify(validate.errors));
    assert.throws(
      () => admitArtifact(ctx, "artifacts/promotions/promotion-1.json", fabricatedPromotion),
      /inspect@1 admits no Promotion or Result Ref mutation/,
    );
    const fabricatedOutcome = {
      schema_version: "1.0",
      kind: "outcome",
      artifact_id: "outcome-fabricated",
      run_id: ran.result.run_id,
      producer: { role: "kernel", actor_id: "kernel-m1" },
      input_refs: [],
      created_at: "2026-08-18T00:00:00.000Z",
      preset: "inspect@1",
      effective_policy: receipt.effective_policy,
      outcome_kind: "receipt",
      summary: "fabricated receipt with a promotion_ref",
      artifact_refs: [],
      limitations: [],
      accepted_snapshot: receipt.accepted_snapshot,
      verified_snapshot: receipt.accepted_snapshot,
      promotion_ref: {
        reference_kind: "artifact",
        artifact_id: "promotion-1",
        path: "artifacts/promotions/promotion-1.json",
        digest: fabricatedPromotion.promoted_snapshot,
      },
    };
    assert.equal(validate(fabricatedOutcome), true, JSON.stringify(validate.errors));
    assert.throws(
      () => admitArtifact(ctx, "artifacts/outcomes/0002.json", fabricatedOutcome),
      /inspect@1 admits no Promotion or Result Ref mutation/,
    );
    assert.equal(existsSync(join(runDir, "artifacts/promotions")), false, "no mutation happened");
    assert.equal(existsSync(join(runDir, "artifacts/outcomes/0002.json")), false, "no mutation happened");
  } finally {
    // shared fixture disposal happens in test.after
  }
});

test("AC-48-5 an admitted inspect@1 request cannot silently widen into local-change@1 mid-run", { timeout: 60_000 }, async () => {
  const switched = await assertInspectBlocked({ presetSwitch: true });
  assert.match(switched.failure.summary, /planner Request did not select inspect@1/);
  assert.equal(switched.state.effective_policy, undefined);

  const ran = await completedRun();
  try {
    const ctx = { runDir: ran.runDir, runId: ran.result.run_id, admittedRefs: [] };
    const widenedPacket = readJson(join(ran.runDir, "artifacts/tasks/research-1/attempts/1/packet.json"));
    assert.throws(
      () => admitArtifact(ctx, "artifacts/tasks/research-1/attempts/2/packet.json", {
        ...widenedPacket,
        artifact_id: "packet-research-1-widened",
        capabilities: ["repository_read", "local_write", "command_execute"],
      }),
      /policy narrowing widens inspect@1 capabilities/,
    );
    const receipt = readJson(join(ran.runDir, "artifacts/outcomes/0001.json"));
    assert.throws(
      () => admitArtifact(ctx, "artifacts/outcomes/0003.json", {
        schema_version: "1.0",
        kind: "outcome",
        artifact_id: "outcome-widened",
        run_id: ran.result.run_id,
        producer: { role: "kernel", actor_id: "kernel-m1" },
        input_refs: [],
        created_at: "2026-08-18T00:00:00.000Z",
        preset: "local-change@1",
        outcome_kind: "material_decision_request",
        summary: "fabricated preset switch into local-change@1",
        artifact_refs: [],
        limitations: [],
        question: "should this inspect Run widen into local-change@1?",
      }),
      /inspect@1 Run cannot admit a local-change@1 outcome/,
    );
    assert.equal(existsSync(join(ran.runDir, "artifacts/tasks/research-1/attempts/2")), false);
    assert.equal(existsSync(join(ran.runDir, "artifacts/outcomes/0003.json")), false);
  } finally {
    // shared fixture disposal happens in test.after
  }
});

test("AC-48-6 the normative repository-only trace declares the inspect@1 budget and the focused gate passes without new dependencies", { timeout: 60_000 }, async () => {
  const ran = await completedRun();
  try {
    const state = readJson(join(ran.runDir, "run.json"));
    assert.deepEqual(state.budget, {
      max_concurrency: 1,
      max_execution_attempts: 2,
      max_planner_attempts: 3,
      max_graph_revisions: 2,
      max_repairs_per_finding: 0,
    });
    assert.deepEqual(state.runtime_bindings.filter(({ role }) => role === "planner").length, 3);
    assert.deepEqual(state.runtime_bindings.filter(({ role }) => role === "worker" || role === "verifier").length, 2);
    const packageJson = readJson(join(repository, "package.json"));
    assert.equal(packageJson.scripts["test:m5a-inspect"], "node --test test/m5a-inspect.test.mjs");
    assert.deepEqual(packageJson.dependencies ?? {}, {});
    assert.deepEqual(Object.keys(packageJson.devDependencies), ["ajv"]);
    const source = readFileSync(join(repository, "test/m5a-inspect.test.mjs"), "utf8");
    for (const id of ["AC-48-1", "AC-48-2", "AC-48-3", "AC-48-4", "AC-48-5", "AC-48-6"]) {
      assert.equal(source.includes(id), true, `missing focused acceptance id ${id}`);
    }
  } finally {
    // shared fixture disposal happens in test.after
  }
});
