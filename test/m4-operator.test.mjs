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
import test from "node:test";
import {
  invokeOperator,
  operator,
  preflight,
} from "../bin/opencode-orchestrator.mjs";
import { digest, workspaceSnapshot } from "../scripts/local-change.mjs";

const repository = new URL("..", import.meta.url);
const repositoryPath = repository.pathname.replace(/\/$/, "");
const cleanEnvNames = [
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "OPENCODE_DISABLE_CLAUDE_CODE",
  "OPENCODE_DISABLE_DEFAULT_PLUGINS",
  "OPENCODE_DISABLE_MODELS_FETCH",
];

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function withCleanLauncherEnvironment(callback) {
  const saved = Object.fromEntries(cleanEnvNames.map((name) => [name, process.env[name]]));
  for (const name of cleanEnvNames) delete process.env[name];
  try {
    return await callback();
  } finally {
    for (const name of cleanEnvNames) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

function emptyPaths(prefix = "issue36") {
  return {
    target: mkdtempSync(join(tmpdir(), `${prefix}-target-`)),
    runRoot: mkdtempSync(join(tmpdir(), `${prefix}-runs-`)),
  };
}

function gitFixture() {
  const paths = emptyPaths("issue36-provider");
  git(paths.target, ["init", "-q", "-b", "main"]);
  git(paths.target, ["config", "user.email", "issue36@example.invalid"]);
  git(paths.target, ["config", "user.name", "Issue 36"]);
  writeFileSync(join(paths.target, "base.txt"), "base\n");
  mkdirSync(join(paths.target, ".opencode/skills/m1-local-change"), { recursive: true });
  writeFileSync(join(paths.target, ".opencode/skills/m1-local-change/SKILL.md"), "---\nname: m1-local-change\nversion: 1\n---\n");
  git(paths.target, ["add", "."]);
  git(paths.target, ["commit", "-qm", "fixture"]);
  return paths;
}

class DeterministicProvider {
  constructor(options) {
    Object.assign(this, options);
    this.configurationDigest = digest("issue36-provider-config");
    this.attemptDeadlineSeconds = 3;
    this.sessionNumber = 0;
    this.executionNumber = 0;
    this.workerProposalPublished = false;
  }

  async start() {}

  async stop() {}

  async newAttempt({ role, attemptId, taskId, attempt }) {
    this.sessionNumber += 1;
    const binding = {
      attempt_id: attemptId,
      ...(taskId ? { task_id: taskId } : {}),
      attempt,
      session_id: `issue36-session-${this.sessionNumber}`,
      role,
      agent_identity: digest(`issue36-${role}`),
      agent: `issue36-${role}`,
      model: "fixture/provider",
      configuration_digest: this.configurationDigest,
      binding_state: "active",
    };
    return { binding };
  }

  observation({ attemptId, role, binding, snapshot, taskId, attempt }) {
    return {
      schema_version: "1.0",
      kind: "runtime_observation",
      artifact_id: `runtime-${attemptId}`,
      run_id: this.runId,
      producer: { role: "runtime", actor_id: "issue36-provider" },
      input_refs: [],
      created_at: "2026-08-12T00:00:00.000Z",
      attempt_id: attemptId,
      ...(taskId ? { task_id: taskId } : {}),
      ...(role === "worker" || role === "verifier" ? { attempt } : {}),
      role,
      opencode_version: "fixture-1.18.5",
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
      ...this.observation({ attemptId, role, binding, snapshot: this.baselineSnapshot }),
      artifact_id: artifactId,
    };
  }

  async execute({ role, attemptId, taskId, attempt, binding }) {
    this.executionNumber += 1;
    let text;
    let workerProposal = false;
    if (attemptId === "planner-request") {
      text = JSON.stringify({
        objective: this.requestText,
        scope: [this.targetFile],
        exclusions: ["external effects"],
        ambiguities: [],
        assumptions: [],
        target_snapshot: this.baselineSnapshot.digest,
        preset_selection: {
          preset: "local-change@1",
          selection_evidence: [{ claim: "bounded", source: "fixture-provider", observation: "local" }],
          proposed_narrowing: null,
          rationale: "deterministic fixture",
        },
      });
    } else if (attemptId === "planner-graph-1") {
      text = JSON.stringify({
        graph: { nodes: [{ task_id: "implementation-1", workflow_definition: "implementation" }] },
        packet: { acceptance_criteria: ["target exists"], deadline_seconds: 3 },
      });
    } else if (attemptId === "worker-implementation-1") {
      workerProposal = this.workerProposalPublished;
      if (!workerProposal) {
        writeFileSync(join(this.workspace, this.targetFile), this.expectedContent);
        this.workerProposalPublished = true;
        text = JSON.stringify({ status: "edit complete" });
      } else {
        text = JSON.stringify({
          claims: ["deterministic provider proposal"],
          evidence: [{ claim: "target was written", source: "fixture-provider", observation: "target matches" }],
          changed_resources: [this.targetFile],
        });
      }
    } else if (attemptId === "planner-graph-2") {
      text = JSON.stringify({
        carry_forward_task_id: "implementation-1",
        verifier_task: { task_id: "verification-1" },
        verifier_packet: { acceptance_criteria: ["target matches"], deadline_seconds: 3 },
      });
    } else {
      text = JSON.stringify({
        verdict: "pass",
        findings: [],
        evidence: [{ claim: "target matches", source: "fixture-provider", observation: "target matches" }],
      });
    }
    const snapshot = workspaceSnapshot(this.workspace);
    if (workerProposal) {
      const proposal = JSON.parse(text);
      proposal.output_snapshot = snapshot.digest;
      text = JSON.stringify(proposal);
    }
    return {
      binding: { ...binding, binding_state: "idle" },
      text,
      snapshot,
      observation: this.observation({ attemptId, role, binding, snapshot, taskId, attempt }),
    };
  }
}

async function providerRun() {
  const paths = gitFixture();
  const request = "deterministic provider proposal";
  const beforeTarget = git(paths.target, ["status", "--porcelain=v1", "-z"]);
  const beforeHome = process.env.HOME;
  const result = await withCleanLauncherEnvironment(() => operator.run({
    request,
    target: paths.target,
    runRoot: paths.runRoot,
    runtimeFactory: (options) => new DeterministicProvider(options),
    hooks: {
      commandOverride: () => ({
        command_id: "verify-change",
        argv: ["/usr/bin/true"],
        cwd: ".",
        timeout_seconds: 10,
      }),
    },
  }));
  assert.equal(result.error, undefined, result.error?.message);
  const runId = readdirSync(join(paths.runRoot, "runs"), { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(runId);
  return { ...paths, result, runId, beforeTarget, beforeHome };
}

function disposeFixture({ target, runRoot }) {
  rmSync(target, { recursive: true, force: true });
  rmSync(runRoot, { recursive: true, force: true });
}

test("AC-36-1 launcher enforces absolute paths, isolated env, observed OpenCode identity, and one primary", async () => {
  const paths = emptyPaths("issue36-launcher");
  try {
    await withCleanLauncherEnvironment(async () => {
      assert.throws(
        () => preflight({ target: ".", runRoot: paths.runRoot }),
        (error) => error.type === "invalid_operator_input",
      );
      const result = preflight({ ...paths, checkConfiguration: true });
      assert.equal(typeof result.executable.version, "string");
      assert.ok(result.executable.version.length > 0);
      assert.equal(result.environment.OPENCODE_CONFIG_DIR.endsWith("/opencode"), true);
      assert.equal(result.environment.XDG_CONFIG_HOME, join(paths.runRoot, "operator-runtime/config"));
      assert.equal(result.environment.HOME, join(paths.runRoot, "operator-runtime/home"));
      assert.equal(existsSync(join(paths.runRoot, "runs")), false);
      const agent = readFileSync(join(repositoryPath, "opencode/agents/orchestrator.md"), "utf8");
      assert.match(agent, /tools:\n\s+"\*": false\n\s+orchestrator_operator: true/);
      assert.match(agent, /permission:\n\s+"\*": deny\n\s+orchestrator_operator: allow/);
    });
  } finally {
    disposeFixture(paths);
  }
});

test("AC-36-2 exact #34 bundle tree and manifest digest pass before Run creation", async () => {
  const paths = emptyPaths("issue36-bundle");
  try {
    await withCleanLauncherEnvironment(async () => {
      const result = preflight(paths);
      assert.equal(result.digest, "sha256:b9df2e52912db2991a093ddde5b47bd7d0872fb09a17844d41f25b1041088e3f");
      assert.equal(result.bundleRoot, join(repositoryPath, "opencode"));
      assert.equal(existsSync(join(paths.runRoot, "runs")), false);
    });
  } finally {
    disposeFixture(paths);
  }
});

test("AC-36-3 commands emit only closed action inputs with exact request and Run id transport", () => {
  const commands = {
    orchestrate: ['"action":"run"', '"request":$ARGUMENTS'],
    "orchestrate-status": ['"action":"status"', '"run_id":$ARGUMENTS'],
    "orchestrate-resume": ['"action":"resume"', '"run_id":<run_id>', '"decision":<decision-or-omitted>'],
    "orchestrate-cancel": ['"action":"cancel"', '"run_id":$ARGUMENTS'],
  };
  for (const [name, fragments] of Object.entries(commands)) {
    const source = readFileSync(join(repositoryPath, "opencode/commands", `${name}.md`), "utf8");
    assert.match(source, /agent:\s*orchestrator/);
    assert.match(source, /subtask:\s*false/);
    for (const fragment of fragments) assert.ok(source.includes(fragment), `${name}: ${fragment}`);
  }
  return invokeOperator({ action: "status", run_id: "run-1", request: "forbidden" }).then((result) => {
    assert.equal(result.error.type, "invalid_operator_input");
  });
});

test("AC-36-4 public CLI and native tool use one shared operator module through relative imports", () => {
  assert.deepEqual(Object.keys(operator).sort(), ["cancel", "inspect", "resume", "run"]);
  const packageJson = JSON.parse(readFileSync(join(repositoryPath, "package.json"), "utf8"));
  assert.equal(packageJson.exports, undefined, "the dead ./operator export was removed with the direct relative imports");
  assert.match(readFileSync(join(repositoryPath, "scripts/local-change.mjs"), "utf8"), /import\("\.\.\/bin\/opencode-orchestrator\.mjs"\)/);
  const tool = readFileSync(join(repositoryPath, "opencode/tools/orchestrator_operator.ts"), "utf8");
  assert.match(tool, /from "\.\.\/\.\.\/bin\/opencode-orchestrator\.mjs"/);
  assert.doesNotMatch(tool, /child_process|execFile|spawn|local-change\.mjs/);
});

test("AC-36-5 closed success and error projections retain durable Runtime Binding and file recovery state", async () => {
  const fixture = await providerRun();
  try {
    const successKeys = [
      "schema_version", "action", "run_id", "state_version", "lifecycle_state",
      "checkpoint", "next_action", "runtime_bindings", "active_runtime_bindings", "outcome", "verified_result",
    ];
    assert.deepEqual(Object.keys(fixture.result), successKeys);
    assert.equal(fixture.result.action, "run");
    assert.equal(fixture.result.lifecycle_state, "completed");
    assert.ok(fixture.result.runtime_bindings.length > 0);
    assert.deepEqual(fixture.result.active_runtime_bindings, []);
    const success = await operator.inspect({ target: fixture.target, runRoot: fixture.runRoot, run_id: fixture.runId });
    assert.deepEqual(Object.keys(success), successKeys);
    assert.equal(success.lifecycle_state, "completed");
    assert.ok(success.runtime_bindings.length > 0);
    const state = JSON.parse(readFileSync(join(fixture.runRoot, "runs", fixture.runId, "run.json"), "utf8"));
    assert.equal(state.lifecycle_state, "completed");
    assert.deepEqual(fixture.result.runtime_bindings, state.runtime_bindings);
    assert.deepEqual(success.runtime_bindings, state.runtime_bindings);
    assert.deepEqual(success.active_runtime_bindings, state.runtime_bindings.filter(({ binding_state }) => binding_state === "active"));
    assert.equal(success.outcome.kind, "receipt");
    assert.ok(fixture.result.verified_result);
    assert.ok(success.verified_result);
    const missing = await operator.inspect({ target: fixture.target, runRoot: fixture.runRoot, run_id: "missing" });
    assert.deepEqual(Object.keys(missing), ["schema_version", "action", "run_id", "error"]);
    assert.equal(missing.error.type, "run_not_found");
  } finally {
    disposeFixture(fixture);
  }
});

test("AC-36-6 deterministic provider proposal has native and direct semantic equivalence", async () => {
  const fixture = await providerRun();
  try {
    const context = { target: fixture.target, runRoot: fixture.runRoot };
    const direct = await operator.inspect({ ...context, run_id: fixture.runId });
    const native = await invokeOperator({ action: "status", run_id: fixture.runId }, context);
    assert.deepEqual(native, direct);
    const request = JSON.parse(readFileSync(join(fixture.runRoot, "runs", fixture.runId, "artifacts/request.json"), "utf8"));
    assert.equal(request.objective, "deterministic provider proposal");
    assert.ok(native.verified_result);
  } finally {
    disposeFixture(fixture);
  }
});

test("AC-36-7 malformed, repeated, stale, and conflicting calls leave target and home state unchanged", async () => {
  const fixture = await providerRun();
  const statePath = join(fixture.runRoot, "runs", fixture.runId, "run.json");
  const beforeState = readFileSync(statePath, "utf8");
  try {
    const malformed = await invokeOperator({ action: "status", run_id: fixture.runId, extra: true }, {
      target: fixture.target,
      runRoot: fixture.runRoot,
    });
    assert.equal(malformed.error.type, "invalid_operator_input");
    assert.deepEqual(await invokeOperator({ action: "status", run_id: fixture.runId }, {
      target: fixture.target,
      runRoot: fixture.runRoot,
    }), await invokeOperator({ action: "status", run_id: fixture.runId }, {
      target: fixture.target,
      runRoot: fixture.runRoot,
    }));
    const stale = await invokeOperator({ action: "status", run_id: "stale-run" }, {
      target: fixture.target,
      runRoot: fixture.runRoot,
    });
    assert.equal(stale.error.type, "run_not_found");
    const conflicting = await invokeOperator({ action: "status", run_id: fixture.runId }, {
      target: fixture.target,
      runRoot: join(fixture.target, "nested-run-root"),
    });
    assert.equal(conflicting.error.type, "invalid_operator_input");
    assert.equal(readFileSync(statePath, "utf8"), beforeState);
    assert.equal(git(fixture.target, ["status", "--porcelain=v1", "-z"]), fixture.beforeTarget);
    assert.equal(process.env.HOME, fixture.beforeHome);
  } finally {
    disposeFixture(fixture);
  }
});

test("AC-36-8 focused contract names every criterion and exposes the required verification scripts", () => {
  const source = readFileSync(join(repositoryPath, "test/m4-operator.test.mjs"), "utf8");
  for (let number = 1; number <= 8; number += 1) assert.ok(source.includes(`AC-36-${number}`));
  const packageJson = JSON.parse(readFileSync(join(repositoryPath, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["test:m4-operator"], "node --test test/m4-operator.test.mjs");
  assert.equal(typeof packageJson.scripts["test:m0"], "string");
  assert.equal(typeof packageJson.scripts["test:m1"], "string");
  assert.equal(typeof packageJson.scripts["test:m2"], "string");
  assert.equal(typeof packageJson.scripts["test:m3"], "string");
});
