import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  observation({ attemptId, role, binding, snapshot, taskId, attempt }) {
    return {
      schema_version: "1.0", kind: "runtime_observation", artifact_id: `runtime-${attemptId}`,
      run_id: this.runId, producer: { role: "runtime", actor_id: "m2-runtime" }, input_refs: [],
      created_at: "2026-08-05T00:00:00.000Z", attempt_id: attemptId,
      ...(taskId ? { task_id: taskId } : {}),
      ...(role === "worker" || role === "verifier" ? { attempt } : {}),
      role, opencode_version: "fake", configuration_digest: this.configurationDigest,
      session_id: binding.session_id, agent_identity: binding.agent_identity, message_ids: [],
      agent: binding.agent, model: binding.model, runtime_permission_events: [], command_executions: [],
      observed_changes: [], observed_output_snapshot: snapshot.digest, external_reads: [], exit_reason: "idle",
    };
  }
  preflightObservation({ attemptId, role, binding }) {
    return this.observation({ attemptId, role, binding, snapshot: this.baselineSnapshot });
  }
  async execute({ role, attemptId, taskId, attempt, binding, beforeSnapshot }) {
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
    return { binding: { ...binding, binding_state: "idle" }, text, snapshot, observation: this.observation({ attemptId, role, binding, snapshot, taskId, attempt }) };
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

function cliResume(workspace, runRoot, runId, extra = []) {
  return JSON.parse(execFileSync(process.execPath, [
    "scripts/local-change.mjs", "resume", "--workspace", workspace,
    "--run-root", runRoot, "--run-id", runId, ...extra,
  ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
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
      name: "runtime role",
      mutate: ({ result, review }) => { review.runtime_ref = result.runtime_ref; },
      expected: /runtime|independent/i,
    },
    {
      name: "Result snapshot",
      mutate: ({ result }) => { result.output_snapshot = digest("tampered-output-snapshot"); },
      expected: /snapshot|Result/i,
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
      testCase.mutate({ result, review });
      writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
      writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
      const replaceRefs = (value, path, next) => {
        if (Array.isArray(value)) return value.forEach((item) => replaceRefs(item, path, next));
        if (!value || typeof value !== "object") return;
        if (value.reference_kind === "artifact" && value.path === path) {
          Object.assign(value, next);
          return;
        }
        Object.values(value).forEach((item) => replaceRefs(item, path, next));
      };
      replaceRefs(state, resultPath.slice(`${run.run_dir}/`.length), {
        reference_kind: "artifact",
        artifact_id: result.artifact_id,
        path: state.tasks["implementation-1"].artifact_ref.path,
        digest: digest(result),
      });
      replaceRefs(state, reviewPath.slice(`${run.run_dir}/`.length), {
        reference_kind: "artifact",
        artifact_id: review.artifact_id,
        path: state.tasks["verification-1"].artifact_ref.path,
        digest: digest(review),
      });
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
      run = cliResume(workspace, runRoot, runId);
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
    for (const crashAt of [
      "before_promotion_preparation",
      "after_promotion_preparation",
      "before_result_ref_update",
      "after_result_ref_update",
      "after_result_publication",
      "after_review_publication",
      "before_run_state_replacement:receipt_admitted",
      "after_run_state_replacement:receipt_admitted",
  ]) {
    const { workspace, runRoot } = fixture();
    try {
      await assert.rejects(() => runLocalChange({
        workspace,
        runRoot,
        requestText: "Add change.txt.",
        runtimeFactory: (options) => new Runtime(options),
        hooks: { crashAt },
      }), /simulated process death/);
      const runId = readdirSync(join(runRoot, "runs"))[0];
      const runDir = join(runRoot, "runs", runId);
      const first = cliResume(workspace, runRoot, runId);
      if (crashAt === "after_result_publication") {
        assert.equal(first.lifecycle_state, "completed", crashAt);
        const reconciled = JSON.parse(readFileSync(join(runDir, "run.json")));
        assert.equal(reconciled.tasks["implementation-1"].task_state, "artifacts_published", crashAt);
        assert.ok(reconciled.tasks["implementation-1"].artifact_ref, crashAt);
        assert.equal(reconciled.tasks["verification-1"].task_state, "artifacts_published", crashAt);
        assert.ok(reconciled.tasks["verification-1"].artifact_ref, crashAt);
        assert.equal(existsSync(join(runDir, "artifacts/graphs/0002.json")), true, crashAt);
        assert.equal(existsSync(join(runDir, "artifacts/outcomes/0001.json")), true, crashAt);
      } else {
        assert.equal(first.lifecycle_state, "completed", crashAt);
      }
      const stateBeforeRepeat = readFileSync(join(runDir, "run.json"), "utf8");
      const second = cliResume(workspace, runRoot, runId);
      assert.equal(second.lifecycle_state, first.lifecycle_state, crashAt);
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
        ? ["review_admitted", "receipt_admitted"]
        : ["graph_revision_2_admitted", "verification_dispatched", "review_admitted", "receipt_admitted"];
      const seen = [];
      for (const expected of expectedActions) {
        const before = JSON.parse(readFileSync(join(runDir, "run.json")));
        const resumed = await resumeRun(runDir, { workspace, runtime });
        const after = JSON.parse(readFileSync(join(runDir, "run.json")));
        const newEvents = after.transitions.slice(before.transitions.length).map(({ event_kind }) => event_kind);
        assert.deepEqual(newEvents, [expected], `${crashAt}: ${expected}`);
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
