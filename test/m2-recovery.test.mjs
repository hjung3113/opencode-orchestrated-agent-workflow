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
    else if (attemptId === "worker-implementation-1") { writeFileSync(join(this.workspace, this.targetFile), this.expectedContent); text = "implemented"; }
    else if (attemptId === "planner-graph-2") text = JSON.stringify({ carry_forward_task_id: "implementation-1", verifier_task: { task_id: "verification-1" }, verifier_packet: { acceptance_criteria: ["target matches"], deadline_seconds: 3 } });
    else text = JSON.stringify({ verdict: "pass", findings: [], evidence: [{ claim: "matches", source: "verifier-read", observation: "target matches" }] });
    const snapshot = (await import("../scripts/local-change.mjs")).workspaceSnapshot(this.workspace);
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

test("resume reconstructs a terminal Run idempotently and rejects invalid durable state", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const run = await runLocalChange({ workspace, runRoot, requestText: "Add change.txt.", runtimeFactory: (options) => new Runtime(options) });
    const statePath = join(run.run_dir, "run.json");
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
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
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
      run = resumeRun(runDir);
      assert.equal(run.lifecycle_state, "completed");
      assert.equal(run.next_action, null);
      const before = readFileSync(join(runDir, "run.json"), "utf8");
      assert.equal(resumeRun(runDir).lifecycle_state, "completed");
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
    const resumed = resumeRun(runDir);
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
    "before_run_state_replacement:receipt_admitted",
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
      const first = resumeRun(runDir);
      assert.equal(first.lifecycle_state, "completed", crashAt);
      const stateBeforeRepeat = readFileSync(join(runDir, "run.json"), "utf8");
      const second = resumeRun(runDir);
      assert.equal(second.lifecycle_state, "completed", crashAt);
      assert.equal(readFileSync(join(runDir, "run.json"), "utf8"), stateBeforeRepeat, crashAt);
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
      const resumed = resumeRun(runDir);
      assert.equal(resumed.lifecycle_state, "cancelling", crashAt);
      assert.equal(resumed.next_action, null, crashAt);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
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

test("Material Decision Request survives restart and admits exactly one human successor", async () => {
  const { workspace, runRoot } = fixture();
  try {
    const run = await runLocalChange({
      workspace,
      runRoot,
      requestText: "Add change.txt.",
      runtimeFactory: (options) => new Runtime({ ...options, scenario: "material" }),
    });
    const runDir = run.run_dir;
    const requestOutcome = JSON.parse(readFileSync(join(runDir, "artifacts/outcomes/0001.json")));
    assert.equal(requestOutcome.outcome_kind, "material_decision_request");
    const checkpoint = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "resume", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
    assert.equal(checkpoint.lifecycle_state, "material_decision_required");

    const resumed = JSON.parse(execFileSync(process.execPath, [
      "scripts/local-change.mjs", "resume", "--workspace", workspace,
      "--run-root", runRoot, "--run-id", run.run_id,
      "--decision", "Use the bounded harness-owned Result Ref.",
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
