import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { cancelRun, digest, resumeRun, runLocalChange } from "../scripts/local-change.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

class Runtime {
  constructor(options) {
    Object.assign(this, options);
    this.configurationDigest = digest("m2-config");
    this.attemptDeadlineSeconds = 3;
    this.sequence = 0;
    this.executionSequence = 0;
  }
  async start() {}
  async stop() {}
  async newAttempt({ role, attemptId, taskId, attempt }) {
    const binding = {
      attempt_id: attemptId, ...(taskId ? { task_id: taskId } : {}), attempt,
      session_id: `m2-session-${++this.sequence}`, role, agent_identity: digest(`m2-${role}`),
      agent: `m1-${role}`, model: "fake/model", configuration_digest: this.configurationDigest,
      binding_state: "active",
    };
    return { binding };
  }
  observation({ attemptId, role, binding, snapshot, taskId, attempt, executionNumber = 0 }) {
    return {
      schema_version: "1.0", kind: "runtime_observation", artifact_id: `runtime-${attemptId}`,
      run_id: this.runId, producer: { role: "runtime", actor_id: "m2-runtime" }, input_refs: [],
      created_at: "2026-08-05T00:00:00.000Z", attempt_id: attemptId,
      ...(taskId ? { task_id: taskId } : {}),
      ...(role === "worker" || role === "verifier" ? { attempt } : {}),
      role, opencode_version: "fake", configuration_digest: this.configurationDigest,
      session_id: binding.session_id,
      agent_identity: binding.agent_identity,
      message_ids: executionNumber === 0 ? [] : [`m2-message-${attemptId}-${executionNumber}`],
      agent: binding.agent,
      model: binding.model,
      runtime_permission_events: executionNumber === 0 ? [] : [`m2-permission-${attemptId}-${executionNumber}`],
      command_executions: [],
      observed_changes: [], observed_output_snapshot: snapshot.digest, external_reads: [], exit_reason: "idle",
    };
  }
  preflightObservation({ attemptId, role, binding }) {
    return this.observation({ attemptId, role, binding, snapshot: this.baselineSnapshot });
  }
  async execute({ role, attemptId, taskId, attempt, binding, beforeSnapshot }) {
    this.executionSequence += 1;
    let text;
    let workerProposalPhase = false;
    if (attemptId === "planner-request") text = JSON.stringify({
      objective: this.requestText, scope: [this.targetFile], exclusions: ["external effects"],
      ambiguities: this.scenario === "material"
        ? ["material: choose the durable external target"]
        : this.scenario === "low-risk"
          ? ["low-risk: target filename", "low-risk: line ending"]
          : [], assumptions: [], target_snapshot: this.baselineSnapshot.digest,
      preset_selection: { preset: "local-change@1", selection_evidence: [{ claim: "bounded", source: "intake", observation: "local" }], proposed_narrowing: null, rationale: "bounded" },
    });
    else if (attemptId === "planner-graph-1") text = JSON.stringify({ graph: { nodes: [{ task_id: "implementation-1", workflow_definition: "implementation" }] }, packet: { acceptance_criteria: ["target exists"], deadline_seconds: 3 } });
    else if (attemptId === "worker-implementation-1") {
      workerProposalPhase = this.workerProposalPhase === true;
      if (!workerProposalPhase) {
        writeFileSync(join(this.workspace, this.targetFile), this.expectedContent);
        this.workerProposalPhase = true;
        text = JSON.stringify({ status: "edit complete" });
      } else {
        text = this.scenario === "worker-proposal"
          ? JSON.stringify({
            claims: ["worker-authored claim"],
            evidence: [{ claim: "worker observed the requested edit", source: "worker-report", observation: "the target was written" }],
            changed_resources: [this.targetFile],
          })
          : this.scenario === "worker-invalid-proposal"
            ? JSON.stringify({
              claims: [{ claim: "not a string" }],
              evidence: [{ claim: "the target was written", source: "worker-report", observation: "the target was written" }],
              changed_resources: [this.targetFile],
            })
          : JSON.stringify({
            claims: ["implemented"],
            evidence: [{ claim: "the target was written", source: "worker-report", observation: "the target was written" }],
            changed_resources: [this.targetFile],
          });
      }
    }
    else if (attemptId === "planner-graph-2") text = JSON.stringify({ carry_forward_task_id: "implementation-1", verifier_task: { task_id: "verification-1" }, verifier_packet: { acceptance_criteria: ["target matches"], deadline_seconds: 3 } });
    else text = JSON.stringify({ verdict: "pass", findings: [], evidence: [{ claim: "matches", source: "verifier-read", observation: "target matches" }] });
    const snapshot = (await import("../scripts/local-change.mjs")).workspaceSnapshot(this.workspace);
    if (workerProposalPhase && attemptId === "worker-implementation-1" && this.scenario !== "worker-missing-output-snapshot") {
      const proposal = JSON.parse(text);
      proposal.output_snapshot = snapshot.digest;
      text = JSON.stringify(proposal);
    }
    return {
      binding: { ...binding, binding_state: "idle" },
      text,
      snapshot,
      observation: this.observation({
        attemptId, role, binding, snapshot, taskId, attempt, executionNumber: this.executionSequence,
      }),
    };
  }

  async cancelAttempt({ binding, runDir }) {
    const observation = this.observation({
      attemptId: `${binding.attempt_id}-cancel`,
      role: binding.role,
      binding,
      snapshot: this.baselineSnapshot,
      taskId: binding.task_id,
      attempt: binding.attempt,
    });
    const confirmed = this.cancelConfirmed === true;
    return {
      confirmed,
      observation: {
        ...observation,
        artifact_id: `${binding.attempt_id}-cancel`,
        exit_reason: confirmed ? "cancelled" : "cancel_unconfirmed",
      },
      runDir,
    };
  }
}

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "m2-workspace-"));
  const runRoot = mkdtempSync(join(tmpdir(), "m2-runs-"));
  git(workspace, ["init", "-q", "-b", "main"]);
  git(workspace, ["config", "user.email", "m2@example.invalid"]);
  git(workspace, ["config", "user.name", "M2 Test"]);
  writeFileSync(join(workspace, "base.txt"), "base\n");
  mkdirSync(join(workspace, ".opencode/skills/m1-local-change"), { recursive: true });
  writeFileSync(join(workspace, ".opencode/skills/m1-local-change/SKILL.md"), "---\nname: m1-local-change\nversion: 1\n---\n");
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-qm", "fixture"]);
  return { workspace, runRoot };
}

function artifactEntries(runDir) {
  const entries = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.name.endsWith(".json")) {
        entries.push([absolutePath, JSON.parse(readFileSync(absolutePath, "utf8"))]);
      }
    }
  };
  visit(join(runDir, "artifacts"));
  return entries;
}

function cliResume(workspace, runRoot, runId, extra = []) {
  return JSON.parse(execFileSync(process.execPath, [
    "scripts/local-change.mjs", "resume", "--workspace", workspace,
    "--run-root", runRoot, "--run-id", runId, ...extra,
  ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
}

function cliResumeWithEnv(workspace, runRoot, runId, env, extra = []) {
  return JSON.parse(execFileSync(process.execPath, [
    "scripts/local-change.mjs", "resume", "--workspace", workspace,
    "--run-root", runRoot, "--run-id", runId, ...extra,
  ], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, ...env },
  }));
}

function actionSnapshot(runDir, runId) {
  const state = JSON.parse(readFileSync(join(runDir, "run.json")));
  let resultRef = null;
  try {
    resultRef = git(join(runDir, "result-repository.git"), ["rev-parse", `refs/orchestrator/results/${runId}`]).trim();
  } catch {
    // The prepared Promotion has not performed its Result Ref CAS yet.
  }
  return {
    state,
    promotion: existsSync(join(runDir, "artifacts/promotions/promotion-1.json")),
    receipt: existsSync(join(runDir, "artifacts/outcomes/0001.json")),
    resultRef,
  };
}

function assertResumeAction(before, after, expected, label) {
  const events = after.state.transitions.slice(before.state.transitions.length).map(({ event_kind }) => event_kind);
  assert.deepEqual(events, ["promotion_prepared", "result_ref_promoted"].includes(expected) ? [] : [expected], label);
  if (expected === "promotion_prepared") {
    assert.equal(before.promotion, false, label);
    assert.equal(after.promotion, true, label);
    assert.equal(after.receipt, false, label);
  } else if (expected === "result_ref_promoted") {
    assert.equal(after.promotion, true, label);
    assert.notEqual(after.resultRef, before.resultRef, label);
    assert.equal(after.receipt, false, label);
  } else if (expected === "receipt_admitted") {
    assert.equal(after.receipt, true, label);
    assert.equal(after.state.lifecycle_state, "completed", label);
  } else {
    assert.equal(after.state.lifecycle_state, "active", label);
  }
}

test("resume reconstructs a terminal Run idempotently and rejects invalid durable state", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const run = await runLocalChange({ workspace, runRoot, requestText: "Add change.txt.", runtimeFactory: (options) => new Runtime(options) });
    const statePath = join(run.run_dir, "run.json");
    const inspected = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "inspect", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(inspected.result_ref, `refs/orchestrator/results/${run.run_id}`);
    assert.equal(Array.isArray(inspected.runtime_bindings), true);
    assert.equal(inspected.receipt.artifact_refs.some(({ path }) => path.endsWith("result.json")), true);
    const before = readFileSync(statePath, "utf8");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const resumed = JSON.parse(execFileSync(process.execPath, [
        "scripts/local-change.mjs", "resume", "--workspace", workspace, "--run-root", runRoot, "--run-id", run.run_id,
      ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
      assert.equal(resumed.lifecycle_state, "completed");
      assert.equal(resumed.next_action, null);
      assert.equal(readFileSync(statePath, "utf8"), before);
    }
    writeFileSync(statePath, "{}\n");
    assert.throws(() => execFileSync(process.execPath, [
      "scripts/local-change.mjs", "resume", "--workspace", workspace, "--run-root", runRoot, "--run-id", run.run_id,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    assert.throws(() => execFileSync(process.execPath, [
      "scripts/local-change.mjs", "inspect", "--workspace", workspace, "--run-root", runRoot, "--run-id", run.run_id,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("Result artifact reconstruction keeps Result Ref vocabulary reserved for Git refs", () => {
  const source = readFileSync(new URL("../scripts/local-change.mjs", import.meta.url), "utf8");
  assert.match(source, /const resultArtifactRef = existingState\.tasks\["implementation-1"\]\.artifact_ref/);
  assert.doesNotMatch(source, /const resultRef = existingState\.tasks\["implementation-1"\]\.artifact_ref/);
});

test("public inspect rejects completed state without an immutable Receipt", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const run = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime(options),
    });
    const statePath = join(run.run_dir, "run.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.transitions = state.transitions.filter(({ event_kind }) => event_kind !== "receipt_admitted");
    state.lifecycle_state = "completed";
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    rmSync(join(run.run_dir, "artifacts/outcomes/0001.json"));
    assert.throws(() => execFileSync(process.execPath, [
      "scripts/local-change.mjs", "inspect", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /completed.*Receipt|Receipt.*completed/i);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("public inspect rejects semantically malformed completed artifacts", async () => {
  const cases = [
    {
      name: "review verdict",
      mutate: ({ review }) => {
        review.verdict = "finding";
        review.findings = [{
          finding_id: "finding-1",
          fingerprint: digest("finding-1"),
          criterion: "the completed change must pass independent verification",
          evidence: [],
        }];
      },
      expected: /independent pass|verdict|findings/i,
    },
    {
      name: "producer identity",
      mutate: ({ result, review }) => { review.producer.actor_id = result.producer.actor_id; },
      expected: /producer|independent/i,
    },
    {
      name: "worker and verifier session collision",
      mutate: ({ state, reviewRuntime }) => {
        const workerBinding = state.runtime_bindings.find(({ role }) => role === "worker");
        const verifierBinding = state.runtime_bindings.find(({ role }) => role === "verifier");
        verifierBinding.session_id = workerBinding.session_id;
        reviewRuntime.session_id = workerBinding.session_id;
      },
      expected: /session|independent|provenance/i,
    },
    {
      name: "runtime role",
      mutate: ({ result, review }) => { review.runtime_ref = result.runtime_ref; },
      expected: /runtime|independent/i,
    },
    {
      name: "Result snapshot",
      mutate: ({ result }) => { result.output_snapshot = digest("tampered-output-snapshot"); },
      expected: /snapshot|Result/i,
    },
    {
      name: "Result Runtime task identity",
      mutate: ({ resultRuntime }) => { resultRuntime.task_id = "wrong-task"; },
      expected: /runtime|task|provenance/i,
    },
    {
      name: "Review Runtime attempt identity",
      mutate: ({ reviewRuntime }) => { reviewRuntime.attempt = 2; },
      expected: /runtime|attempt|provenance/i,
    },
    {
      name: "Result Runtime session binding",
      mutate: ({ resultRuntime }) => { resultRuntime.session_id = "wrong-session"; },
      expected: /runtime|session|binding/i,
    },
    {
      name: "Review Runtime observed snapshot",
      mutate: ({ reviewRuntime }) => { reviewRuntime.observed_output_snapshot = digest("wrong-observed-snapshot"); },
      expected: /runtime|snapshot|provenance/i,
    },
    {
      name: "Promotion child reference path",
      mutate: ({ promotion, result }) => {
        promotion.input_refs[0] = { ...promotion.input_refs[0], path: "artifacts/tasks/verification-1/attempts/1/review.json" };
        promotion.input_refs[0].artifact_id = result.artifact_id;
      },
      expected: /Promotion|Result|reference|exact/i,
    },
    {
      name: "Receipt child reference path",
      mutate: ({ receipt, result }) => {
        const child = receipt.artifact_refs.find(({ path }) => path.endsWith("attempts/1/result.json"));
        child.path = "artifacts/tasks/verification-1/attempts/1/review.json";
        child.artifact_id = result.artifact_id;
      },
      expected: /Receipt|reference|exact/i,
    },
  ];
  for (const testCase of cases) {
    const { workspace, runRoot } = fixture();
    try {
      const run = await runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => new Runtime(options),
      });
      const statePath = join(run.run_dir, "run.json");
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      const resultPath = join(run.run_dir, state.tasks["implementation-1"].artifact_ref.path);
      const reviewPath = join(run.run_dir, state.tasks["verification-1"].artifact_ref.path);
      const result = JSON.parse(readFileSync(resultPath, "utf8"));
      const review = JSON.parse(readFileSync(reviewPath, "utf8"));
      const resultRuntimePath = join(run.run_dir, result.runtime_ref.path);
      const reviewRuntimePath = join(run.run_dir, review.runtime_ref.path);
      const promotionRef = JSON.parse(readFileSync(join(run.run_dir, "artifacts/outcomes/0001.json"), "utf8")).promotion_ref;
      const promotionPath = join(run.run_dir, promotionRef.path);
      const promotion = JSON.parse(readFileSync(promotionPath, "utf8"));
      const receiptPath = join(run.run_dir, "artifacts/outcomes/0001.json");
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      const resultRuntime = JSON.parse(readFileSync(resultRuntimePath, "utf8"));
      const reviewRuntime = JSON.parse(readFileSync(reviewRuntimePath, "utf8"));
      testCase.mutate({ state, result, review, resultRuntime, reviewRuntime, promotion, receipt });
      const replaceRefs = (value, path, next) => {
        if (Array.isArray(value)) return value.forEach((item) => replaceRefs(item, path, next));
        if (!value || typeof value !== "object") return;
        if (value.reference_kind === "artifact" && value.path === path) {
          Object.assign(value, next);
          return;
        }
        Object.values(value).forEach((item) => replaceRefs(item, path, next));
      };
      const containers = [state, result, review, promotion, receipt];
      const artifacts = artifactEntries(run.run_dir);
      for (const [absolutePath, artifact] of [
        [resultRuntimePath, resultRuntime],
        [reviewRuntimePath, reviewRuntime],
        [resultPath, result],
        [reviewPath, review],
        [promotionPath, promotion],
        [receiptPath, receipt],
      ]) {
        const entry = artifacts.find(([path]) => path === absolutePath);
        if (entry) entry[1] = artifact;
      }
      containers.push(...artifacts.map(([, artifact]) => artifact));
      for (let pass = 0; pass < artifacts.length; pass += 1) {
        for (const [absolutePath, artifact] of artifacts) {
          const path = absolutePath.slice(`${run.run_dir}/`.length);
          const nextRef = {
            reference_kind: "artifact",
            artifact_id: artifact.artifact_id,
            path,
            digest: digest(artifact),
          };
          containers.forEach((value) => replaceRefs(value, path, nextRef));
        }
      }
      artifacts.forEach(([absolutePath, artifact]) => writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`));
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
      assert.throws(() => execFileSync(process.execPath, [
        "scripts/local-change.mjs", "inspect", "--workspace", workspace,
        "--run-root", runRoot, "--run-id", run.run_id,
      ], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), testCase.expected, testCase.name);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
});

test("public inspect walks planner Request, Graph, and Packet Runtime provenance", async () => {
  for (const runtimePath of [
    "artifacts/runtime/planner-request.json",
    "artifacts/runtime/planner-graph-1.json",
    "artifacts/runtime/planner-graph-2.json",
  ]) {
    const { workspace, runRoot } = fixture();
    try {
      const run = await runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => new Runtime(options),
      });
      const path = join(run.run_dir, runtimePath);
      const runtime = JSON.parse(readFileSync(path, "utf8"));
      runtime.message_ids = ["tampered-planner-runtime"];
      const statePath = join(run.run_dir, "run.json");
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      state.transitions = state.transitions.map((transition) => ({
        ...transition,
        record_refs: transition.record_refs.filter((recordRef) => recordRef.path !== runtimePath),
      }));
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
      writeFileSync(path, `${JSON.stringify(runtime, null, 2)}\n`);
      assert.throws(() => execFileSync(process.execPath, [
        "scripts/local-change.mjs", "inspect", "--workspace", workspace,
        "--run-root", runRoot, "--run-id", run.run_id,
      ], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /artifact reference digest|reference/i, runtimePath);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
});

test("ambiguous planner, worker, and verifier Attempts reconcile the same binding without re-dispatch", async () => {
  for (const targetAttemptId of ["planner-graph-1", "worker-implementation-1", "verifier-1"]) {
    const { workspace, runRoot } = fixture();
    try {
      let runtime;
      await assert.rejects(() => runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => {
          runtime = new Runtime(options);
          runtime.executeCalls = [];
          runtime.reconcileCalls = [];
          const execute = runtime.execute.bind(runtime);
          const newAttempt = runtime.newAttempt.bind(runtime);
          runtime.newAttempt = async (spec) => {
            runtime.executeCalls.push({ kind: "newAttempt", attemptId: spec.attemptId });
            return newAttempt(spec);
          };
          runtime.execute = async (spec) => {
            runtime.executeCalls.push({ kind: "execute", attemptId: spec.attemptId, sessionId: spec.binding.session_id });
            if (spec.attemptId === targetAttemptId) {
              throw Object.assign(new Error("socket hang up after provider accepted the Attempt"), { code: "ECONNRESET" });
            }
            return execute(spec);
          };
          runtime.reconcileAttempt = async (spec) => {
            runtime.reconcileCalls.push({ attemptId: spec.attemptId, sessionId: spec.binding.session_id });
            throw Object.assign(new Error("no completed provider message is observable"), { code: "runtime_reconciliation_required" });
          };
          return runtime;
        },
      }), /socket hang up|provider|Attempt/i);
      const runId = readdirSync(join(runRoot, "runs"))[0];
      const runDir = join(runRoot, "runs", runId);
      const before = JSON.parse(readFileSync(join(runDir, "run.json")));
      const bindingBefore = before.runtime_bindings.find(({ attempt_id }) => attempt_id === targetAttemptId);
      assert.ok(bindingBefore, `${targetAttemptId} binding was not durable before the ambiguous POST`);
      assert.equal(bindingBefore.binding_state, "unreachable", targetAttemptId);
      const beforeTargetPosts = runtime.executeCalls.filter(({ kind, attemptId }) => kind === "execute" && attemptId === targetAttemptId).length;
      const beforeTargetSessions = runtime.executeCalls.filter(({ kind, attemptId }) => kind === "newAttempt" && attemptId === targetAttemptId).length;

      const resumed = await resumeRun(runDir, { workspace, runtime });
      assert.equal(resumed.checkpoint, "runtime_reconciliation_required", targetAttemptId);
      assert.deepEqual(runtime.reconcileCalls, [{ attemptId: targetAttemptId, sessionId: bindingBefore.session_id }], targetAttemptId);
      assert.equal(runtime.executeCalls.filter(({ kind, attemptId }) => kind === "execute" && attemptId === targetAttemptId).length, beforeTargetPosts, targetAttemptId);
      assert.equal(runtime.executeCalls.filter(({ kind, attemptId }) => kind === "newAttempt" && attemptId === targetAttemptId).length, beforeTargetSessions, targetAttemptId);
      const after = JSON.parse(readFileSync(join(runDir, "run.json")));
      assert.equal(after.runtime_bindings.filter(({ attempt_id }) => attempt_id === targetAttemptId).length, 1, targetAttemptId);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
});

test("public resume reconciles an ambiguous graph-1 binding with GET only", async () => {
  const { workspace, runRoot } = fixture();
  const fakeBin = mkdtempSync(join(tmpdir(), "m2-graph-one-reconcile-bin-"));
  try {
    let runtime;
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => {
        runtime = new Runtime(options);
        const execute = runtime.execute.bind(runtime);
        runtime.execute = async (spec) => {
          if (spec.attemptId === "planner-graph-1") {
            throw Object.assign(new Error("socket hang up after provider accepted graph-1"), { code: "ECONNRESET" });
          }
          return execute(spec);
        };
        return runtime;
      },
    }), /socket hang up|provider|Attempt/i);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    const before = JSON.parse(readFileSync(join(runDir, "run.json")));
    assert.ok(before.runtime_bindings.some(({ attempt_id }) => attempt_id === "planner-graph-1"));
    const providerState = join(fakeBin, "provider-state.json");
    writeFileSync(providerState, JSON.stringify({ sessionPosts: 0, messagePosts: 0, gets: 0 }));
    const fakeOpencode = join(fakeBin, "opencode");
    writeFileSync(fakeOpencode, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
const args = process.argv.slice(2);
const statePath = process.env.M2_GRAPH_ONE_RECONCILE_STATE;
const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
const writeState = (state) => writeFileSync(statePath, JSON.stringify(state));
const send = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
if (args[0] === "--version") process.stdout.write("m2-graph-one-reconcile\\n");
else if (args[0] === "debug") process.stdout.write(JSON.stringify({ instructions: [], plugin: [], mcp: {}, agent: {}, command: {}, provider: {} }) + "\\n");
else if (args[0] === "serve") {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const state = readState();
    if (url.pathname === "/global/health") return send(response, 200, { healthy: true, version: "m2-graph-one-reconcile" });
    if (url.pathname === "/agent") return send(response, 200, ["planner", "worker", "verifier"].map((role) => ({ name: "m1-" + role, model: { providerID: "fake", modelID: "model" } })));
    if (url.pathname === "/event") { response.statusCode = 200; response.setHeader("content-type", "text/event-stream"); response.write(": ready\\n\\n"); return; }
    if (request.method === "GET" && url.pathname === "/session/status") { writeState({ ...state, gets: state.gets + 1 }); return send(response, 200, {}); }
    if (request.method === "GET" && url.pathname.startsWith("/session/")) { writeState({ ...state, gets: state.gets + 1 }); return send(response, 200, []); }
    if (request.method === "POST" && url.pathname === "/session") { writeState({ ...state, sessionPosts: state.sessionPosts + 1 }); return send(response, 500, { error: "duplicate session creation forbidden" }); }
    if (request.method === "POST" && url.pathname.startsWith("/session/")) { writeState({ ...state, messagePosts: state.messagePosts + 1 }); return send(response, 500, { error: "duplicate message dispatch forbidden" }); }
    return send(response, 404, { error: "not found" });
  });
  server.listen(Number(args[args.indexOf("--port") + 1]), "127.0.0.1");
}
`);
    chmodSync(fakeOpencode, 0o755);
    const resumed = cliResumeWithEnv(workspace, runRoot, runId, {
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      M2_GRAPH_ONE_RECONCILE_STATE: providerState,
    });
    assert.equal(resumed.checkpoint, "runtime_reconciliation_required");
    const provider = JSON.parse(readFileSync(providerState));
    assert.equal(provider.sessionPosts, 0);
    assert.equal(provider.messagePosts, 0);
    assert.ok(provider.gets > 0);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("public inspect rejects digest-valid planner provenance with forged semantic identity", async () => {
  const cases = [
    { name: "Request", path: "artifacts/request.json" },
    { name: "graph", path: "artifacts/graphs/0001.json" },
    { name: "Packet", path: "artifacts/tasks/implementation-1/attempts/1/packet.json" },
  ];
  for (const testCase of cases) {
    const { workspace, runRoot } = fixture();
    try {
      const run = await runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => new Runtime(options),
      });
      const statePath = join(run.run_dir, "run.json");
      const state = JSON.parse(readFileSync(statePath));
      const entries = artifactEntries(run.run_dir).map(([absolutePath, artifact]) => [
        absolutePath.slice(`${run.run_dir}/`.length), artifact,
      ]);
      const artifacts = new Map(entries);
      const target = artifacts.get(testCase.path);
      const runtime = artifacts.get(target.runtime_ref.path);
      const forgedIdentity = digest(`forged-planner-${testCase.name}`);
      target.producer.actor_id = forgedIdentity;
      runtime.agent_identity = forgedIdentity;
      const containers = [state, ...entries.map(([, artifact]) => artifact)];
      const replaceRefs = (value, path, next) => {
        if (Array.isArray(value)) return value.forEach((item) => replaceRefs(item, path, next));
        if (!value || typeof value !== "object") return;
        if (value.reference_kind === "artifact" && value.path === path) {
          Object.assign(value, next);
          return;
        }
        Object.values(value).forEach((item) => replaceRefs(item, path, next));
      };
      for (let pass = 0; pass < entries.length; pass += 1) {
        for (const [path, artifact] of entries) {
          const nextRef = {
            reference_kind: "artifact",
            artifact_id: artifact.artifact_id,
            path,
            digest: digest(artifact),
          };
          containers.forEach((value) => replaceRefs(value, path, nextRef));
        }
      }
      for (const [path, artifact] of entries) {
        writeFileSync(join(run.run_dir, path), `${JSON.stringify(artifact, null, 2)}\n`);
      }
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
      assert.throws(() => execFileSync(process.execPath, [
        "scripts/local-change.mjs", "inspect", "--workspace", workspace,
        "--run-root", runRoot, "--run-id", run.run_id,
      ], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /planner|identity|binding|provenance/i, testCase.name);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
});

test("cancel persists intent before abort and closes only after a confirmed stop", async () => {
  const { workspace, runRoot } = fixture();
  try {
    let runtime;
    const result = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => {
        runtime = new Runtime(options);
        runtime.cancelConfirmed = true;
        const cancel = runtime.cancelAttempt.bind(runtime);
        runtime.cancelAttempt = async (request) => {
          const state = JSON.parse(readFileSync(join(request.runDir, "run.json")));
          assert.equal(state.lifecycle_state, "cancelling");
          assert.equal(state.transitions.at(-1).event_kind, "cancel_requested");
          return cancel(request);
        };
        return runtime;
      },
      hooks: {
        afterWorkerDispatch: async ({ runDir, adapter }) => {
          await cancelRun(runDir, { runtime: adapter });
        },
      },
    });
    const state = JSON.parse(readFileSync(join(result.run_dir, "run.json")));
    assert.equal(state.lifecycle_state, "cancelled");
    assert.deepEqual(state.transitions.slice(-2).map(({ event_kind }) => event_kind), [
      "cancel_requested",
      "cancel_confirmed",
    ]);
    assert.equal(state.runtime_bindings.at(-1).binding_state, "cancelled");
    assert.equal(runtime.sequence, 3);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("cancel_unconfirmed is durable and never permits successor dispatch", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const result = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => {
        const runtime = new Runtime(options);
        runtime.cancelConfirmed = false;
        return runtime;
      },
      hooks: {
        afterWorkerDispatch: async ({ runDir, adapter }) => {
          await cancelRun(runDir, { runtime: adapter });
        },
      },
    });
    const state = JSON.parse(readFileSync(join(result.run_dir, "run.json")));
    const block = JSON.parse(readFileSync(join(result.run_dir, "artifacts/outcomes/cancel.json")));
    assert.equal(state.lifecycle_state, "blocked");
    assert.equal(block.block_type, "cancel_unconfirmed");
    assert.equal(state.runtime_bindings.at(-1).binding_state, "unreachable");
    assert.equal(state.transitions.some(({ event_kind }) => event_kind === "successor_dispatched"), false);
    const cancellation = readdirSync(join(result.run_dir, "artifacts/runtime")).find((name) => name.includes("cancel"));
    assert.ok(cancellation);
    assert.equal(JSON.parse(readFileSync(join(result.run_dir, "artifacts/runtime", cancellation))).exit_reason, "cancel_unconfirmed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("public cancel command records an unconfirmed stop after process death", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const crash = new Error("simulated process death");
    crash.code = "simulated_crash";
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime(options),
      hooks: { afterWorkerDispatch: async () => { throw crash; } },
    }), /simulated process death/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const result = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "cancel", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", runId,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(result.lifecycle_state, "blocked");
    const runDir = join(runRoot, "runs", runId);
    const state = JSON.parse(readFileSync(join(runDir, "run.json")));
    assert.deepEqual(state.transitions.slice(-2).map(({ event_kind }) => event_kind), [
      "cancel_requested",
      "cancel_unconfirmed",
    ]);
    assert.equal(JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/cancel.json"))).block_type, "cancel_unconfirmed");
    const beforeResume = readFileSync(join(runDir, "run.json"), "utf8");
    const beforeRuntime = readdirSync(join(runDir, "artifacts/runtime")).sort();
    const firstResume = cliResume(workspace, runRoot, runId);
    const secondResume = cliResume(workspace, runRoot, runId);
    assert.equal(firstResume.lifecycle_state, "blocked");
    assert.equal(firstResume.checkpoint, "cancel_unconfirmed");
    assert.deepEqual(secondResume, firstResume);
    assert.equal(readFileSync(join(runDir, "run.json"), "utf8"), beforeResume);
    assert.deepEqual(readdirSync(join(runDir, "artifacts/runtime")).sort(), beforeRuntime);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("cancel with no active binding durably blocks instead of stalling", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const crash = new Error("simulated process death");
    crash.code = "simulated_crash";
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime(options),
      hooks: { afterWorkerDispatch: async () => { throw crash; } },
    }), /simulated process death/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    const state = JSON.parse(readFileSync(join(runDir, "run.json")));
    state.runtime_bindings = state.runtime_bindings.map((binding) => ({ ...binding, binding_state: "idle" }));
    writeFileSync(join(runDir, "run.json"), `${JSON.stringify(state, null, 2)}\n`);

    const result = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "cancel", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", runId,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(result.lifecycle_state, "blocked");
    const durable = JSON.parse(readFileSync(join(runDir, "run.json")));
    assert.deepEqual(durable.transitions.slice(-2).map(({ event_kind }) => event_kind), [
      "cancel_requested",
      "cancel_unconfirmed",
    ]);
    assert.equal(JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/cancel.json"))).block_type, "cancel_unconfirmed");
    assert.equal(readdirSync(join(runDir, "artifacts/runtime")).some((file) => file.includes("cancel")), true);
    assert.equal(durable.transitions.some(({ event_kind }) => event_kind === "successor_dispatched"), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("prepared Promotion resumes across absent, committed, and conflicting Result Ref states", async () => {
  for (const crashAt of ["after_promotion_preparation", "after_result_ref_update"]) {
    const { workspace, runRoot } = fixture();
    try {
      let run;
      await assert.rejects(() => runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => new Runtime(options),
        hooks: { crashAt },
      }), /simulated process death/);
      const runId = readdirSync(join(runRoot, "runs"))[0];
      const runDir = join(runRoot, "runs", runId);
      const prepared = JSON.parse(readFileSync(join(runDir, "artifacts/promotions/promotion-1.json")));
      assert.equal(prepared.expected_ref_oid, null);
      const expectedActions = crashAt === "after_promotion_preparation"
        ? ["result_ref_promoted", "receipt_admitted"]
        : ["receipt_admitted"];
      for (const expected of expectedActions) {
        const before = actionSnapshot(runDir, runId);
        run = cliResume(workspace, runRoot, runId);
        assertResumeAction(before, actionSnapshot(runDir, runId), expected, `${crashAt}: ${expected}`);
        if (expected !== "receipt_admitted") assert.equal(run.lifecycle_state, "active");
      }
      assert.equal(run.lifecycle_state, "completed");
      assert.equal(run.next_action, null);
      const before = readFileSync(join(runDir, "run.json"), "utf8");
      assert.equal(cliResume(workspace, runRoot, runId).lifecycle_state, "completed");
      assert.equal(readFileSync(join(runDir, "run.json"), "utf8"), before);
      assert.equal(JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/0001.json"))).outcome_kind, "receipt");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }

  const { workspace, runRoot } = fixture();
  try {
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime(options),
      hooks: { crashAt: "after_promotion_preparation" },
    }), /simulated process death/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    const promotion = JSON.parse(readFileSync(join(runDir, "artifacts/promotions/promotion-1.json")));
    const tree = git(join(runDir, "result-repository.git"), ["rev-parse", `${promotion.promoted_ref_oid}^{tree}`]).trim();
    const drift = execFileSync("git", ["commit-tree", tree, "-m", "drift"], {
      cwd: join(runDir, "result-repository.git"),
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "M2 Drift", GIT_AUTHOR_EMAIL: "m2@example.invalid", GIT_COMMITTER_NAME: "M2 Drift", GIT_COMMITTER_EMAIL: "m2@example.invalid" },
    }).trim();
    git(join(runDir, "result-repository.git"), ["update-ref", `refs/orchestrator/results/${runId}`, drift]);
    const resumed = cliResume(workspace, runRoot, runId);
    assert.equal(resumed.lifecycle_state, "blocked");
    assert.equal(JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/failure.json"))).block_type, "result_ref_drift");
    assert.equal(git(join(runDir, "result-repository.git"), ["rev-parse", `refs/orchestrator/results/${runId}`]).trim(), drift);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("crash boundaries are deterministic and repeated resume is idempotent", async () => {
  const actionPlans = {
    before_promotion_preparation: ["promotion_prepared", "result_ref_promoted", "receipt_admitted"],
    after_promotion_preparation: ["result_ref_promoted", "receipt_admitted"],
    before_result_ref_update: ["result_ref_promoted", "receipt_admitted"],
    after_result_ref_update: ["receipt_admitted"],
    after_result_publication: ["implementation_result_admitted", "runtime_dispatch_prepared", "graph_revision_2_admitted", "verification_dispatched", "review_admitted", "promotion_prepared", "result_ref_promoted", "receipt_admitted"],
    after_review_publication: ["review_admitted", "promotion_prepared", "result_ref_promoted", "receipt_admitted"],
    "before_run_state_replacement:receipt_admitted": ["receipt_admitted"],
    "after_run_state_replacement:receipt_admitted": [],
  };
  for (const crashAt of Object.keys(actionPlans)) {
    const { workspace, runRoot } = fixture();
    try {
      let runtime;
      await assert.rejects(() => runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => {
          runtime = new Runtime(options);
          return runtime;
        },
        hooks: { crashAt },
      }), /simulated process death/);
      const runId = readdirSync(join(runRoot, "runs"))[0];
      const runDir = join(runRoot, "runs", runId);
      const resume = () => crashAt === "after_result_publication"
        ? resumeRun(runDir, { workspace, runtime })
        : cliResume(workspace, runRoot, runId);
      for (const expected of actionPlans[crashAt]) {
        const before = actionSnapshot(runDir, runId);
        const resumed = await resume();
        const after = actionSnapshot(runDir, runId);
        assertResumeAction(before, after, expected, `${crashAt}: ${expected}`);
        if (expected !== "receipt_admitted") assert.equal(resumed.lifecycle_state, "active", `${crashAt}: ${expected}`);
      }
      const stateBeforeRepeat = readFileSync(join(runDir, "run.json"), "utf8");
      const second = cliResume(workspace, runRoot, runId);
      assert.equal(second.lifecycle_state, "completed", crashAt);
      assert.equal(readFileSync(join(runDir, "run.json"), "utf8"), stateBeforeRepeat, crashAt);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
});

test("Result-only continuation replays graph and verifier boundaries one action at a time", async () => {
  for (const crashAt of [
    "after_graph_two_packet_publication",
    "after_graph_two_publication",
    "after_verification_dispatch",
  ]) {
    const { workspace, runRoot } = fixture();
    try {
      let runtime;
      await assert.rejects(() => runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => {
          runtime = new Runtime(options);
          return runtime;
        },
        hooks: { crashAt },
      }), /simulated process death/);
      const runId = readdirSync(join(runRoot, "runs"))[0];
      const runDir = join(runRoot, "runs", runId);
      const expectedActions = crashAt === "after_verification_dispatch"
        ? ["review_admitted", "promotion_prepared", "result_ref_promoted", "receipt_admitted"]
        : ["graph_revision_2_admitted", "verification_dispatched", "review_admitted", "promotion_prepared", "result_ref_promoted", "receipt_admitted"];
      const seen = [];
      let resumeCount = 0;
      const resumeOneAction = () => {
        const usePublicCli = resumeCount === 0
          && ["after_graph_two_packet_publication", "after_graph_two_publication"].includes(crashAt);
        resumeCount += 1;
        return usePublicCli
          ? Promise.resolve(cliResume(workspace, runRoot, runId))
          : resumeRun(runDir, { workspace, runtime });
      };
      for (const expected of expectedActions) {
        const before = actionSnapshot(runDir, runId);
        const resumed = await resumeOneAction();
        const after = actionSnapshot(runDir, runId);
        assertResumeAction(before, after, expected, `${crashAt}: ${expected}`);
        seen.push(expected);
        if (expected !== "receipt_admitted") assert.equal(resumed.lifecycle_state, "active", `${crashAt}: ${expected}`);
        else assert.equal(resumed.lifecycle_state, "completed", crashAt);
      }
      assert.deepEqual(seen, expectedActions, crashAt);
      const finalState = readFileSync(join(runDir, "run.json"), "utf8");
      const final = await resumeRun(runDir, { workspace, runtime });
      assert.equal(final.lifecycle_state, "completed", crashAt);
      assert.equal(readFileSync(join(runDir, "run.json"), "utf8"), finalState, `${crashAt}: repeated terminal resume`);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
});

test("partial Runtime publication is reconciled without rewriting immutable observations", async () => {
  for (const crashAt of ["after_graph_two_runtime_publication", "after_verifier_runtime_publication"]) {
    const { workspace, runRoot } = fixture();
    try {
      let runtime;
      await assert.rejects(() => runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => {
          runtime = new Runtime(options);
          return runtime;
        },
        hooks: { crashAt },
      }), /simulated process death/);
      const runId = readdirSync(join(runRoot, "runs"))[0];
      const runDir = join(runRoot, "runs", runId);
      const runtimePath = crashAt === "after_graph_two_runtime_publication"
        ? join(runDir, "artifacts/runtime/planner-graph-2.json")
        : join(runDir, "artifacts/runtime/verifier-1.json");
      const runtimeBefore = readFileSync(runtimePath, "utf8");
      const executionSequence = runtime.executionSequence;
      const before = JSON.parse(readFileSync(join(runDir, "run.json")));
      const resumed = await resumeRun(runDir, { workspace, runtime });
      const after = JSON.parse(readFileSync(join(runDir, "run.json")));
      const expectedEvent = crashAt === "after_graph_two_runtime_publication"
        ? "graph_revision_2_admitted" : "review_admitted";
      assert.deepEqual(
        after.transitions.slice(before.transitions.length).map(({ event_kind }) => event_kind),
        [expectedEvent],
        crashAt,
      );
      assert.equal(runtime.executionSequence, executionSequence, `${crashAt}: replay must not execute again`);
      assert.equal(readFileSync(runtimePath, "utf8"), runtimeBefore, `${crashAt}: Runtime Observation is immutable`);
      assert.equal(resumed.lifecycle_state, "active", crashAt);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
});

test("prepared Review replay admits one action before Promotion and Receipt", async () => {
  const { workspace, runRoot } = fixture();
  try {
    let runtime;
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => {
        runtime = new Runtime(options);
        return runtime;
      },
      hooks: { crashAt: "after_review_publication" },
    }), /simulated process death/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    const statePath = join(runDir, "run.json");
    const promotionPath = join(runDir, "artifacts/promotions/promotion-1.json");
    const receiptPath = join(runDir, "artifacts/outcomes/0001.json");

    const beforeReview = JSON.parse(readFileSync(statePath));
    const reviewStep = await resumeRun(runDir, { workspace, runtime });
    const afterReview = JSON.parse(readFileSync(statePath));
    assert.deepEqual(afterReview.transitions.slice(beforeReview.transitions.length).map(({ event_kind }) => event_kind), ["review_admitted"]);
    assert.equal(reviewStep.lifecycle_state, "active");
    assert.equal(existsSync(promotionPath), false);
    assert.equal(existsSync(receiptPath), false);

    const stateBeforePromotion = readFileSync(statePath, "utf8");
    const promotionStep = await resumeRun(runDir, { workspace, runtime });
    assert.equal(promotionStep.checkpoint, "promotion_prepared");
    assert.equal(readFileSync(statePath, "utf8"), stateBeforePromotion);
    assert.equal(existsSync(promotionPath), true);
    assert.equal(existsSync(receiptPath), false);

    const stateBeforeCas = readFileSync(statePath, "utf8");
    const casStep = await resumeRun(runDir, { workspace, runtime });
    assert.equal(casStep.checkpoint, "result_ref_promoted");
    assert.equal(readFileSync(statePath, "utf8"), stateBeforeCas);
    assert.equal(existsSync(receiptPath), false);

    const beforeReceipt = JSON.parse(readFileSync(statePath));
    const receiptStep = await resumeRun(runDir, { workspace, runtime });
    const afterReceipt = JSON.parse(readFileSync(statePath));
    assert.deepEqual(afterReceipt.transitions.slice(beforeReceipt.transitions.length).map(({ event_kind }) => event_kind), ["receipt_admitted"]);
    assert.equal(receiptStep.lifecycle_state, "completed");
    assert.equal(existsSync(receiptPath), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("recoverable provider failure is a typed durable checkpoint and resumes without duplicate artifacts", async () => {
  const { workspace, runRoot } = fixture();
  try {
    let runtime;
    let failProvider = true;
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => {
        runtime = new Runtime(options);
        const execute = runtime.execute.bind(runtime);
        runtime.execute = async (execution) => {
          if (failProvider && execution.attemptId === "planner-graph-2") {
            failProvider = false;
            throw Object.assign(new Error("provider temporarily unavailable"), { code: "provider_unavailable" });
          }
          return execute(execution);
        };
        return runtime;
      },
      hooks: { crashAt: "after_result_publication" },
    }), /simulated process death/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    await resumeRun(runDir, { workspace, runtime });
    await resumeRun(runDir, { workspace, runtime });
    const executionSequence = runtime.executionSequence;
    const blocked = await resumeRun(runDir, { workspace, runtime });
    assert.equal(blocked.lifecycle_state, "blocked");
    assert.equal(blocked.checkpoint, "runtime_provider_failure");
    const failurePath = join(runDir, "artifacts/outcomes/failure.json");
    const failureBefore = readFileSync(failurePath, "utf8");
    assert.equal(JSON.parse(failureBefore).block_type, "runtime_provider_failure");
    assert.equal(existsSync(join(runDir, "artifacts/runtime/planner-graph-2.json")), false);
    assert.equal(existsSync(join(runDir, "artifacts/graphs/0002.json")), false);

    const recovered = await resumeRun(runDir, { workspace, runtime });
    assert.equal(recovered.checkpoint, "graph_revision_2_admitted");
    assert.equal(runtime.executionSequence, executionSequence + 1);
    assert.equal(readFileSync(failurePath, "utf8"), failureBefore);
    assert.equal(existsSync(join(runDir, "artifacts/runtime/planner-graph-2.json")), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("public CLI provider failure is durable and the next public resumes continue", async () => {
  const { workspace, runRoot } = fixture();
  const fakeBin = mkdtempSync(join(tmpdir(), "m2-provider-bin-"));
  try {
    let runtime;
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => {
        runtime = new Runtime(options);
        return runtime;
      },
      hooks: { crashAt: "after_result_publication" },
    }), /simulated process death/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    assert.equal(cliResume(workspace, runRoot, runId).checkpoint, "implementation_result_admitted");

    const providerState = join(fakeBin, "provider-state.json");
    writeFileSync(providerState, "0\n");
    const fakeOpencode = join(fakeBin, "opencode");
    writeFileSync(fakeOpencode, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const statePath = process.env.M2_FAKE_PROVIDER_STATE;
const readCount = () => {
  try { return Number(readFileSync(statePath, "utf8")); } catch { return 0; }
};
const writeCount = (count) => writeFileSync(statePath, String(count));
const send = (response, status, body) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
};
const readBody = (request) => new Promise((resolve) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => resolve(raw.length === 0 ? {} : JSON.parse(raw)));
});

if (args[0] === "--version") {
  process.stdout.write("m2-fake-opencode\\n");
} else if (args[0] === "debug") {
  process.stdout.write(JSON.stringify({ instructions: [], plugin: [], mcp: {}, agent: {}, command: {}, provider: {} }) + "\\n");
} else if (args[0] === "serve") {
  const sessions = new Map();
  let nextSession = 1;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/global/health") return send(response, 200, { healthy: true, version: "m2-fake-opencode" });
    if (url.pathname === "/agent") return send(response, 200, ["planner", "worker", "verifier"].map((role) => ({ name: "m1-" + role, model: { providerID: "fake", modelID: "model" } })));
    if (url.pathname === "/event") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream");
      response.write(": ready\\n\\n");
      return;
    }
    if (request.method === "POST" && url.pathname === "/session") {
      return send(response, 200, { id: "session-" + nextSession++ });
    }
    if (request.method === "GET" && url.pathname === "/session/status") {
      return send(response, 200, Object.fromEntries([...sessions.keys()].map((id) => [id, { type: "idle" }])));
    }
    const sessionMatch = url.pathname.match(/^\\/session\\/([^/]+)\\/message$/);
    if (sessionMatch && request.method === "GET") {
      const message = sessions.get(sessionMatch[1]);
      return send(response, 200, message ? [message] : []);
    }
    if (sessionMatch && request.method === "POST") {
      const payload = await readBody(request);
      const prompt = payload.parts?.[0]?.text ?? "";
      const count = readCount();
      if (count === 0) {
        writeCount(1);
        return send(response, 503, { error: "temporary provider failure" });
      }
      writeCount(count + 1);
      const text = prompt.includes("graph revision 2")
        ? JSON.stringify({ carry_forward_task_id: "implementation-1", verifier_task: { task_id: "verification-1", workflow_definition: "verification", requires: ["implementation-1"], read_resources: ["change.txt"], write_resources: [] }, verifier_packet: { objective: "verify", acceptance_criteria: ["target matches"], allowed_resources: ["change.txt"], forbidden_resources: [".git"], capabilities: ["repository_read"], admitted_commands: [], deadline_seconds: 3, escalation_condition: "mismatch" } })
        : JSON.stringify({ verdict: "pass", findings: [], evidence: [{ claim: "the target matches", source: "verifier-read", observation: "the target bytes match" }] });
      const message = { info: { id: "fake-message-" + count }, parts: [{ type: "text", text }] };
      sessions.set(sessionMatch[1], message);
      return send(response, 200, message);
    }
    return send(response, 404, { error: "not found" });
  });
  const port = Number(args[args.indexOf("--port") + 1]);
  server.listen(port, "127.0.0.1");
}
`);
    chmodSync(fakeOpencode, 0o755);
    const env = {
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      M2_FAKE_PROVIDER_STATE: providerState,
    };
    const prepared = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(prepared.checkpoint, "runtime_dispatch_prepared");
    const failed = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(failed.lifecycle_state, "blocked");
    assert.equal(failed.checkpoint, "runtime_provider_failure");
    const failurePath = join(runDir, "artifacts/outcomes/failure.json");
    const failureBefore = readFileSync(failurePath, "utf8");
    assert.equal(JSON.parse(failureBefore).block_type, "runtime_provider_failure");
    const runtimeBefore = readdirSync(join(runDir, "artifacts/runtime")).sort();
    assert.equal(existsSync(join(runDir, "artifacts/graphs/0002.json")), false);

    let resumed = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(resumed.checkpoint, "graph_revision_2_admitted");
    resumed = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(resumed.checkpoint, "verification_dispatched");
    resumed = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(resumed.checkpoint, "review_admitted");
    resumed = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(resumed.checkpoint, "promotion_prepared");
    resumed = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(resumed.checkpoint, "result_ref_promoted");
    resumed = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(resumed.lifecycle_state, "completed");
    assert.equal(readFileSync(failurePath, "utf8"), failureBefore);
    assert.deepEqual(readdirSync(join(runDir, "artifacts/runtime")).filter((path) => runtimeBefore.includes(path)), runtimeBefore);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("public resume reuses a durable planner binding after an accepted message loses its response", async () => {
  const { workspace, runRoot } = fixture();
  const fakeBin = mkdtempSync(join(tmpdir(), "m2-ambiguous-provider-bin-"));
  try {
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime(options),
      hooks: { crashAt: "after_result_publication" },
    }), /simulated process death/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    assert.equal(cliResume(workspace, runRoot, runId).checkpoint, "implementation_result_admitted");

    const providerState = join(fakeBin, "provider-state.json");
    writeFileSync(providerState, JSON.stringify({
      nextSession: 1,
      messagePosts: 0,
      ambiguousOnce: true,
      sessions: {},
    }));
    const fakeOpencode = join(fakeBin, "opencode");
    writeFileSync(fakeOpencode, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const statePath = process.env.M2_AMBIGUOUS_PROVIDER_STATE;
const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
const writeState = (state) => writeFileSync(statePath, JSON.stringify(state));
const send = (response, status, body) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
};
const readBody = (request) => new Promise((resolve) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => resolve(raw.length === 0 ? {} : JSON.parse(raw)));
});

if (args[0] === "--version") {
  process.stdout.write("m2-ambiguous-opencode\\n");
} else if (args[0] === "debug") {
  process.stdout.write(JSON.stringify({ instructions: [], plugin: [], mcp: {}, agent: {}, command: {}, provider: {} }) + "\\n");
} else if (args[0] === "serve") {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/global/health") return send(response, 200, { healthy: true, version: "m2-ambiguous-opencode" });
    if (url.pathname === "/agent") return send(response, 200, ["planner", "worker", "verifier"].map((role) => ({ name: "m1-" + role, model: { providerID: "fake", modelID: "model" } })));
    if (url.pathname === "/event") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream");
      response.write(": ready\\n\\n");
      return;
    }
    if (request.method === "POST" && url.pathname === "/session") {
      const state = readState();
      const id = "session-" + state.nextSession;
      writeState({ ...state, nextSession: state.nextSession + 1, sessions: { ...state.sessions, [id]: null } });
      return send(response, 200, { id });
    }
    if (request.method === "GET" && url.pathname === "/session/status") {
      return send(response, 200, Object.fromEntries(Object.keys(readState().sessions).map((id) => [id, { type: "idle" }])));
    }
    const sessionMatch = url.pathname.match(/^\\/session\\/([^/]+)\\/message$/);
    if (sessionMatch && request.method === "GET") {
      const message = readState().sessions[sessionMatch[1]];
      return send(response, 200, message ? [message] : []);
    }
    if (sessionMatch && request.method === "POST") {
      const payload = await readBody(request);
      const prompt = payload.parts?.[0]?.text ?? "";
      const state = readState();
      const messagePosts = state.messagePosts + 1;
      const text = prompt.includes("graph revision 2")
        ? JSON.stringify({ carry_forward_task_id: "implementation-1", verifier_task: { task_id: "verification-1", workflow_definition: "verification", requires: ["implementation-1"], read_resources: ["change.txt"], write_resources: [] }, verifier_packet: { objective: "verify", acceptance_criteria: ["target matches"], allowed_resources: ["change.txt"], forbidden_resources: [".git"], capabilities: ["repository_read"], admitted_commands: [], deadline_seconds: 3, escalation_condition: "mismatch" } })
        : JSON.stringify({ verdict: "pass", findings: [], evidence: [{ claim: "the target matches", source: "verifier-read", observation: "the target bytes match" }] });
      const message = { info: { id: "ambiguous-message-" + messagePosts, role: "assistant" }, parts: [{ type: "text", text }] };
      writeState({ ...state, messagePosts, ambiguousOnce: false, sessions: { ...state.sessions, [sessionMatch[1]]: message } });
      if (state.ambiguousOnce) {
        request.socket.destroy();
        return;
      }
      return send(response, 200, message);
    }
    return send(response, 404, { error: "not found" });
  });
  const port = Number(args[args.indexOf("--port") + 1]);
  server.listen(port, "127.0.0.1");
}
`);
    chmodSync(fakeOpencode, 0o755);
    const env = {
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      M2_AMBIGUOUS_PROVIDER_STATE: providerState,
    };
    const prepared = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(prepared.checkpoint, "runtime_dispatch_prepared");
    assert.equal(JSON.parse(readFileSync(providerState)).messagePosts, 0);
    const preparedState = JSON.parse(readFileSync(join(runDir, "run.json")));
    assert.equal(preparedState.runtime_bindings.find(({ attempt_id }) => attempt_id === "planner-graph-2")?.session_id, "session-1");
    const failed = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(failed.lifecycle_state, "blocked");
    assert.equal(failed.checkpoint, "runtime_provider_failure");
    const stateAfterFailure = JSON.parse(readFileSync(join(runDir, "run.json")));
    const binding = stateAfterFailure.runtime_bindings.find(({ attempt_id }) => attempt_id === "planner-graph-2");
    assert.equal(binding?.session_id, "session-1");
    const acceptedState = JSON.parse(readFileSync(providerState));
    assert.equal(acceptedState.messagePosts, 1);

    writeFileSync(providerState, JSON.stringify({ ...acceptedState, sessions: {} }));
    const unresolved = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(unresolved.lifecycle_state, "blocked");
    assert.equal(unresolved.checkpoint, "runtime_reconciliation_required");
    assert.equal(JSON.parse(readFileSync(providerState)).messagePosts, 1);
    writeFileSync(providerState, JSON.stringify(acceptedState));

    const reconciled = cliResumeWithEnv(workspace, runRoot, runId, env);
    assert.equal(reconciled.checkpoint, "graph_revision_2_admitted");
    assert.equal(JSON.parse(readFileSync(providerState)).messagePosts, 1);
    assert.equal(JSON.parse(readFileSync(join(runDir, "run.json"))).runtime_bindings.filter(({ attempt_id }) => attempt_id === "planner-graph-2").length, 1);
    assert.equal(cliResumeWithEnv(workspace, runRoot, runId, env).checkpoint, "verification_dispatched");
    assert.equal(cliResumeWithEnv(workspace, runRoot, runId, env).checkpoint, "review_admitted");
    assert.equal(cliResumeWithEnv(workspace, runRoot, runId, env).checkpoint, "promotion_prepared");
    assert.equal(cliResumeWithEnv(workspace, runRoot, runId, env).checkpoint, "result_ref_promoted");
    assert.equal(cliResumeWithEnv(workspace, runRoot, runId, env).lifecycle_state, "completed");
    assert.equal(JSON.parse(readFileSync(providerState)).messagePosts, 2);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("runtime-abort crash boundaries preserve cancellation intent and forbid resume dispatch", async () => {
  for (const crashAt of ["before_runtime_abort", "after_runtime_abort"]) {
    const { workspace, runRoot } = fixture();
    try {
      await assert.rejects(() => runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => {
          const runtime = new Runtime(options);
          runtime.cancelConfirmed = true;
          return runtime;
        },
        hooks: {
          afterWorkerDispatch: async ({ runDir, adapter }) => {
            await cancelRun(runDir, { runtime: adapter, hooks: { crashAt } });
          },
        },
      }), /simulated process death/);
      const runId = readdirSync(join(runRoot, "runs"))[0];
      const runDir = join(runRoot, "runs", runId);
      const state = JSON.parse(readFileSync(join(runDir, "run.json")));
      assert.equal(state.lifecycle_state, "cancelling", crashAt);
      assert.equal(state.transitions.at(-1).event_kind, "cancel_requested", crashAt);
      const resumed = JSON.parse(execFileSync(process.execPath, [
        "scripts/local-change.mjs", "resume", "--workspace", workspace,
        "--run-root", runRoot, "--run-id", runId,
      ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
      assert.equal(resumed.lifecycle_state, "blocked", crashAt);
      assert.equal(resumed.checkpoint, "cancel_unconfirmed", crashAt);
      assert.equal(JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/cancel.json"))).block_type, "cancel_unconfirmed", crashAt);
      assert.equal(resumed.next_action, null, crashAt);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
});

test("resume reconciles a cancelling Run through the durable runtime binding seam", async () => {
  const { workspace, runRoot } = fixture();
  try {
    let runtime;
    const crash = new Error("simulated process death");
    crash.code = "simulated_crash";
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => {
        runtime = new Runtime(options);
        runtime.cancelConfirmed = true;
        return runtime;
      },
      hooks: {
        afterWorkerDispatch: async ({ runDir, adapter }) => {
          await cancelRun(runDir, { runtime: adapter, hooks: { crashAt: "before_runtime_abort" } });
        },
      },
    }), /simulated process death/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    const resumed = await resumeRun(runDir, { runtime });
    assert.equal(resumed.lifecycle_state, "cancelled");
    const state = JSON.parse(readFileSync(join(runDir, "run.json")));
    assert.deepEqual(state.transitions.slice(-2).map(({ event_kind }) => event_kind), [
      "cancel_requested",
      "cancel_confirmed",
    ]);
    assert.equal(state.runtime_bindings.at(-1).binding_state, "cancelled");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("resume reconnects a cancel_unconfirmed Run without dispatching a successor", async () => {
  const { workspace, runRoot } = fixture();
  try {
    let runtime;
    const crash = new Error("simulated process death");
    crash.code = "simulated_crash";
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => {
        runtime = new Runtime(options);
        runtime.cancelConfirmed = true;
        return runtime;
      },
      hooks: { afterWorkerDispatch: async () => { throw crash; } },
    }), /simulated process death/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    const blocked = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "cancel", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", runId,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(blocked.lifecycle_state, "blocked");
    const before = JSON.parse(readFileSync(join(runDir, "run.json")));
    const resumed = await resumeRun(runDir, { runtime });
    assert.equal(resumed.lifecycle_state, "cancelled");
    const after = JSON.parse(readFileSync(join(runDir, "run.json")));
    assert.equal(after.transitions.some(({ event_kind }) => event_kind === "successor_dispatched"), false);
    assert.equal(after.runtime_bindings.at(-1).binding_state, "cancelled");
    assert.equal(after.transitions.length, before.transitions.length + 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("cumulative Run limit exhaustion is a typed block", async () => {
  const { workspace, runRoot } = fixture();
  try {
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime(options),
      budgetOverride: { max_execution_attempts: 1 },
    }), /execution_attempt budget exhausted/);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const runDir = join(runRoot, "runs", runId);
    const state = JSON.parse(readFileSync(join(runDir, "run.json")));
    const block = JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/failure.json")));
    assert.equal(state.lifecycle_state, "blocked");
    assert.equal(block.outcome_kind, "block");
    assert.equal(block.block_type, "budget_exceeded");
    assert.match(block.summary, /execution_attempt budget exhausted/);
    assert.equal(existsSync(join(runDir, "artifacts/promotions")), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("paired low-risk ambiguity records an Assumption and continues", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const run = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime({ ...options, scenario: "low-risk" }),
    });
    const state = JSON.parse(readFileSync(join(run.run_dir, "run.json")));
    const request = JSON.parse(readFileSync(join(run.run_dir, "artifacts/request.json")));
    assert.equal(state.lifecycle_state, "completed");
    assert.equal(request.ambiguities.length, 2);
    assert.equal(request.assumptions.length, 1);
    assert.match(request.assumptions[0], /low-risk|reversible/i);
    assert.equal(existsSync(join(run.run_dir, "artifacts/outcomes/0001.json")), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("worker Result fields are authored by the worker proposal", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const run = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime({ ...options, scenario: "worker-proposal" }),
    });
    const state = JSON.parse(readFileSync(join(run.run_dir, "run.json")));
    const result = JSON.parse(readFileSync(join(run.run_dir, state.tasks["implementation-1"].artifact_ref.path)));
    assert.deepEqual(result.claims, ["worker-authored claim"]);
    assert.deepEqual(result.changed_resources, ["change.txt"]);
    assert.equal(result.evidence[0].source, "worker-report");
    const workerRuntime = JSON.parse(readFileSync(join(run.run_dir, result.runtime_ref.path)));
    assert.equal(result.output_snapshot, workerRuntime.observed_output_snapshot);
    assert.equal(result.evidence.some(({ source }) => source.startsWith("command:")), false);
    const editRuntimePath = join(run.run_dir, "artifacts/runtime/worker-implementation-1-edit.json");
    assert.equal(existsSync(editRuntimePath), true);
    const editRuntime = JSON.parse(readFileSync(editRuntimePath, "utf8"));
    assert.equal(editRuntime.producer.role, "runtime");
    assert.equal(editRuntime.attempt_id, workerRuntime.attempt_id);
    assert.equal(editRuntime.session_id, workerRuntime.session_id);
    assert.equal(editRuntime.agent_identity, workerRuntime.agent_identity);
    assert.notEqual(editRuntime.artifact_id, workerRuntime.artifact_id);
    assert.notDeepEqual(editRuntime.message_ids, workerRuntime.message_ids);
    assert.notDeepEqual(editRuntime.runtime_permission_events, workerRuntime.runtime_permission_events);
    assert.equal(result.input_refs.some(({ path }) => path === "artifacts/runtime/worker-implementation-1-edit.json"), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("worker Result without a claimed Output Snapshot is rejected", async () => {
  const { workspace, runRoot } = fixture();
  try {
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime({ ...options, scenario: "worker-missing-output-snapshot" }),
    }), /output_snapshot|Output Snapshot/i);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("worker Result rejects object-valued claims instead of coercing them", async () => {
  const { workspace, runRoot } = fixture();
  try {
    await assert.rejects(() => runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime({ ...options, scenario: "worker-invalid-proposal" }),
    }), /worker Result claims must contain strings/i);
    const runId = readdirSync(join(runRoot, "runs"))[0];
    const failure = JSON.parse(readFileSync(join(runRoot, "runs", runId, "artifacts/outcomes/failure.json")));
    assert.match(failure.summary, /worker Result claims must contain strings/i);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("Material Decision Request survives restart and admits exactly one human successor", async () => {
  const { workspace, runRoot } = fixture();
  try {
    let runtime;
    const run = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Please update the file using the bounded local workflow.",
      runtimeFactory: (options) => {
        runtime = new Runtime({ ...options, scenario: "material" });
        return runtime;
      },
    });
    const runDir = run.run_dir;
    const requestOutcome = JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/0001.json")));
    assert.equal(requestOutcome.outcome_kind, "material_decision_request");
    assert.equal(runtime.sequence, 1);
    assert.equal(existsSync(join(runDir, "artifacts/graphs/0001.json")), false);
    assert.equal(existsSync(join(runDir, "artifacts/promotions/promotion-1.json")), false);
    const checkpoint = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "resume", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(checkpoint.lifecycle_state, "material_decision_required");

    const resumed = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "resume", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
      "--decision", "Use the bounded harness-owned Result Ref.",
      "--decision-disposition", "accepted",
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(resumed.lifecycle_state, "completed");
    const decisionRoot = join(runDir, "artifacts/decisions");
    const decisions = readdirSync(decisionRoot).flatMap((id) => readdirSync(join(decisionRoot, id)));
    assert.deepEqual(decisions, ["0001.json"]);
    const decision = JSON.parse(readFileSync(join(decisionRoot, readdirSync(decisionRoot)[0], "0001.json")));
    assert.equal(decision.producer.role, "human");
    assert.equal(decision.disposition, "accepted");

    const stateBeforeRepeat = readFileSync(join(runDir, "run.json"), "utf8");
    const repeated = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "resume", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
      "--decision", "A different answer must not create another successor.",
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(repeated.lifecycle_state, "completed");
    assert.equal(readFileSync(join(runDir, "run.json"), "utf8"), stateBeforeRepeat);
    assert.equal(readdirSync(join(runDir, "artifacts/decisions", readdirSync(decisionRoot)[0])).length, 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("explicitly rejected Decision is durable and never promotes", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const run = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Please update the file using the bounded local workflow.",
      runtimeFactory: (options) => new Runtime({ ...options, scenario: "material" }),
    });
    const rejected = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "resume", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
      "--decision", "Do not admit this Promotion.",
      "--decision-disposition", "rejected",
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(rejected.lifecycle_state, "material_decision_required");
    assert.equal(existsSync(join(run.run_dir, "artifacts/outcomes/0002.json")), false);
    assert.throws(() => git(join(run.run_dir, "result-repository.git"), [
      "rev-parse", "--verify", `refs/orchestrator/results/${run.run_id}`,
    ]));
    const decisionRoot = join(run.run_dir, "artifacts/decisions/decision-1");
    const rejectedDecision = JSON.parse(readFileSync(join(decisionRoot, "0001.json")));
    assert.equal(rejectedDecision.disposition, "rejected");

    const accepted = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "resume", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
      "--decision", "Use the bounded harness-owned Result Ref.",
      "--decision-disposition", "accepted",
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(accepted.lifecycle_state, "completed");
    const acceptedDecision = JSON.parse(readFileSync(join(decisionRoot, "0002.json")));
    assert.equal(acceptedDecision.disposition, "accepted");
    assert.equal(acceptedDecision.supersedes.artifact_id, rejectedDecision.artifact_id);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("Receipt after Decision restart includes the accepted Decision reference", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const run = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Please update the file using the bounded local workflow.",
      runtimeFactory: (options) => new Runtime({ ...options, scenario: "material" }),
    });
    const interrupted = await resumeRun(run.run_dir, {
      decision: "Use the bounded harness-owned Result Ref.",
      decisionDisposition: "accepted",
      hooks: { crashAt: "after_run_state_replacement:material_decision_accepted" },
    });
    assert.equal(interrupted.checkpoint, "simulated_crash");

    const resumed = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "resume", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(resumed.lifecycle_state, "completed");
    const state = JSON.parse(readFileSync(join(run.run_dir, "run.json")));
    const receipt = JSON.parse(readFileSync(join(run.run_dir, "artifacts/outcomes/0002.json")));
    assert.equal(state.decision_refs.length, 1);
    assert.equal(receipt.artifact_refs.some((ref) => ref.digest === state.decision_refs[0].digest), true);
    assert.equal(receipt.input_refs.some((ref) => ref.digest === state.decision_refs[0].digest), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  }
});
