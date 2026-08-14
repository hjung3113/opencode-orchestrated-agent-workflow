import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  invokeOperator,
  operator,
  operatorChildEnvironment,
  preflight,
} from "../bin/opencode-orchestrator.mjs";
import {
  commandSpec,
  digest,
  runLocalChange,
  workspaceSnapshot,
} from "../scripts/local-change.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeBinPath = dirname(process.execPath);
const exactRequest = "Add change.txt with the requested local change.";
const generatedDependencyEntries = new Set(["node_modules"]);
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
    ? false : "ZHIPU_API_KEY must be supplied externally for the real-provider Issue #39 gate");
const cleanLauncherVariables = [
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
const acceptedAssets = [
  "opencode/.gitignore",
  "opencode/agents/orchestrator.md",
  "opencode/commands/orchestrate-cancel.md",
  "opencode/commands/orchestrate-resume.md",
  "opencode/commands/orchestrate-status.md",
  "opencode/commands/orchestrate.md",
  "opencode/opencode.json",
  "opencode/tools/orchestrator_operator.ts",
  "opencode/tools/request_route.ts",
  "route-rules/m4@1.json",
  "skills/adapters/ask-matt-advisory@1.mjs",
  "skills/adapters/code-review@1.mjs",
  "skills/adapters/diagnosing-bugs@1.mjs",
  "skills/adapters/implement@1.mjs",
  "skills/adapters/tdd@1.mjs",
  "skills/manifest.v1.json",
  "workflow-agents/planner@1.json",
  "workflow-agents/verifier@1.json",
  "workflow-agents/worker@1.json",
  "workflows/implementation@1.json",
  "workflows/intake@1.json",
  "workflows/repair@1.json",
  "workflows/verification@1.json",
];

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function walkFiles(root, prefix = "") {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) return walkFiles(path, name);
    return [name];
  });
}

function treeDigest(roots) {
  const rows = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      rows.push(`${root}\0missing`);
      continue;
    }
    for (const path of walkFiles(root)) {
      const absolute = join(root, path);
      const stat = lstatSync(absolute);
      if (!stat.isFile()) continue;
      const contentDigest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
      rows.push(`${root}\0${path}\0${stat.mode & 0o777}\0${contentDigest}`);
    }
  }
  return createHash("sha256").update(rows.sort().join("\n")).digest("hex");
}

function developerHomeDigest() {
  const home = process.env.HOME ?? "";
  return treeDigest([
    join(home, ".config/opencode"),
    join(home, ".local/share/opencode"),
    join(home, ".cache/opencode"),
  ]);
}

function targetState(target) {
  return {
    branch: git(target, ["branch", "--show-current"]).trim(),
    head: git(target, ["rev-parse", "HEAD"]).trim(),
    status: git(target, ["status", "--porcelain=v1", "-z"]),
    files: git(target, ["ls-files", "-s"]),
    snapshot: workspaceSnapshot(target).digest,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function jsonArtifacts(root) {
  return walkFiles(root)
    .filter((path) => path.endsWith(".json"))
    .map((path) => ({ path, value: readJson(join(root, path)) }));
}

function dispose(paths) {
  rmSync(paths.target, { recursive: true, force: true });
  rmSync(paths.runRoot, { recursive: true, force: true });
}

const failureEvidenceRunId = `${process.pid}-${randomBytes(4).toString("hex")}`;
const failureTranscriptPath = join(tmpdir(), `issue-39-m4-exit-terminal-${failureEvidenceRunId}.log`);
const failureEvidenceRoot = join(tmpdir(), `issue-39-m4-exit-failure-evidence-${failureEvidenceRunId}`);

function redactCredential(text) {
  const credential = process.env.ZHIPU_API_KEY;
  if (!credential || credential.length === 0) return text;
  return text.split(credential).join("<redacted-credential>");
}

function copyRedacted(source, destination) {
  if (!existsSync(source)) return false;
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, redactCredential(readFileSync(source, "utf8")));
  return true;
}

function preserveFailureEvidence(paths, launched, error) {
  if (!existsSync(paths.runRoot)) return null;
  rmSync(failureEvidenceRoot, { recursive: true, force: true });
  mkdirSync(failureEvidenceRoot, { recursive: true });
  const copied = [];
  const runDir = launched?.runDir ?? runDirs(paths.runRoot)[0];
  if (runDir && existsSync(runDir)) {
    if (copyRedacted(join(runDir, "run.json"), join(failureEvidenceRoot, "run.json"))) copied.push("run.json");
    for (const sub of ["artifacts/outcomes", "artifacts/runtime"]) {
      const directory = join(runDir, sub);
      if (!existsSync(directory)) continue;
      for (const file of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
        if (copyRedacted(join(directory, file), join(failureEvidenceRoot, sub, file))) copied.push(`${sub}/${file}`);
      }
    }
  }
  if (copyRedacted(join(paths.runRoot, "terminal.log"), join(failureEvidenceRoot, "terminal.log"))) {
    copied.push("terminal.log");
  }
  const lifecycleState = launched?.state?.lifecycle_state ?? "unknown";
  const blockType = launched?.state
    ? (jsonArtifacts(launched.runDir).find(({ value }) => value.outcome_kind === "block")?.value?.block_type ?? null)
    : null;
  writeFileSync(join(failureEvidenceRoot, "evidence-index.json"), redactCredential(JSON.stringify({
    schema_version: "1",
    artifact_type: "focused_failure_evidence",
    issue: 39,
    lifecycle_state: lifecycleState,
    block_type: blockType,
    run_dir: runDir ?? null,
    retained_files: copied,
    note: "Diagnostic retention copied before fixture disposal; credential content redacted.",
  }, null, 2)));
  if (copied.length === 0) return null;
  assertNoCredential(failureEvidenceRoot);
  const summary = `[retained non-completed Run evidence at ${failureEvidenceRoot}; lifecycle_state=${lifecycleState}${blockType ? ` block_type=${blockType}` : ""}; files: ${copied.join(", ")}]`;
  if (error instanceof Error) error.message = `${error.message}\n${summary}`;
  return failureEvidenceRoot;
}

function preserveFailureTranscript(paths, error) {
  preserveFailureEvidence(paths, undefined, error);
  const source = join(paths.runRoot, "terminal.log");
  if (!existsSync(source)) return;
  const transcript = redactCredential(readFileSync(source, "utf8"));
  try {
    writeFileSync(failureTranscriptPath, transcript);
  } catch {}
  if (error instanceof Error && transcript) {
    const stripped = transcript.replace(/\x1b\[[0-9?]*[A-Za-z]/g, "").slice(-6000);
    error.message = `${error.message}\n[retained terminal transcript: ${failureTranscriptPath}]\n${stripped}`;
  }
}

function retainNonCompletedRun(paths, launched) {
  const diagnosticPath = preserveFailureEvidence(paths, launched);
  const transcriptSource = join(paths.runRoot, "terminal.log");
  if (existsSync(transcriptSource)) {
    let transcriptWritten = false;
    try {
      writeFileSync(failureTranscriptPath, redactCredential(readFileSync(transcriptSource, "utf8")));
      transcriptWritten = true;
    } catch {}
    if (transcriptWritten) {
      const credential = process.env.ZHIPU_API_KEY;
      if (credential) {
        assert.equal(readFileSync(failureTranscriptPath, "utf8").includes(credential), false,
          "credential persisted in retained terminal transcript");
      }
    }
  }
  return diagnosticPath;
}

async function withEnvironment(values, callback) {
  const names = Object.keys(values);
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await callback();
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

function fixture() {
  const target = mkdtempSync(join(tmpdir(), "m4-exit-target-"));
  const runRoot = mkdtempSync(join(tmpdir(), "m4-exit-runs-"));
  git(target, ["init", "-q", "-b", "main"]);
  git(target, ["config", "user.email", "m4-exit@example.invalid"]);
  git(target, ["config", "user.name", "Issue 39 Exit"]);
  writeFileSync(join(target, "base.txt"), "base\n");
  mkdirSync(join(target, ".opencode/skills/m1-local-change"), { recursive: true });
  writeFileSync(
    join(target, ".opencode/skills/m1-local-change/SKILL.md"),
    "---\nname: m1-local-change\nversion: 1\n---\n",
  );
  git(target, ["add", "."]);
  git(target, ["commit", "-qm", "clean Issue 39 fixture"]);
  return {
    target,
    runRoot,
    beforeTarget: targetState(target),
    beforeHome: developerHomeDigest(),
  };
}

function runDirs(runRoot) {
  const runsRoot = join(runRoot, "runs");
  if (!existsSync(runsRoot)) return [];
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(runsRoot, entry.name));
}

async function waitForRun(runRoot, child, output, timeoutMs = 360_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runDir = runDirs(runRoot)[0];
    if (runDir && existsSync(join(runDir, "run.json"))) {
      const state = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
      if (["completed", "blocked", "cancelled", "material_decision_required"].includes(state.lifecycle_state)) {
        return { runDir, state };
      }
    }
    if (child.exitCode !== null) {
      const terminalPath = join(runRoot, "terminal.log");
      const terminal = existsSync(terminalPath) ? readFileSync(terminalPath, "utf8") : "";
      throw new Error(`launcher exited before a Run was admitted (${child.exitCode}): ${Buffer.concat(output).toString("utf8")}\n${terminal}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  const terminalPath = join(runRoot, "terminal.log");
  const terminal = existsSync(terminalPath) ? readFileSync(terminalPath, "utf8") : "";
  assert.match(terminal, /Call `orchestrator_operator` exactly once/,
    "native typed operator boundary was not observed");
  assert.match(terminal, new RegExp(exactRequest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "exact request was not observed in the native transcript");
  throw new Error(`timed out waiting for a terminal Run under ${runRoot}; native request was admitted to OpenCode but no Kernel Run was created`);
}

async function stopLauncher(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function supportedLauncher({ target, runRoot, request }) {
  assert.ok(process.env.ZHIPU_API_KEY, "ZHIPU_API_KEY must be supplied externally for the real-provider Issue #39 gate");
  assert.ok(observedOpenCodeVersion.length > 0, "the resolved OpenCode runtime identity must be observable");
  const timeoutMs = Number(process.env.M4_EXIT_TIMEOUT_MS ?? "360000");
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0);
  const output = [];
  const env = {
    ...process.env,
    PATH: `${nodeBinPath}:${process.env.PATH ?? ""}`,
    NODE_OPTIONS: "",
    M4_EXIT_TARGET: target,
    M4_EXIT_RUN_ROOT: runRoot,
    M4_EXIT_REQUEST: request,
  };
  for (const name of cleanLauncherVariables) delete env[name];
  const expectScript = `
set target $::env(M4_EXIT_TARGET)
set runRoot $::env(M4_EXIT_RUN_ROOT)
set request $::env(M4_EXIT_REQUEST)
set ::env(PATH) "${nodeBinPath}:$::env(PATH)"
set ::env(NODE_OPTIONS) ""
log_file -a [file join $runRoot terminal.log]
spawn npm run opencode -- --target $target --run-root $runRoot
expect {
  -re {Ask anything} {}
  timeout {exit 125}
  eof {exit 126}
}
after 3000
set timeout 1
send -- "/orchestrate $request"
send -- "\\015"
set deadline [expr {[clock milliseconds] + ${timeoutMs}}]
set runDir ""
set childEof 0
while {[clock milliseconds] < $deadline} {
  set candidates [glob -nocomplain -type d -directory [file join $runRoot runs] *]
  foreach candidate $candidates {
    set statePath [file join $candidate run.json]
    if {![file exists $statePath]} continue
    set handle [open $statePath r]
    set contents [read $handle]
    close $handle
    if {[regexp {"lifecycle_state"\\s*:\\s*"(completed|blocked|cancelled|material_decision_required)"} $contents]} {
      set runDir $candidate
      break
    }
  }
  if {$runDir ne ""} break
  expect {
    -re {.+} {}
    timeout {}
    eof {set childEof 1}
  }
  if {$childEof} break
  after 250
}
if {$runDir eq ""} {
  if {!$childEof} {
    send -- "\\003"
    after 1000
  }
  catch {close}
  catch {wait}
  exit 124
}
send -- "\\003"
after 2000
catch {close}
catch {wait}
exit 0
`;
  const child = spawn("expect", ["-c", expectScript], {
    cwd: repository,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => output.push(chunk));
  let terminal;
  try {
    terminal = await waitForRun(runRoot, child, output, timeoutMs + 5000);
  } catch (error) {
    await stopLauncher(child);
    throw error;
  }
  await once(child, "exit");
  const terminalPath = join(runRoot, "terminal.log");
  return {
    ...terminal,
    output: Buffer.concat(output).toString("utf8"),
    command: "npm run opencode -- --target <absolute-clean-target> --run-root <absolute-run-root>",
    runtime_version: observedOpenCodeVersion,
    terminal_path: terminalPath,
    launcher_exited: child.exitCode !== null,
  };
}

let realRunPromise;

async function realRun() {
  if (!realRunPromise) {
    realRunPromise = (async () => {
      const paths = fixture();
      try {
        const launched = await supportedLauncher({ ...paths, request: exactRequest });
        if (launched.state.lifecycle_state !== "completed") {
          launched.diagnostic_path = retainNonCompletedRun(paths, launched);
        }
        return { ...paths, ...launched };
      } catch (error) {
        preserveFailureTranscript(paths, error);
        dispose(paths);
        throw error;
      }
    })();
  }
  return realRunPromise;
}

test.after(async () => {
  if (realRunPromise) {
    const paths = await realRunPromise.catch(() => null);
    if (paths) dispose(paths);
    else return; // failure evidence was retained on disk for inspection
  }
  rmSync(failureEvidenceRoot, { recursive: true, force: true });
  rmSync(failureTranscriptPath, { force: true });
});

test("retention helper preserves non-completed Run evidence and redacts the external credential", async () => {
  const secret = "test-zhipu-key-value";
  const runRoot = mkdtempSync(join(tmpdir(), "m4-exit-retain-"));
  const runDir = join(runRoot, "runs", "retain-test");
  mkdirSync(join(runDir, "artifacts/outcomes"), { recursive: true });
  mkdirSync(join(runDir, "artifacts/runtime"), { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify({ run_id: "retain-test", lifecycle_state: "blocked" }));
  writeFileSync(join(runDir, "artifacts/outcomes/block.json"), JSON.stringify({ outcome_kind: "block", block_type: "cancel_unconfirmed" }));
  writeFileSync(join(runDir, "artifacts/runtime/obs.json"), JSON.stringify({ observed_output_snapshot: "abc123" }));
  writeFileSync(join(runRoot, "terminal.log"), `native transcript containing ${secret}`);
  try {
    await withEnvironment({ ZHIPU_API_KEY: secret }, async () => {
      const diagnosticPath = retainNonCompletedRun({ runRoot }, { runDir, state: { lifecycle_state: "blocked" } });
      assert.equal(existsSync(join(diagnosticPath, "run.json")), true);
      assert.equal(existsSync(join(diagnosticPath, "artifacts/outcomes/block.json")), true);
      assert.equal(existsSync(join(diagnosticPath, "artifacts/runtime/obs.json")), true);
      assert.equal(existsSync(join(diagnosticPath, "terminal.log")), true);
      assert.equal(readFileSync(join(diagnosticPath, "terminal.log"), "utf8").includes(secret), false);
    });
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("AC-39-1 launcher supplies Node identity and commandSpec does not select the OpenCode executable in the native path", async () => {
  const childEnv = operatorChildEnvironment({
    environment: { PATH: "/sentinel-path", EXISTING: "kept" },
    target: "/sentinel-target",
  });
  assert.equal(childEnv.ORCHESTRATOR_NODE_EXEC, process.execPath);
  assert.equal(childEnv.ORCHESTRATOR_TARGET, "/sentinel-target");
  assert.equal(childEnv.PATH, "/sentinel-path");
  assert.equal(childEnv.EXISTING, "kept");

  const nativeNodeRoot = mkdtempSync(join(tmpdir(), "m4-exit-node-"));
  const nativeNode = join(nativeNodeRoot, "native-node");
  copyFileSync(process.execPath, nativeNode);
  try {
    await withEnvironment({ ORCHESTRATOR_NODE_EXEC: nativeNode }, async () => {
      const spec = commandSpec("target.txt", "expected-content");
      assert.equal(spec.command_id, "verify-change");
      assert.equal(spec.argv[0], nativeNode);
      assert.equal(spec.argv[1], "-e");
      assert.equal(spec.argv[3], "target.txt");
      assert.equal(spec.argv[4], "expected-content");
      assert.notEqual(spec.argv[0], process.execPath);
    });

    await withEnvironment({ ORCHESTRATOR_NODE_EXEC: undefined }, async () => {
      const spec = commandSpec("target.txt", "expected-content");
      assert.equal(spec.argv[0], process.execPath);
    });
  } finally {
    rmSync(nativeNodeRoot, { recursive: true, force: true });
  }
});

test("AC-39-1 supported launcher sends the exact request through native orchestrator_operator into the Kernel", { timeout: 420_000, skip: providerUnavailableSkip }, async () => {
  const launched = await realRun();
  assert.equal(launched.state.lifecycle_state, "completed",
    `${launched.output}\n[retained diagnostic evidence: ${launched.diagnostic_path ?? "<none>"}]`);
  const bootstrap = readJson(join(launched.runDir, "artifacts/bootstrap/bootstrap-1.json"));
  assert.equal(bootstrap.raw_request, exactRequest);
  assert.equal(launched.command, "npm run opencode -- --target <absolute-clean-target> --run-root <absolute-run-root>");
  assert.equal(readJson(join(launched.runDir, "run.json")).admission_state, "admitted");
  assert.equal(launched.runtime_version, observedOpenCodeVersion);
  assert.equal(launched.launcher_exited, true, "fresh-session rows require the original launcher to have exited");
  const terminal = readFileSync(launched.terminal_path, "utf8");
  assert.match(terminal, /Call `orchestrator_operator` exactly once/);
  assert.match(terminal, /Add change\.txt with the requested local change\./);
});

function assertPreserved(paths, label) {
  assert.deepEqual(targetState(paths.target), paths.beforeTarget, `${label}: target branch/status/content changed`);
  assert.equal(developerHomeDigest(), paths.beforeHome, `${label}: developer-home configuration changed`);
}

function assertNoCredential(root) {
  const credential = process.env.ZHIPU_API_KEY;
  if (!credential) return;
  for (const path of walkFiles(root)) {
    const absolute = join(root, path);
    if (!lstatSync(absolute).isFile()) continue;
    assert.equal(readFileSync(absolute).includes(credential), false, `credential persisted in ${path}`);
  }
}

function freshOperator(input, context) {
  const source = [
    "import { pathToFileURL } from 'node:url';",
    "const { invokeOperator } = await import(pathToFileURL(process.env.M4_OPERATOR_MODULE).href);",
    "const input = JSON.parse(process.env.M4_OPERATOR_INPUT);",
    "const context = JSON.parse(process.env.M4_OPERATOR_CONTEXT);",
    "process.stdout.write(JSON.stringify(await invokeOperator(input, context)));",
  ].join("\n");
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${nodeBinPath}:${process.env.PATH ?? ""}`,
      NODE_OPTIONS: "",
      M4_OPERATOR_MODULE: join(repository, "bin/opencode-orchestrator.mjs"),
      M4_OPERATOR_INPUT: JSON.stringify(input),
      M4_OPERATOR_CONTEXT: JSON.stringify(context),
    },
  }));
}

function successEvidence(runDir) {
  const state = readJson(join(runDir, "run.json"));
  const receiptEntry = jsonArtifacts(join(runDir, "artifacts/outcomes"))
    .find(({ value }) => value.outcome_kind === "receipt");
  assert.ok(receiptEntry, "a successful Run must publish an authoritative Receipt");
  const receipt = receiptEntry.value;
  const promotion = readJson(join(runDir, receipt.promotion_ref.path));
  const resultRef = state.tasks["implementation-1"].artifact_ref;
  const reviewRef = state.tasks["verification-1"].artifact_ref;
  const result = readJson(join(runDir, resultRef.path));
  const review = readJson(join(runDir, reviewRef.path));
  const runtime = jsonArtifacts(join(runDir, "artifacts/runtime"));
  const verifierRuntime = runtime.find(({ value }) => value.attempt_id === "verifier-1");
  const workerBinding = state.runtime_bindings.find(({ attempt_id }) => attempt_id === "worker-implementation-1");
  const verifierBinding = state.runtime_bindings.find(({ attempt_id }) => attempt_id === "verifier-1");
  const promotedObjectId = git(join(runDir, "result-repository.git"), ["rev-parse", "--verify", promotion.result_ref]).trim();
  return {
    state,
    receipt,
    promotion,
    result,
    review,
    resultRef,
    reviewRef,
    verifierRuntime: verifierRuntime?.value,
    workerBinding,
    verifierBinding,
    promotedObjectId,
  };
}

function commandOverride({ targetFile, expectedContent }) {
  const script = [
    "const fs=require('node:fs');",
    "const value=fs.readFileSync(process.argv[1],'utf8');",
    "if(value!==process.argv[2])process.exit(1);",
    "process.stdout.write(JSON.stringify({checked:process.argv[1]}));",
  ].join("");
  return {
    command_id: "verify-change",
    argv: [process.execPath, "-e", script, targetFile, expectedContent],
    cwd: ".",
    timeout_seconds: 10,
  };
}

class ExitProvider {
  constructor(options) {
    Object.assign(this, options);
    this.configurationDigest = digest("issue-39-provider-config");
    this.attemptDeadlineSeconds = 3;
    this.sessionNumber = 0;
    this.workerProposalPublished = false;
    this.workerProposalAttempts = 0;
    this.malformedWorkerProposals = options.malformedWorkerProposals ?? 0;
    this.cancelConfirmed = options.cancelConfirmed ?? true;
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
        session_id: `issue-39-session-${this.sessionNumber}`,
        role,
        agent_identity: digest(`issue-39-${role}`),
        agent: `issue-39-${role}`,
        model: "fixture/provider",
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
      producer: { role: "runtime", actor_id: "issue-39-provider" },
      input_refs: [],
      created_at: "2026-08-13T00:00:00.000Z",
      attempt_id: attemptId,
      ...(taskId ? { task_id: taskId } : {}),
      ...(role === "worker" || role === "verifier" ? { attempt } : {}),
      role,
      opencode_version: "fixture-provider",
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
    return { ...this.observation({ attemptId, role, binding, snapshot: this.baselineSnapshot }), artifact_id: artifactId };
  }

  async execute({ role, attemptId, taskId, attempt, binding }) {
    let text;
    const workerProposal = attemptId === "worker-implementation-1" && this.workerProposalPublished;
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
          rationale: "deterministic recovery fixture",
        },
      });
    } else if (attemptId === "planner-graph-1") {
      text = JSON.stringify({
        graph: { nodes: [{ task_id: "implementation-1", workflow_definition: "implementation" }] },
        packet: { acceptance_criteria: ["target exists"], deadline_seconds: 3 },
      });
    } else if (attemptId === "worker-implementation-1" && !this.workerProposalPublished) {
      writeFileSync(join(this.workspace, this.targetFile), this.expectedContent);
      this.workerProposalPublished = true;
      text = JSON.stringify({ status: "edit complete" });
    } else if (attemptId === "worker-implementation-1") {
      this.workerProposalAttempts += 1;
      if (this.workerProposalAttempts <= this.malformedWorkerProposals) {
        text = "I made the requested edit but will only describe it in prose and will not return the required JSON object.";
      } else {
        text = JSON.stringify({
          claims: ["the requested file was created"],
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
    if (workerProposal && this.workerProposalAttempts > this.malformedWorkerProposals) {
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

  async cancelAttempt({ binding }) {
    const snapshot = this.baselineSnapshot;
    return {
      confirmed: this.cancelConfirmed,
      observation: {
        ...this.observation({
          attemptId: `${binding.attempt_id}-cancel`,
          role: binding.role,
          binding,
          snapshot,
          taskId: binding.task_id,
          attempt: binding.attempt,
        }),
        runtime_permission_events: ["operator.cancel"],
        exit_reason: this.cancelConfirmed ? "cancelled" : "cancel_unconfirmed",
      },
    };
  }
}

async function interruptedRun({ cancelConfirmed = true, crashAt = "after_run_state_replacement:runtime_dispatch_prepared", requireActiveBinding = true } = {}) {
  const paths = fixture();
  let runtime;
  try {
    await assert.rejects(() => runLocalChange({
      workspace: paths.target,
      runRoot: paths.runRoot,
      requestText: exactRequest,
      runtimeFactory: (options) => {
        runtime = new ExitProvider({ ...options, cancelConfirmed });
        return runtime;
      },
      hooks: { commandOverride, crashAt },
    }), /simulated process death/);
    const runId = readdirSync(join(paths.runRoot, "runs"))[0];
    const runDir = join(paths.runRoot, "runs", runId);
    const state = readJson(join(runDir, "run.json"));
    assert.equal(state.lifecycle_state, "active");
    if (requireActiveBinding) {
      assert.ok(state.runtime_bindings.some(({ binding_state }) => binding_state === "active"));
    }
    return { ...paths, runtime, runId, runDir };
  } catch (error) {
    dispose(paths);
    throw error;
  }
}

async function localChangeRun({ providerOptions, hooks }) {
  const paths = fixture();
  let runtime;
  try {
    const result = await runLocalChange({
      workspace: paths.target,
      runRoot: paths.runRoot,
      requestText: exactRequest,
      runtimeFactory: (options) => {
        runtime = new ExitProvider({ ...options, ...providerOptions });
        return runtime;
      },
      hooks: { commandOverride, ...hooks },
    });
    return { ...paths, runtime, result, runDir: result.run_dir };
  } catch (error) {
    const runsRoot = join(paths.runRoot, "runs");
    const runDir = existsSync(runsRoot) && readdirSync(runsRoot).length > 0
      ? join(runsRoot, readdirSync(runsRoot)[0]) : null;
    return { ...paths, runtime, error, runDir };
  }
}

test("worker Result proposal retry: one malformed then valid worker-authored proposal completes the Run", async () => {
  const ran = await localChangeRun({ providerOptions: { malformedWorkerProposals: 1 } });
  try {
    assert.equal(ran.error, undefined, `Run blocked unexpectedly: ${ran.error?.message ?? ""}`);
    assert.equal(ran.runtime.workerProposalAttempts, 2, "exactly one corrective retry must re-use the worker session");
    assert.equal(ran.result.inspect.lifecycle_state, "completed");
    assert.equal(
      existsSync(join(ran.runDir, "artifacts/runtime/worker-implementation-1-proposal-retry.json")),
      true,
      "the corrective retry must be observable as a Runtime Observation",
    );
    const state = readJson(join(ran.runDir, "run.json"));
    const workerBindings = state.runtime_bindings.filter(({ attempt_id }) => attempt_id === "worker-implementation-1");
    assert.equal(workerBindings.length, 1, "the corrective retry must not open a second execution authority");
    assert.equal(ran.runtime.sessionNumber, 5, "the corrective retry reuses the admitted worker session");
  } finally {
    dispose(ran);
  }
});

test("worker Result proposal retry: two malformed proposals preserve the normal Block", async () => {
  const ran = await localChangeRun({ providerOptions: { malformedWorkerProposals: 2 } });
  try {
    assert.ok(ran.error, "two malformed proposals must not complete the Run");
    assert.equal(ran.runtime.workerProposalAttempts, 2, "exactly one corrective retry must be attempted");
    const state = readJson(join(ran.runDir, "run.json"));
    const workerBindings = state.runtime_bindings.filter(({ attempt_id }) => attempt_id === "worker-implementation-1");
    assert.equal(workerBindings.length, 1, "the corrective retry must not open a second execution authority");
    assert.equal(ran.runtime.sessionNumber, 3, "the corrective retry reuses the admitted worker session");
    assert.equal(state.lifecycle_state, "blocked");
    const failure = readJson(join(ran.runDir, "artifacts/outcomes/failure.json"));
    assert.equal(failure.outcome_kind, "block");
    assert.match(failure.summary, /worker Result proposal/, "the original malformed-proposal Block reason is preserved");
    assert.equal(
      existsSync(join(ran.runDir, "artifacts/runtime/worker-implementation-1-proposal-retry.json")),
      true,
      "the corrective retry must be observable even when it does not resolve the Block",
    );
  } finally {
    dispose(ran);
  }
});

test("AC-39-2 real local-change@1 reaches completed with independent verification, Promotion, Receipt, Result Ref, object id, and Output Snapshot", { timeout: 420_000, skip: providerUnavailableSkip }, async () => {
  const launched = await realRun();
  const evidence = successEvidence(launched.runDir);
  assert.equal(evidence.state.lifecycle_state, "completed");
  assert.equal(evidence.receipt.outcome_kind, "receipt");
  assert.equal(evidence.receipt.producer.role, "kernel");
  assert.equal(evidence.review.verdict, "pass");
  assert.equal(evidence.review.producer.role, "verifier");
  assert.ok(evidence.review.evidence.length > 0);
  assert.equal(evidence.result.producer.role, "worker");
  assert.equal(evidence.result.output_snapshot, evidence.promotion.verified_snapshot);
  assert.equal(evidence.result.output_snapshot, evidence.promotion.promoted_snapshot);
  assert.equal(evidence.receipt.accepted_snapshot, evidence.result.output_snapshot);
  assert.equal(evidence.receipt.verified_snapshot, evidence.result.output_snapshot);
  assert.equal(evidence.receipt.promoted_snapshot, evidence.result.output_snapshot);
  assert.match(evidence.promotion.result_ref, /^refs\/orchestrator\/results\//);
  assert.equal(evidence.promotion.promoted_ref_oid, evidence.promotedObjectId);
  assert.equal(evidence.promotion.promoted_resources.includes("change.txt"), true);
  assert.equal(evidence.result.changed_resources.includes("change.txt"), true);
  assert.equal(evidence.verifierRuntime.observed_output_snapshot, evidence.result.output_snapshot);
  assert.notEqual(evidence.workerBinding.agent_identity, evidence.verifierBinding.agent_identity);
  assert.equal(evidence.review.target_snapshot, evidence.result.output_snapshot);
  assert.equal(evidence.receipt.artifact_refs.some(({ path }) => path === evidence.resultRef.path), true);
  assert.equal(evidence.receipt.artifact_refs.some(({ path }) => path === evidence.reviewRef.path), true);
  assert.equal(evidence.receipt.artifact_refs.some(({ path }) => path === evidence.receipt.promotion_ref.path), true);
  assert.deepEqual(evidence.state.transitions.slice(-1).map(({ event_kind }) => event_kind), ["receipt_admitted"]);
  assert.equal(evidence.state.transitions.some(({ event_kind }) => event_kind === "block_admitted"), false);
  assert.equal(evidence.state.transitions.some(({ event_kind }) => event_kind === "material_decision_requested"), false);
  assert.equal(git(join(launched.runDir, "result-repository.git"), ["show", `${evidence.promotion.result_ref}:change.txt`]), "local change completed\n");
  assertNoCredential(launched.runRoot);
});

test("AC-39-3 closed operator projection exposes Run, checkpoint, Runtime Binding, outcome, and Verified Result without Application", { timeout: 420_000, skip: providerUnavailableSkip }, async () => {
  const launched = await realRun();
  const context = { target: launched.target, runRoot: launched.runRoot };
  const native = await invokeOperator({ action: "status", run_id: launched.state.run_id }, context);
  const direct = await operator.inspect({ ...context, run_id: launched.state.run_id });
  assert.deepEqual(native, direct);
  assert.deepEqual(Object.keys(native), [
    "schema_version", "action", "run_id", "state_version", "lifecycle_state",
    "checkpoint", "next_action", "runtime_bindings", "active_runtime_bindings", "outcome", "verified_result",
  ]);
  assert.equal(native.run_id, launched.state.run_id);
  assert.equal(native.lifecycle_state, "completed");
  assert.equal(native.next_action, null);
  assert.equal(native.runtime_bindings.length > 0, true);
  assert.equal(native.runtime_bindings.every(({ binding_state }) => typeof binding_state === "string"), true);
  assert.deepEqual(native.active_runtime_bindings, []);
  assert.equal(native.outcome.kind, "receipt");
  assert.deepEqual(Object.keys(native.verified_result), ["result_ref", "promoted_object_id", "output_snapshot"]);
  assert.equal(JSON.stringify(native).toLowerCase().includes("application"), false);
});

test("AC-39-4 fresh-session status, one-action resume, confirmed cancel, and cancel_unconfirmed match the direct file-backed operator", { timeout: 120_000, skip: providerUnavailableSkip }, async () => {
  const launched = await realRun();
  assert.equal(launched.launcher_exited, true);
  const context = { target: launched.target, runRoot: launched.runRoot };
  const directStatus = await operator.inspect({ ...context, run_id: launched.state.run_id });
  const nativeStatus = freshOperator({ action: "status", run_id: launched.state.run_id }, context);
  assert.deepEqual(nativeStatus, directStatus);

  const stateBeforeResume = readFileSync(join(launched.runDir, "run.json"), "utf8");
  const nativeResume = freshOperator({ action: "resume", run_id: launched.state.run_id }, context);
  const directResume = await operator.resume({ ...context, run_id: launched.state.run_id });
  assert.deepEqual(nativeResume, directResume);
  assert.equal(nativeResume.lifecycle_state, "completed");
  assert.equal(nativeResume.next_action, null);
  assert.equal(readFileSync(join(launched.runDir, "run.json"), "utf8"), stateBeforeResume);

  const resumable = await interruptedRun({ crashAt: "after_run_state_replacement:graph_revision_1_admitted", requireActiveBinding: false });
  try {
    const stopAfterWorkerAdmission = () => {
      const error = new Error("simulated process death after worker admission");
      error.code = "simulated_crash";
      throw error;
    };
    const resumedRuntime = new ExitProvider({ cancelConfirmed: true });
    const nativeInterruptedResume = await invokeOperator({ action: "resume", run_id: resumable.runId }, {
      target: resumable.target,
      runRoot: resumable.runRoot,
      runtime: resumedRuntime,
      hooks: { afterWorkerDispatch: stopAfterWorkerAdmission },
    });
    assert.equal(nativeInterruptedResume.lifecycle_state, "active");
    assert.equal(nativeInterruptedResume.checkpoint, "simulated_crash");
    assert.equal(nativeInterruptedResume.next_action, null);
    assert.equal(readJson(join(resumable.runDir, "run.json")).transitions.some(
      ({ event_kind }) => event_kind === "implementation_dispatched",
    ), true);
    const directInterruptedResume = await operator.resume({
      target: resumable.target,
      runRoot: resumable.runRoot,
      run_id: resumable.runId,
      runtime: new ExitProvider({ cancelConfirmed: true }),
      hooks: { afterWorkerDispatch: stopAfterWorkerAdmission },
    });
    assert.deepEqual(nativeInterruptedResume, directInterruptedResume);
    assertPreserved(resumable, "one-action resume");
  } finally {
    dispose(resumable);
  }

  const confirmed = await interruptedRun({ cancelConfirmed: true });
  try {
    const cancelled = await invokeOperator({ action: "cancel", run_id: confirmed.runId }, {
      target: confirmed.target,
      runRoot: confirmed.runRoot,
      runtime: confirmed.runtime,
    });
    const directCancelled = await operator.cancel({
      target: confirmed.target,
      runRoot: confirmed.runRoot,
      run_id: confirmed.runId,
      runtime: confirmed.runtime,
    });
    assert.deepEqual(cancelled, directCancelled);
    assert.equal(cancelled.lifecycle_state, "cancelled");
    assert.equal(cancelled.next_action, null);
    assert.equal(readJson(join(confirmed.runDir, "run.json")).runtime_bindings.at(-1).binding_state, "cancelled");
    assertPreserved(confirmed, "confirmed cancellation");
  } finally {
    dispose(confirmed);
  }

  const unconfirmed = await interruptedRun({ cancelConfirmed: false });
  try {
    const cancelled = await invokeOperator({ action: "cancel", run_id: unconfirmed.runId }, {
      target: unconfirmed.target,
      runRoot: unconfirmed.runRoot,
      runtime: unconfirmed.runtime,
    });
    const directCancelled = await operator.cancel({
      target: unconfirmed.target,
      runRoot: unconfirmed.runRoot,
      run_id: unconfirmed.runId,
      runtime: unconfirmed.runtime,
    });
    assert.deepEqual(cancelled, directCancelled);
    assert.equal(cancelled.lifecycle_state, "blocked");
    assert.equal(cancelled.checkpoint, "cancel_unconfirmed");
    assert.equal(cancelled.outcome.kind, "block");
    assert.equal(readJson(join(unconfirmed.runDir, "artifacts/outcomes/cancel.json")).block_type, "cancel_unconfirmed");
    assert.equal(readJson(join(unconfirmed.runDir, "run.json")).runtime_bindings.at(-1).binding_state, "unreachable");
    assert.equal(readJson(join(unconfirmed.runDir, "run.json")).transitions.some(({ event_kind }) => event_kind === "successor_dispatched"), false);
    assertPreserved(unconfirmed, "unreachable-provider cancellation");
  } finally {
    dispose(unconfirmed);
  }
});

test("AC-39-5 resolved permissions and checked-in assets equal the allowlist with no undeclared worker authority or direct role selection", { skip: opencodeUnavailableSkip }, async () => {
  const paths = fixture();
  try {
    await withEnvironment(Object.fromEntries(cleanLauncherVariables.map((name) => [name, undefined])), async () => {
      const resolved = preflight({ ...paths, checkConfiguration: true });
      assert.equal(resolved.executable.version, observedOpenCodeVersion);
      assert.equal(resolved.environment.HOME, join(paths.runRoot, "operator-runtime/home"));
      assert.equal(resolved.environment.XDG_CONFIG_HOME, join(paths.runRoot, "operator-runtime/config"));
      assert.equal(resolved.environment.XDG_CACHE_HOME, join(paths.runRoot, "operator-runtime/cache"));
      assert.equal(resolved.environment.XDG_DATA_HOME, join(paths.runRoot, "operator-runtime/data"));
      assert.equal(resolved.environment.XDG_STATE_HOME, join(paths.runRoot, "operator-runtime/state"));
      const config = JSON.parse(execFileSync(resolved.executable.path, ["debug", "config", "--pure"], {
        cwd: paths.target,
        encoding: "utf8",
        env: resolved.environment,
      }));
      assert.deepEqual(Object.keys(config.agent ?? {}).sort(), ["orchestrator"]);
      assert.deepEqual(Object.keys(config.command ?? {}).sort(), ["orchestrate", "orchestrate-cancel", "orchestrate-resume", "orchestrate-status"]);
      assert.deepEqual(config.agent.orchestrator.tools, { "*": false, orchestrator_operator: true });
      assert.deepEqual(config.agent.orchestrator.permission, { "*": "deny", orchestrator_operator: "allow" });
      assert.equal((config.instructions ?? []).length, 0);
      assert.equal((config.plugin ?? []).length, 0);
      assert.deepEqual(Object.keys(config.mcp ?? {}), []);
      for (const name of Object.keys(config.command)) {
        assert.equal(config.command[name].agent, "orchestrator");
        assert.equal(config.command[name].subtask, false);
      }
      const actualAssets = ["opencode", "workflow-agents", "workflows", "route-rules", "skills"]
        .flatMap((root) => walkFiles(join(repository, root))
          .filter((path) => !(root === "opencode" && generatedDependencyEntries.has(path.split("/")[0])))
          .map((path) => join(root, path)))
        .sort();
      assert.deepEqual(actualAssets, [...acceptedAssets].sort());
      for (const role of ["planner", "worker", "verifier"]) {
        const profile = readJson(join(repository, `workflow-agents/${role}@1.json`));
        assert.equal(profile.selectable, false);
        assert.equal(profile.tools.task, false);
        assert.equal(profile.tools.bash, false);
        assert.equal(profile.tools.external_directory, false);
        assert.equal(profile.permission["*"], "deny");
      }
      assert.equal(existsSync(join(paths.runRoot, "runs")), false);
    });

    const developerRoot = mkdtempSync(join(tmpdir(), "m4-exit-home-"));
    const xdgRoot = mkdtempSync(join(tmpdir(), "m4-exit-xdg-"));
    const collisionCases = [
      ["target command", join(paths.target, ".opencode/commands/orchestrate.md")],
      ["target agent", join(paths.target, ".opencode/agents/orchestrator.md")],
      ["target tool", join(paths.target, ".opencode/tools/orchestrator_operator.ts")],
      ["target skill", join(paths.target, ".opencode/skills/implement")],
      ["xdg command", join(xdgRoot, "opencode/commands/orchestrate.md")],
      ["home config agent", join(developerRoot, ".config/opencode/agents/orchestrator.md")],
      ["home opencode tool", join(developerRoot, ".opencode/tools/request_route.ts")],
      ["agents skill", join(developerRoot, ".agents/skills/tdd")],
      ["claude skill", join(developerRoot, ".claude/skills/code-review")],
    ];
    await withEnvironment({
      HOME: developerRoot,
      XDG_CONFIG_HOME: xdgRoot,
      XDG_CACHE_HOME: undefined,
      XDG_DATA_HOME: undefined,
      XDG_STATE_HOME: undefined,
      OPENCODE_CONFIG: undefined,
      OPENCODE_CONFIG_CONTENT: undefined,
    }, async () => {
      for (const [label, collisionPath] of collisionCases) {
        mkdirSync(join(collisionPath, ".."), { recursive: true });
        writeFileSync(collisionPath, "collision\n");
        const targetBefore = targetState(paths.target);
        const runBefore = treeDigest([paths.runRoot]);
        assert.throws(() => preflight(paths), (error) => error.type === "runtime_configuration_conflict", label);
        assert.deepEqual(targetState(paths.target), targetBefore, `${label}: target mutated`);
        assert.equal(treeDigest([paths.runRoot]), runBefore, `${label}: run root mutated`);
        rmSync(collisionPath, { recursive: true, force: true });
      }
    });
  } finally {
    dispose(paths);
  }
});

test("AC-39-6 every real black-box row preserves target branch, status, Git-visible content, and developer-home configuration", { timeout: 420_000, skip: providerUnavailableSkip }, async () => {
  const launched = await realRun();
  assertPreserved(launched, "real launcher");
  assertNoCredential(launched.runRoot);
  const status = await operator.inspect({ target: launched.target, runRoot: launched.runRoot, run_id: launched.state.run_id });
  assert.equal(status.lifecycle_state, "completed");
  assertPreserved(launched, "file-backed status");
});

test("AC-39-7 focused exit evidence records runtime identity, exact input, counts, duration, terminal artifact, no-mutation, and native/direct equivalence", { timeout: 420_000, skip: providerUnavailableSkip }, async () => {
  const launched = await realRun();
  const source = readFileSync(join(repository, "test/m4-exit.test.mjs"), "utf8");
  for (const id of ["AC-39-1", "AC-39-2", "AC-39-3", "AC-39-4", "AC-39-5", "AC-39-6", "AC-39-7"]) {
    assert.equal(source.includes(id), true, `missing focused acceptance id ${id}`);
  }
  const packageJson = readJson(join(repository, "package.json"));
  assert.equal(packageJson.scripts["test:m4-exit"], "node --test test/m4-exit.test.mjs");
  assert.equal(launched.runtime_version, observedOpenCodeVersion);
  assert.equal(launched.runtime_version.length > 0, true);
  assert.equal(existsSync(launched.terminal_path), true);
  assert.equal(launched.command, "npm run opencode -- --target <absolute-clean-target> --run-root <absolute-run-root>");
  const terminal = readFileSync(launched.terminal_path, "utf8");
  assert.match(terminal, /Call `orchestrator_operator` exactly once/);
  assert.match(terminal, /Add change\.txt with the requested local change\./);
  assert.match(readFileSync(join(repository, "bin/opencode-orchestrator.mjs"), "utf8"), /minimumOpenCodeVersion/,
    "preflight must keep an OpenCode minimum-version compatibility gate");
  const native = freshOperator({ action: "status", run_id: launched.state.run_id }, {
    target: launched.target,
    runRoot: launched.runRoot,
  });
  const direct = await operator.inspect({ target: launched.target, runRoot: launched.runRoot, run_id: launched.state.run_id });
  assert.deepEqual(native, direct);
  assertPreserved(launched, "focused exit evidence");
  assertNoCredential(launched.runRoot);
});
