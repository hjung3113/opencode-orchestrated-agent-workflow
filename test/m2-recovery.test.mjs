import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runLocalChange } from "../scripts/local-change.mjs";
import { digest } from "../scripts/local-change.mjs";

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
      ambiguities: [], assumptions: [], target_snapshot: this.baselineSnapshot.digest,
      preset_selection: { preset: "local-change@1", selection_evidence: [{ claim: "bounded", source: "intake", observation: "local" }], proposed_narrowing: null, rationale: "bounded" },
    });
    else if (attemptId === "planner-graph-1") text = JSON.stringify({ graph: { nodes: [{ task_id: "implementation-1", workflow_definition: "implementation" }] }, packet: { acceptance_criteria: ["target exists"], deadline_seconds: 3 } });
    else if (attemptId === "worker-implementation-1") { writeFileSync(join(this.workspace, this.targetFile), this.expectedContent); text = "implemented"; }
    else if (attemptId === "planner-graph-2") text = JSON.stringify({ carry_forward_task_id: "implementation-1", verifier_task: { task_id: "verification-1" }, verifier_packet: { acceptance_criteria: ["target matches"], deadline_seconds: 3 } });
    else text = JSON.stringify({ verdict: "pass", findings: [], evidence: [{ claim: "matches", source: "verifier-read", observation: "target matches" }] });
    const snapshot = (await import("../scripts/local-change.mjs")).workspaceSnapshot(this.workspace);
    return { binding: { ...binding, binding_state: "idle" }, text, snapshot, observation: this.observation({ attemptId, role, binding, snapshot, taskId, attempt }) };
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
