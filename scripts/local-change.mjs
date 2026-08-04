#!/usr/bin/env node

import Ajv2020 from "ajv/dist/2020.js";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const schema = JSON.parse(readFileSync(
  new URL("../docs/design/schemas/protocol-v1.schema.json", import.meta.url),
));
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const validator = ajv.compile(schema);
const referenceValidator = ajv.compile({
  $schema: schema.$schema,
  $defs: schema.$defs,
  ...schema.$defs.reference,
});
const environmentPolicyId = "local-change-sandbox-v1";
const skillSource = ".opencode/skills/m1-local-change/SKILL.md";
const budget = {
  max_concurrency: 1,
  max_execution_attempts: 2,
  max_planner_attempts: 3,
  max_graph_revisions: 2,
  max_repairs_per_finding: 0,
};
const m1AttemptDeadlineSeconds = 300;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  const input = Buffer.isBuffer(value) ? value : canonicalJson(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

function fileDigest(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function crashAt(ctx, label) {
  const configured = ctx?.hooks?.crashAt;
  const shouldCrash = typeof configured === "function"
    ? configured(label)
    : Array.isArray(configured)
      ? configured.includes(label)
      : configured === label;
  if (!shouldCrash) return;
  const error = new Error(`simulated process death at ${label}`);
  error.code = "simulated_crash";
  throw error;
}

function validateProtocol(value, label) {
  if (!validator(value)) {
    throw new Error(`${label} failed protocol validation: ${JSON.stringify(validator.errors)}`);
  }
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitRaw(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitStatus(cwd) {
  return git(cwd, ["status", "--porcelain=v1", "-z"]);
}

function gitPaths(cwd) {
  const output = git(cwd, ["ls-files", "-c", "-o", "--exclude-standard", "-z"]);
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

function dirtyPaths(cwd) {
  const output = git(cwd, ["ls-files", "-m", "-d", "-o", "--exclude-standard", "-z"]);
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

function entryFor(cwd, path) {
  const fullPath = join(cwd, path);
  let stat;
  try {
    stat = lstatSync(fullPath);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(fullPath);
    return {
      path,
      mode: "120000",
      target,
      content_digest: digest(target),
    };
  }
  return {
    path,
    mode: stat.mode & 0o111 ? "100755" : "100644",
    content_digest: fileDigest(fullPath),
  };
}

export function workspaceSnapshot(cwd) {
  const base = git(cwd, ["rev-parse", "HEAD"]).trim();
  const entries = gitPaths(cwd).map((path) => entryFor(cwd, path)).filter(Boolean);
  return {
    base,
    entries,
    digest: digest({ base, entries }),
  };
}

function diffEntries(before, after) {
  const previous = new Map(before.entries.map((entry) => [entry.path, entry]));
  const current = new Map(after.entries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...previous.keys(), ...current.keys()])].sort();
  return paths.flatMap((path) => {
    const oldEntry = previous.get(path);
    const newEntry = current.get(path);
    if (!oldEntry && newEntry) {
      return [{ path, operation: "add", mode: newEntry.mode, content_digest: newEntry.content_digest }];
    }
    if (oldEntry && !newEntry) {
      return [{ path, operation: "delete", mode: oldEntry.mode, content_digest: oldEntry.content_digest }];
    }
    if (canonicalJson(oldEntry) === canonicalJson(newEntry)) return [];
    return [{
      path,
      operation: "modify",
      mode: newEntry.mode,
      content_digest: newEntry.content_digest,
    }];
  });
}

function copyPath(sourceRoot, targetRoot, path) {
  const source = join(sourceRoot, path);
  const target = join(targetRoot, path);
  if (!existsSync(source)) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true, dereference: false });
}

function cloneWorkspace(sourceRoot, targetRoot) {
  git(sourceRoot, ["clone", "--no-hardlinks", sourceRoot, targetRoot]);
  git(targetRoot, ["config", "user.email", "m1-harness@example.invalid"]);
  git(targetRoot, ["config", "user.name", "M1 Harness"]);
  const changed = git(sourceRoot, ["ls-files", "-m", "-d", "-o", "--exclude-standard", "-z"])
    .split("\0").filter(Boolean);
  for (const path of [...new Set(changed)]) copyPath(sourceRoot, targetRoot, path);
  return { protectedPaths: dirtyPaths(sourceRoot) };
}

function reference(artifactId, artifactPath, artifact) {
  return {
    reference_kind: "artifact",
    artifact_id: artifactId,
    path: artifactPath,
    digest: digest(artifact),
  };
}

function artifactPath(path) {
  return `artifacts/${path}`;
}

function isArtifactReference(value) {
  return value && typeof value === "object" && value.reference_kind === "artifact";
}

function safeArtifactPath(runDir, path) {
  if (!path.startsWith("artifacts/") || path.split("/").includes("..")) {
    throw new Error(`artifact reference outside artifacts/: ${path}`);
  }
  const fullPath = resolve(runDir, path);
  const relativePath = relative(resolve(runDir, "artifacts"), fullPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`artifact reference escapes run directory: ${path}`);
  }
  return fullPath;
}

export function resolveArtifactReference(ctx, artifactReference) {
  if (!referenceValidator(artifactReference)) {
    throw new Error(`artifact reference failed protocol validation: ${JSON.stringify(referenceValidator.errors)}`);
  }
  const fullPath = safeArtifactPath(ctx.runDir, artifactReference.path);
  if (!existsSync(fullPath)) throw new Error(`artifact reference is missing: ${artifactReference.path}`);
  const artifact = JSON.parse(readFileSync(fullPath, "utf8"));
  validateProtocol(artifact, artifact.kind);
  if (artifact.artifact_id !== artifactReference.artifact_id
    || digest(artifact) !== artifactReference.digest) {
    throw new Error(`artifact reference digest or id mismatch: ${artifactReference.path}`);
  }
  return artifact;
}

function resolveArtifactReferences(ctx, value, seen = new Set()) {
  if (isArtifactReference(value)) {
    const key = `${value.path}:${value.digest}`;
    if (!seen.has(key)) {
      seen.add(key);
      resolveArtifactReference(ctx, value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => resolveArtifactReferences(ctx, item, seen));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => resolveArtifactReferences(ctx, item, seen));
  }
}

function validateCommandEvidence(ctx, artifact) {
  for (const evidence of artifact.evidence ?? []) {
    if (!evidence.command_ref) continue;
    const observation = resolveArtifactReference(ctx, evidence.command_ref.runtime_ref);
    const execution = observation.command_executions.find(({ command_id }) =>
      command_id === evidence.command_ref.command_id);
    if (!execution || execution.output_digest !== evidence.command_ref.output_digest) {
      throw new Error(`command Evidence does not match Runtime Observation: ${evidence.command_ref.command_id}`);
    }
  }
}

export function admitArtifact(ctx, path, artifact, producerActorId = artifact?.producer?.actor_id) {
  validateProtocol(artifact, artifact.kind);
  const storedPath = path.startsWith("artifacts/") ? path : artifactPath(path);
  const fullPath = safeArtifactPath(ctx.runDir, storedPath);
  if (!artifact.producer || artifact.producer.actor_id !== producerActorId) {
    throw new Error(`artifact producer ownership mismatch: ${artifact.artifact_id}`);
  }
  resolveArtifactReferences(ctx, artifact);
  validateCommandEvidence(ctx, artifact);
  if (existsSync(fullPath)) throw new Error(`immutable artifact already exists: ${storedPath}`);
  const actorPath = String(producerActorId).replace(/[^A-Za-z0-9._-]/g, "_");
  const stagingPath = join(ctx.runDir, "staging", actorPath, `${artifact.artifact_id}-${randomUUID()}.json`);
  writeJson(stagingPath, artifact);
  mkdirSync(dirname(fullPath), { recursive: true });
  try {
    linkSync(stagingPath, fullPath);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`immutable artifact already exists: ${storedPath}`);
    throw error;
  } finally {
    if (existsSync(stagingPath)) unlinkSync(stagingPath);
  }
  const artifactReference = reference(artifact.artifact_id, storedPath, artifact);
  ctx.admittedRefs?.push(artifactReference);
  return artifactReference;
}

function writeArtifact(ctx, path, artifact) {
  return admitArtifact(ctx, path, artifact);
}

function writeRunState(ctx, state) {
  validateProtocol(state, "run state");
  resolveArtifactReferences(ctx, state);
  writeJson(join(ctx.runDir, "run.json"), state);
}

export class StateConflict extends Error {}

export function transitionRun(state, {
  eventId,
  eventKind,
  recordRefs = [],
  expectedStateVersion = state.state_version,
  patch = {},
}) {
  const existing = state.transitions.find(({ event_id }) => event_id === eventId);
  if (existing) return structuredClone(state);
  if (state.state_version !== expectedStateVersion) {
    throw new StateConflict(`stale Run State: expected ${expectedStateVersion}, found ${state.state_version}`);
  }
  const next = structuredClone(state);
  Object.assign(next, structuredClone(patch));
  next.state_version += 1;
  next.transitions.push({
    sequence: next.transitions.length + 1,
    event_id: eventId,
    from_state_version: state.state_version,
    to_state_version: next.state_version,
    event_kind: eventKind,
    record_refs: structuredClone(recordRefs),
  });
  return next;
}

function applyTransition(ctx, state, eventKind, patch, recordRefs = []) {
  const next = transitionRun(state, {
    eventId: `${eventKind}-${state.state_version + 1}`,
    eventKind,
    patch,
    recordRefs,
  });
  crashAt(ctx, `before_run_state_replacement:${eventKind}`);
  writeRunState(ctx, next);
  crashAt(ctx, `after_run_state_replacement:${eventKind}`);
  return next;
}

function envelope({ kind, artifactId, runId, producer, inputRefs = [], createdAt, ...rest }) {
  return {
    schema_version: "1.0",
    kind,
    artifact_id: artifactId,
    run_id: runId,
    producer,
    input_refs: inputRefs,
    created_at: createdAt,
    ...rest,
  };
}

function plannerProducer(actorId) {
  return { role: "planner", actor_id: actorId };
}

function kernelProducer() {
  return { role: "kernel", actor_id: "kernel-m1" };
}

function runtimeProducer() {
  return { role: "runtime", actor_id: "opencode-adapter-m1" };
}

function workerProducer(actorId) {
  return { role: "worker", actor_id: actorId };
}

function verifierProducer(actorId) {
  return { role: "verifier", actor_id: actorId };
}

function now() {
  return new Date().toISOString();
}

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const closed = once(server, "close");
  server.close();
  await closed;
  return port;
}

async function wait(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function subscribeEvents({ port }) {
  const events = [];
  let response;
  let readyResolve;
  const ready = new Promise((resolvePromise) => { readyResolve = resolvePromise; });
  const req = request({ hostname: "127.0.0.1", port, path: "/event" }, (res) => {
    response = res;
    res.setEncoding("utf8");
    let raw = "";
    res.on("data", (chunk) => {
      raw += chunk;
      const records = raw.split("\n\n");
      raw = records.pop();
      for (const record of records) {
        const data = record.split("\n").find((line) => line.startsWith("data: "));
        if (!data) continue;
        try { events.push(JSON.parse(data.slice(6))); } catch { /* heartbeat */ }
      }
    });
    readyResolve();
  });
  req.setTimeout(5_000, () => req.destroy(new Error("event subscription timeout")));
  req.on("error", () => readyResolve());
  req.end();
  return { events, ready, close: () => { response?.destroy(); req.destroy(); } };
}

export class OpenCodeAdapter {
  constructor({ workspace, runDir, baselineSnapshot, targetFile, attemptDeadlineSeconds = m1AttemptDeadlineSeconds }) {
    this.workspace = workspace;
    this.runDir = runDir;
    this.baselineSnapshot = baselineSnapshot;
    this.targetFile = targetFile;
    this.attemptDeadlineSeconds = attemptDeadlineSeconds;
    this.server = null;
    this.serverExit = null;
    this.port = null;
    this.version = null;
    this.configurationDigest = null;
    this.agents = [];
    this.environment = {
      ...process.env,
      XDG_CACHE_HOME: join(runDir, "runtime/cache"),
      XDG_CONFIG_HOME: join(runDir, "runtime/config"),
      XDG_DATA_HOME: join(runDir, "runtime/data"),
      XDG_STATE_HOME: join(runDir, "runtime/state"),
      OPENCODE_CONFIG_DIR: join(runDir, "runtime/opencode-config"),
      OPENCODE_DISABLE_CLAUDE_CODE: "true",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      OPENCODE_DISABLE_MODELS_FETCH: "true",
    };
  }

  async start() {
    const plannerPermission = { "*": "deny" };
    const verifierPermission = { read: "allow", "*": "deny" };
    const workerPermission = {
      read: "allow", edit: "allow", write: "allow", bash: "deny", task: "deny",
      webfetch: "deny", question: "deny",
    };
    const plannerTools = {
      read: false, grep: false, glob: false, bash: false, edit: false, write: false,
      task: false, webfetch: false,
    };
    const verifierTools = {
      read: true, grep: false, glob: false, bash: false, edit: false, write: false,
      task: false, webfetch: false,
    };
    const workerTools = {
      read: true, grep: false, glob: false, bash: false, edit: true, write: true,
      task: false, webfetch: false,
    };
    const agent = (role, permission) => ({
      mode: "primary",
      model: "opencode/big-pickle",
      tools: role === "worker" ? workerTools : role === "verifier" ? verifierTools : plannerTools,
      prompt: role === "worker"
        ? "You are a bounded implementation worker. Use only read and edit/write tools. Never use shell, network, task delegation, or external paths."
        : role === "verifier"
          ? "You are a bounded independent verifier. Use only the explicitly named read target; never edit, write, shell, network, or delegate. Return the exact JSON shape requested by the prompt and no Markdown."
          : `You are a bounded ${role}. Use no tools except repository read when explicitly requested. Return the exact JSON shape requested by the prompt and no Markdown.`,
      permission,
    });
    writeJson(join(this.environment.OPENCODE_CONFIG_DIR, "opencode.json"), {
      agent: {
        "m1-planner": agent("planner", plannerPermission),
        "m1-worker": agent("worker", workerPermission),
        "m1-verifier": agent("verifier", verifierPermission),
      },
    });
    this.version = execFileSync("opencode", ["--version"], {
      encoding: "utf8",
      env: this.environment,
    }).trim();
    const resolvedConfig = JSON.parse(execFileSync("opencode", ["debug", "config", "--pure"], {
      cwd: this.workspace,
      encoding: "utf8",
      env: this.environment,
    }));
    this.configurationDigest = digest(resolvedConfig);
    const undeclared = [
      ...(resolvedConfig.instructions ?? []).map((item) => `instruction:${item}`),
      ...(resolvedConfig.plugin ?? []).map((item) => `plugin:${item}`),
      ...Object.entries(resolvedConfig.mcp ?? {})
        .filter(([, definition]) => definition?.enabled !== false)
        .map(([name]) => `mcp:${name}`),
      ...Object.keys(resolvedConfig.agent ?? {})
        .filter((name) => !["m1-planner", "m1-worker", "m1-verifier"].includes(name))
        .map((name) => `agent:${name}`),
      ...Object.keys(resolvedConfig.command ?? {}).map((name) => `command:${name}`),
      ...Object.keys(resolvedConfig.provider ?? {}).map((name) => `provider:${name}`),
    ].sort();
    if (undeclared.length > 0) {
      throw new Error(`runtime_configuration_conflict: ${undeclared.join(",")}`);
    }
    this.port = await unusedPort();
    this.server = spawn("opencode", [
      "serve", "--pure", "--hostname", "127.0.0.1", "--port", String(this.port),
    ], {
      cwd: this.workspace,
      env: this.environment,
      stdio: "ignore",
    });
    this.serverExit = once(this.server, "exit");
    let health;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (this.server.exitCode !== null) throw new Error(`OpenCode server exited: ${this.server.exitCode}`);
      try {
        const response = await this.api("/global/health", { timeout: 500 });
        health = response.body;
        break;
      } catch {
        await wait(50);
      }
    }
    if (!health?.healthy || health.version !== this.version) {
      throw new Error("OpenCode server health did not match its CLI version");
    }
    this.agents = (await this.api("/agent", { timeout: 5_000 })).body;
    for (const role of ["planner", "worker", "verifier"]) {
      if (!this.agents.find(({ name }) => name === `m1-${role}`)) {
        throw new Error(`OpenCode did not resolve m1-${role}`);
      }
    }
    return health;
  }

  async api(path, { method = "GET", body, timeout = 5_000, signal } = {}) {
    const controller = signal ? null : new AbortController();
    const requestSignal = signal ?? controller.signal;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestSignal,
      });
      const raw = await response.text();
      let parsed = null;
      try { parsed = raw.length === 0 ? null : JSON.parse(raw); } catch { parsed = raw; }
      if (!response.ok) throw new Error(`OpenCode HTTP ${response.status} ${path}: ${raw.slice(0, 500)}`);
      return { status: response.status, body: parsed };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async newAttempt({ role, attemptId, taskId, attempt }) {
    const agent = this.agents.find(({ name }) => name === `m1-${role}`);
    const session = (await this.api("/session", {
      method: "POST",
      body: { title: `${attemptId}` },
    })).body;
    const model = `${agent.model.providerID}/${agent.model.modelID}`;
    const binding = {
      attempt_id: attemptId,
      ...(taskId ? { task_id: taskId } : {}),
      attempt,
      session_id: session.id,
      role,
      agent_identity: digest(agent),
      agent: agent.name,
      model,
      configuration_digest: this.configurationDigest,
      binding_state: "active",
    };
    return { agent, binding };
  }

  preflightObservation({ attemptId, role, binding, artifactId }) {
    return envelope({
      kind: "runtime_observation",
      artifactId,
      runId: this.runId,
      producer: runtimeProducer(),
      createdAt: now(),
      attempt_id: attemptId,
      role,
      opencode_version: this.version,
      configuration_digest: this.configurationDigest,
      server_id: `opencode-${this.port}`,
      session_id: binding.session_id,
      agent_identity: binding.agent_identity,
      message_ids: [],
      agent: binding.agent,
      model: binding.model,
      runtime_permission_events: [],
      command_executions: [],
      observed_changes: [],
      observed_output_snapshot: this.baselineSnapshot.digest,
      external_reads: [],
      exit_reason: "idle",
    });
  }

  async confirmAttemptStop(sessionId, eventsSubscription) {
    let abortConfirmed = false;
    try {
      abortConfirmed = (await this.api(`/session/${sessionId}/abort`, {
        method: "POST",
        body: {},
        timeout: 5_000,
      })).body === true;
    } catch {
      abortConfirmed = false;
    }
    await wait(100);
    let status = null;
    try {
      status = (await this.api("/session/status", { timeout: 5_000 })).body?.[sessionId]?.type ?? null;
    } catch {
      status = null;
    }
    const events = eventsSubscription.events
      .filter(({ properties }) => properties?.sessionID === sessionId
        || properties?.info?.sessionID === sessionId)
      .map(({ type }) => type);
    return {
      confirmed: abortConfirmed || status === "idle" || events.includes("session.idle"),
      status,
      events,
    };
  }

  async cancelAttempt({ binding }) {
    const stop = await this.confirmAttemptStop(binding.session_id, { events: [] });
    const snapshot = this.baselineSnapshot;
    return {
      confirmed: stop.confirmed,
      observation: {
        ...this.preflightObservation({
          attemptId: `${binding.attempt_id}-cancel`,
          role: binding.role,
          binding,
          artifactId: `runtime-${binding.attempt_id}-cancel`,
        }),
        ...(binding.task_id ? { task_id: binding.task_id, attempt: binding.attempt } : {}),
        observed_output_snapshot: snapshot.digest,
        runtime_permission_events: ["operator.cancel", ...stop.events],
        exit_reason: stop.confirmed ? "cancelled" : "cancel_unconfirmed",
      },
    };
  }

  async latestMessage(sessionId, fallback) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const messages = (await this.api(`/session/${sessionId}/message?limit=20`, { timeout: 5_000 })).body;
        const candidate = (Array.isArray(messages) ? messages : [])
          .filter(({ info, parts }) => info?.role === "assistant"
            && parts?.some(({ type, text }) => (type === "text" || type === "reasoning") && text?.trim()))
          .at(-1);
        if (candidate) return candidate;
      } catch {
        // The POST response remains the authoritative fallback if the list route is unavailable.
      }
      await wait(100);
    }
    return fallback;
  }

  async execute({ role, attemptId, taskId, attempt, binding, prompt, beforeSnapshot, deadlineSeconds = m1AttemptDeadlineSeconds }) {
    const eventsSubscription = subscribeEvents({ port: this.port });
    await eventsSubscription.ready;
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineController.abort(), Math.max(1, deadlineSeconds) * 1_000);
    let response;
    try {
      response = await this.api(`/session/${binding.session_id}/message`, {
        method: "POST",
        body: {
          agent: binding.agent,
          parts: [{ type: "text", text: prompt }],
        },
        timeout: Math.max(5_000, (Math.max(1, deadlineSeconds) + 5) * 1_000),
        signal: deadlineController.signal,
      });
    } catch (error) {
      if (!deadlineController.signal.aborted) {
        eventsSubscription.close();
        throw error;
      }
      const stop = await this.confirmAttemptStop(binding.session_id, eventsSubscription);
      eventsSubscription.close();
      return {
        binding: { ...binding, binding_state: stop.confirmed ? "cancelled" : "unreachable" },
        text: "",
        snapshot: null,
        changes: [],
        events: stop.events,
        attempt_failed: true,
        stop_confirmed: stop.confirmed,
        observation: {
          ...envelope({
            kind: "runtime_observation",
            artifactId: `runtime-${attemptId}-deadline`,
            runId: this.runId,
            producer: runtimeProducer(),
            createdAt: now(),
            attempt_id: attemptId,
            ...(taskId ? { task_id: taskId } : {}),
            ...(role === "worker" || role === "verifier" ? { attempt } : {}),
            role,
            opencode_version: this.version,
            configuration_digest: this.configurationDigest,
            server_id: `opencode-${this.port}`,
            session_id: binding.session_id,
            agent_identity: binding.agent_identity,
            message_ids: [],
            agent: binding.agent,
            model: binding.model,
            runtime_permission_events: stop.events,
            command_executions: [],
            observed_changes: [],
            observed_output_snapshot: beforeSnapshot.digest,
            external_reads: [],
            exit_reason: stop.confirmed ? "deadline_exceeded" : "cancel_unconfirmed",
          }),
        },
      };
    } finally {
      clearTimeout(deadlineTimer);
    }
    await wait(100);
    const statuses = await this.api("/session/status", { timeout: 5_000 });
    eventsSubscription.close();
    const body = await this.latestMessage(binding.session_id, response.body);
    const currentSnapshot = workspaceSnapshot(this.workspace);
    const events = eventsSubscription.events
      .filter(({ properties }) => properties?.sessionID === binding.session_id
        || properties?.info?.sessionID === binding.session_id)
      .map(({ type }) => type);
    const status = statuses.body?.[binding.session_id]?.type;
    const textParts = (body?.parts ?? [])
      .filter(({ type }) => type === "text")
      .map(({ text: value }) => value);
    const reasoningParts = (body?.parts ?? [])
      .filter(({ type }) => type === "reasoning")
      .map(({ text: value }) => value);
    const text = [...textParts, ...reasoningParts].join("\n").trim();
    const nextBinding = { ...binding, binding_state: "idle" };
    return {
      binding: nextBinding,
      text,
      snapshot: currentSnapshot,
      changes: diffEntries(beforeSnapshot, currentSnapshot),
      events,
      observation: {
        ...envelope({
          kind: "runtime_observation",
          artifactId: `runtime-${attemptId}`,
          runId: this.runId,
          producer: runtimeProducer(),
          inputRefs: [],
          createdAt: now(),
          attempt_id: attemptId,
          ...(taskId ? { task_id: taskId } : {}),
          ...(role === "worker" || role === "verifier" ? { attempt } : {}),
          role,
          opencode_version: this.version,
          configuration_digest: this.configurationDigest,
          server_id: `opencode-${this.port}`,
          session_id: binding.session_id,
          agent_identity: binding.agent_identity,
          message_ids: body?.info?.id ? [body.info.id] : [],
          agent: binding.agent,
          model: binding.model,
          runtime_permission_events: events,
          command_executions: [],
          observed_changes: diffEntries(beforeSnapshot, currentSnapshot),
          observed_output_snapshot: currentSnapshot.digest,
          external_reads: [],
          exit_reason: status === "idle" || status === undefined || events.includes("session.idle")
            ? "idle" : "runtime_error",
        }),
      },
    };
  }

  async stop() {
    if (!this.server || (this.server.exitCode !== null && this.server.signalCode !== null)) return;
    if (this.server.exitCode === null) this.server.kill("SIGKILL");
    await Promise.race([
      this.serverExit.then(() => true),
      wait(2_000).then(() => false),
    ]);
  }
}

function responseObject(text, label) {
  const candidates = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const character = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try { candidates.push(JSON.parse(text.slice(start, end + 1))); } catch { break; }
        }
      }
    }
  }
  const hint = label.includes("Request")
    ? (value) => value?.preset_selection
    : label.includes("revision 1")
      ? (value) => value?.graph && value?.packet
      : label.includes("revision 2")
        ? (value) => value?.verifier_task && value?.verifier_packet
        : (value) => value?.verdict;
  const matching = candidates.filter(hint);
  if (matching.length > 0) return matching.sort((a, b) =>
    JSON.stringify(b).length - JSON.stringify(a).length)[0];
  if (candidates.length > 0) {
    return candidates.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
  }
  throw new Error(`${label} did not return a JSON object`);
}

function validStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return value;
}

function requestProposal(parsed, { requestText, targetSnapshot }) {
  const selection = parsed.preset_selection;
  if (!selection || selection.preset !== "local-change@1") {
    throw new Error("planner Request did not select local-change@1");
  }
  if (parsed.target_snapshot !== targetSnapshot) {
    throw new Error("planner Request target snapshot does not match the intake snapshot");
  }
  return {
    objective: typeof parsed.objective === "string" && parsed.objective.length > 0
      ? parsed.objective : requestText,
    scope: validStringArray(parsed.scope, "Request scope"),
    exclusions: validStringArray(parsed.exclusions, "Request exclusions"),
    ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities : [],
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
    target_snapshot: targetSnapshot,
    preset_selection: {
      preset: "local-change@1",
      selection_evidence: validEvidenceArray(selection.selection_evidence),
      proposed_narrowing: selection.proposed_narrowing ?? null,
      rationale: typeof selection.rationale === "string" && selection.rationale.length > 0
        ? selection.rationale : "The bounded request changes local repository state without external effects.",
    },
  };
}

function validEvidenceArray(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("selection evidence must contain at least one evidence record");
  }
  return value.map((item) => ({
    claim: String(item.claim ?? "bounded local-change request"),
    source: String(item.source ?? "intake"),
    observation: String(item.observation ?? "request scope and exclusions were provided"),
  }));
}

function policyFor(request, budgetOverride = {}) {
  const proposed = request.preset_selection.proposed_narrowing;
  const capabilities = proposed?.capabilities ?? ["repository_read", "local_write", "command_execute"];
  const requiredCapabilities = ["repository_read", "local_write", "command_execute"];
  if (capabilities.some((capability) => !requiredCapabilities.includes(capability))) {
    throw new Error("policy narrowing widens local-change@1 capabilities");
  }
  if (requiredCapabilities.some((capability) => !capabilities.includes(capability))) {
    throw new Error("policy narrowing removes a required local-change@1 capability");
  }
  const narrowedBudget = { ...budget, ...(proposed?.budget ?? {}), ...budgetOverride };
  for (const [field, value] of Object.entries(narrowedBudget)) {
    if (value > budget[field]) throw new Error(`policy narrowing widens ${field}`);
  }
  return {
    preset: "local-change@1",
    preset_defaults: {
      capabilities: ["repository_read", "local_write", "command_execute"],
      budget,
      evidence_expectations: ["validated worker Result", "typed command execution evidence", "canonical Output Snapshot"],
      verification_expectations: ["fresh independent verifier Review", "snapshot equality before Receipt"],
      completion_conditions: ["compare-and-swap Promotion", "Receipt on unchanged verified snapshot"],
    },
    capabilities,
    proposed_narrowing: proposed,
    admitted_narrowing: proposed || Object.keys(budgetOverride).length > 0
      ? {
        ...(proposed ?? {}),
        ...(Object.keys(budgetOverride).length > 0 ? { budget: narrowedBudget } : {}),
      }
      : null,
    deviations: [],
    rationale: request.preset_selection.rationale,
  };
}

function commandSpec(targetFile, expectedContent) {
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

function runCommand(workspace, command) {
  const result = spawnSync(command.argv[0], command.argv.slice(1), {
    cwd: workspace,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    timeout: command.timeout_seconds * 1_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const execution = {
    command_id: command.command_id,
    argv: command.argv,
    cwd: command.cwd,
    outcome: result.error?.code === "ETIMEDOUT"
      ? "timed_out" : result.status === 0 ? "succeeded" : "failed",
    ...(result.status !== null && result.status !== undefined ? { exit_code: result.status } : {}),
    output_digest: digest(output),
    environment_policy_id: environmentPolicyId,
  };
  validateProtocol({
    schema_version: "1.0",
    kind: "runtime_observation",
    artifact_id: "command-check",
    run_id: "command-check",
    producer: runtimeProducer(),
    input_refs: [],
    created_at: now(),
    attempt_id: "command-check",
    role: "planner",
    opencode_version: "test",
    configuration_digest: digest("config"),
    session_id: "session-check",
    agent_identity: "agent-check",
    message_ids: [],
    agent: "kernel-runner",
    runtime_permission_events: [],
    command_executions: [execution],
    observed_changes: [],
    observed_output_snapshot: digest("snapshot"),
    external_reads: [],
    exit_reason: "idle",
  }, "command execution");
  if (execution.outcome !== "succeeded") {
    throw new Error(`admitted command failed: ${JSON.stringify(execution)}`);
  }
  return execution;
}

function makeRequestArtifact({ runId, request, requestRef, runtimeRef, actorId, bootstrapRef }) {
  return envelope({
    kind: "request",
    artifactId: "request-1",
    runId,
    producer: plannerProducer(actorId),
    runtime_ref: runtimeRef,
    inputRefs: [bootstrapRef],
    createdAt: now(),
    ...request,
  });
}

function implementationPlan(parsed, {
  targetFile,
  skill,
  command,
  requestText,
  attemptDeadlineSeconds = m1AttemptDeadlineSeconds,
}) {
  const node = parsed.graph?.nodes?.[0] ?? parsed.nodes?.[0];
  const packet = parsed.packet ?? parsed.implementation_packet;
  if (!node || !packet) throw new Error("planner graph revision 1 omitted the implementation Packet");
  if (node.workflow_definition !== "implementation") throw new Error("revision 1 node is not implementation");
  return {
    node: {
      task_id: "implementation-1",
      workflow_definition: "implementation",
      requires: [],
      read_resources: Array.isArray(node.read_resources) ? node.read_resources : [],
      write_resources: [targetFile],
    },
    packet: {
      objective: typeof packet.objective === "string" && packet.objective.length > 0
        ? packet.objective : requestText,
      acceptance_criteria: validStringArray(packet.acceptance_criteria ?? ["the declared local change is present"], "Packet acceptance_criteria"),
      allowed_resources: [targetFile],
      forbidden_resources: Array.isArray(packet.forbidden_resources) ? packet.forbidden_resources : [".git"],
      skills: [skill],
      capabilities: ["repository_read", "local_write", "command_execute"],
      admitted_commands: [command],
      deadline_seconds: Math.min(attemptDeadlineSeconds, Number.isSafeInteger(packet.deadline_seconds)
        && packet.deadline_seconds > 0 ? packet.deadline_seconds : attemptDeadlineSeconds),
      escalation_condition: typeof packet.escalation_condition === "string" && packet.escalation_condition.length > 0
        ? packet.escalation_condition : "stop on an undeclared change or unavailable dependency",
    },
  };
}

function verificationPlan(parsed, {
  targetFile,
  requestText,
  attemptDeadlineSeconds = m1AttemptDeadlineSeconds,
}) {
  const plan = parsed.verifier_task ?? parsed.task;
  const packet = parsed.verifier_packet ?? parsed.packet;
  if (!plan || !packet) throw new Error("planner graph revision 2 omitted the verifier Packet");
  return {
    task: {
      task_id: "verification-1",
      workflow_definition: "verification",
      requires: ["implementation-1"],
      read_resources: [targetFile],
      write_resources: [],
    },
    packet: {
      objective: typeof packet.objective === "string" && packet.objective.length > 0
        ? packet.objective : `Independently verify ${requestText}`,
      acceptance_criteria: validStringArray(packet.acceptance_criteria ?? ["the Output Snapshot matches the Result"], "Verifier acceptance_criteria"),
      allowed_resources: [targetFile],
      forbidden_resources: Array.isArray(packet.forbidden_resources) ? packet.forbidden_resources : [".git"],
      skills: [],
      capabilities: ["repository_read"],
      admitted_commands: [],
      deadline_seconds: Math.min(attemptDeadlineSeconds, Number.isSafeInteger(packet.deadline_seconds)
        && packet.deadline_seconds > 0 ? packet.deadline_seconds : attemptDeadlineSeconds),
      escalation_condition: typeof packet.escalation_condition === "string" && packet.escalation_condition.length > 0
        ? packet.escalation_condition : "block if the target snapshot or declared change is not verifiable",
    },
  };
}

function makePacket({ runId, graphRevision, taskId, packet, runtimeRef, artifactId, targetTaskRef, targetSnapshot, actorId }) {
  return envelope({
    kind: "packet",
    artifactId,
    runId,
    graph_revision: graphRevision,
    task_id: taskId,
    producer: plannerProducer(actorId ?? "planner-m1"),
    runtime_ref: runtimeRef,
    inputRefs: [],
    createdAt: now(),
    role: taskId.startsWith("verification") ? "verifier" : "worker",
    workflow_definition: taskId.startsWith("verification") ? "verification" : "implementation",
    ...packet,
    ...(targetTaskRef ? { target_task_ref: targetTaskRef } : {}),
    ...(targetSnapshot ? { target_snapshot: targetSnapshot } : {}),
  });
}

function makeGraph({ runId, graphRevision, runtimeRef, requestRef, triggerRef, parentRef, nodes, inputRefs, actorId }) {
  return envelope({
    kind: "graph",
    artifactId: `graph-${graphRevision}`,
    runId,
    graph_revision: graphRevision,
    producer: plannerProducer(actorId ?? "planner-m1"),
    runtime_ref: runtimeRef,
    inputRefs: inputRefs ?? [requestRef],
    createdAt: now(),
    ...(parentRef ? { parent_revision_ref: parentRef } : {}),
    trigger_ref: triggerRef,
    nodes,
  });
}

function parseReview(parsed) {
  if (parsed.verdict !== "pass" || !Array.isArray(parsed.findings) || parsed.findings.length > 0) {
    throw new Error("verifier did not propose an independent pass with no findings");
  }
  return {
    verdict: "pass",
    findings: [],
    evidence: validEvidenceArray(parsed.evidence ?? [{
      claim: "the declared change is present and the snapshot is unchanged",
      source: "verification",
      observation: "fresh verifier inspection completed",
    }]),
  };
}

export class AttemptFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AttemptFailure";
    this.code = code;
  }
}

export class BudgetExceeded extends Error {
  constructor(kind, limit) {
    super(`${kind} budget exhausted at ${limit}`);
    this.name = "BudgetExceeded";
    this.code = "budget_exceeded";
    this.kind = kind;
    this.limit = limit;
  }
}

export function admitBudget(state, kind) {
  const limits = {
    planner_attempt: [
      state.runtime_bindings.filter(({ role }) => role === "planner").length,
      state.budget.max_planner_attempts,
    ],
    execution_attempt: [
      state.runtime_bindings.filter(({ role }) => role === "worker" || role === "verifier").length,
      state.budget.max_execution_attempts,
    ],
    graph_revision: [
      state.transitions.filter(({ event_kind }) => event_kind.startsWith("graph_revision_")).length,
      state.budget.max_graph_revisions,
    ],
  };
  const [used, limit] = limits[kind] ?? [];
  if (used === undefined) throw new Error(`unknown budget admission point: ${kind}`);
  if (used >= limit) throw new BudgetExceeded(kind, limit);
  return { used, limit };
}

function admitAttemptExecution(ctx, execution, label) {
  if (!execution?.observation) throw new AttemptFailure("missing_runtime_observation", `${label} produced no Runtime Observation`);
  if (execution.attempt_failed || execution.stop_confirmed === false
    || execution.observation.exit_reason !== "idle") {
    writeArtifact(ctx, `artifacts/runtime/${execution.observation.artifact_id}.json`, execution.observation);
    throw new AttemptFailure(
      execution.stop_confirmed === false ? "cancel_unconfirmed" : execution.observation.exit_reason,
      `${label} did not reach a confirmed idle stop`,
    );
  }
  if (!execution.snapshot) throw new AttemptFailure("missing_output_snapshot", `${label} produced no Output Snapshot`);
  return execution;
}

async function recordFailure(ctx, state, error) {
  let durableState = state;
  try {
    durableState = JSON.parse(readFileSync(join(ctx.runDir, "run.json"), "utf8"));
  } catch {
    // Preserve the original failure when the Run State has not been published yet.
  }
  if (!durableState
    || ["cancelling", "cancelled", "material_decision_required"].includes(durableState.lifecycle_state)
    || existsSync(join(ctx.runDir, "artifacts/outcomes/failure.json"))) return;
  const outcome = envelope({
    kind: "outcome",
    artifactId: "outcome-failure",
    runId: ctx.runId,
    producer: kernelProducer(),
    inputRefs: [...ctx.admittedRefs],
    createdAt: now(),
    preset: "local-change@1",
    ...(state.effective_policy ? { effective_policy: state.effective_policy } : {}),
    outcome_kind: "block",
    summary: `Run blocked: ${error.message}`,
    artifact_refs: [...ctx.admittedRefs],
    limitations: ["No Result, Promotion, or Receipt is published after this blocked Attempt."],
    block_type: error.code ?? error.name ?? "runtime_error",
    resume_condition: "A new bounded Run must re-admit the request after the blocking condition is resolved.",
  });
  const outcomeRef = writeArtifact(ctx, "artifacts/outcomes/failure.json", outcome);
  applyTransition(ctx, durableState, "run_blocked", { lifecycle_state: "blocked" }, [outcomeRef]);
}

function runtimeArtifacts(runDir) {
  const runtimeDir = join(runDir, "artifacts/runtime");
  if (!existsSync(runtimeDir)) return [];
  return readdirSync(runtimeDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(runtimeDir, file), "utf8")));
}

function runtimeForBinding(runDir, binding) {
  return runtimeArtifacts(runDir)
    .filter((observation) => observation.session_id === binding.session_id)
    .at(-1);
}

function cancellationBlock(ctx, state, observationRef) {
  const outcome = envelope({
    kind: "outcome",
    artifactId: "outcome-cancel",
    runId: ctx.runId,
    producer: kernelProducer(),
    inputRefs: [...ctx.admittedRefs, observationRef],
    createdAt: now(),
    preset: state.effective_policy?.preset ?? "local-change@1",
    ...(state.effective_policy ? { effective_policy: state.effective_policy } : {}),
    outcome_kind: "block",
    summary: "Run cancellation was requested but the runtime stop could not be confirmed.",
    artifact_refs: [...ctx.admittedRefs, observationRef],
    limitations: ["The active Attempt remains unresolved; no successor Attempt may be dispatched into this workspace."],
    block_type: "cancel_unconfirmed",
    resume_condition: "Reconcile the active runtime binding and confirm its stop before any future continuation.",
  });
  return writeArtifact(ctx, "artifacts/outcomes/cancel.json", outcome);
}

export async function cancelRun(runDir, { runtime, hooks = {} } = {}) {
  runDir = resolve(runDir);
  const statePath = join(runDir, "run.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  validateProtocol(state, "run state");
  resolveArtifactReferences({ runDir }, state);
  const inspect = inspectRun(runDir);
  if (["completed", "cancelled", "blocked"].includes(state.lifecycle_state)) {
    return { ...inspect, next_action: null };
  }

  const ctx = { runDir, runId: state.run_id, admittedRefs: [], hooks };
  const active = [...state.runtime_bindings].reverse().find(({ binding_state }) => binding_state === "active");
  let next = applyTransition(ctx, state, "cancel_requested", { lifecycle_state: "cancelling" });
  crashAt(ctx, "before_runtime_abort");

  let result;
  if (runtime?.cancelAttempt && active) {
    result = await runtime.cancelAttempt({ binding: active, runDir });
  } else {
    result = { confirmed: false };
  }
  crashAt(ctx, "after_runtime_abort");

  const observation = result?.observation ?? (active && runtimeForBinding(runDir, active)
    ? {
      ...runtimeForBinding(runDir, active),
      artifact_id: `runtime-${active.attempt_id}-cancel`,
      runtime_permission_events: ["operator.cancel"],
      exit_reason: result?.confirmed ? "cancelled" : "cancel_unconfirmed",
    }
    : null);
  if (!observation) {
    const error = new AttemptFailure("cancel_unconfirmed", "no active runtime binding could confirm cancellation");
    await recordFailure(ctx, next, error);
    return { ...inspectRun(runDir), next_action: null, checkpoint: "cancel_unconfirmed" };
  }
  const observationRef = writeArtifact(ctx, `artifacts/runtime/${observation.artifact_id}.json`, observation);
  if (result?.confirmed === true && observation.exit_reason === "cancelled") {
    next = applyTransition(ctx, next, "cancel_confirmed", {
      lifecycle_state: "cancelled",
      runtime_bindings: next.runtime_bindings.map((binding) => binding.attempt_id === active?.attempt_id
        ? { ...binding, binding_state: "cancelled" } : binding),
    }, [observationRef]);
    return { ...inspectRun(runDir), next_action: null };
  }
  const blockRef = cancellationBlock(ctx, next, observationRef);
  next = applyTransition(ctx, next, "cancel_unconfirmed", {
    lifecycle_state: "blocked",
    runtime_bindings: next.runtime_bindings.map((binding) => binding.attempt_id === active?.attempt_id
      ? { ...binding, binding_state: "unreachable" } : binding),
  }, [observationRef, blockRef]);
  return { ...inspectRun(runDir), next_action: null, checkpoint: "cancel_unconfirmed" };
}

function resultRefOid(resultRepo, resultRef) {
  return git(resultRepo, ["rev-parse", "--verify", resultRef]).trim();
}

function snapshotFromResultRef(resultRepo, resultRef) {
  const base = resultRefOid(resultRepo, resultRef);
  const records = gitRaw(resultRepo, ["ls-tree", "-r", "-z", base]).toString("utf8").split("\0").filter(Boolean);
  const entries = records.map((record) => {
    const [metadata, path] = record.split("\t");
    const [mode, type] = metadata.split(" ");
    if (type !== "blob") throw new Error(`Result Ref contains unsupported tree entry: ${path}`);
    const content = gitRaw(resultRepo, ["show", `${base}:${path}`]);
    if (mode === "120000") {
      const target = content.toString("utf8");
      return { path, mode, target, content_digest: digest(target) };
    }
    return { path, mode: mode === "100755" ? mode : "100644", content_digest: digest(content) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  return { base, entries, digest: digest({ base, entries }) };
}

function initialRun({ runId, bootstrapRef, idempotencyKey, binding, workspaceBaseline, executionContext, runBudget = budget }) {
  return envelope({
    kind: "run",
    artifactId: "run-state",
    runId,
    producer: kernelProducer(),
    inputRefs: [],
    createdAt: now(),
    state_version: 1,
    lifecycle_state: "pre_intake",
    admission_state: "pre_intake",
    bootstrap_ref: bootstrapRef,
    idempotency_key: idempotencyKey,
    workspace_baseline: workspaceBaseline,
    execution_context: executionContext,
    budget: runBudget,
    tasks: {},
    runtime_bindings: [binding],
    transitions: [],
  });
}

function latestOutcome(runDir) {
  const outcomeDir = join(runDir, "artifacts/outcomes");
  if (!existsSync(outcomeDir)) return null;
  const files = readdirSync(outcomeDir).filter((file) => file.endsWith(".json")).sort();
  return files.length === 0 ? null : JSON.parse(readFileSync(join(outcomeDir, files.at(-1))));
}

export function inspectRun(runDir) {
  const state = JSON.parse(readFileSync(join(runDir, "run.json")));
  const outcome = latestOutcome(runDir);
  return {
    run_id: state.run_id,
    state_version: state.state_version,
    lifecycle_state: state.lifecycle_state,
    derived_status: state.lifecycle_state === "completed"
      ? "completed" : state.lifecycle_state,
    receipt: outcome?.outcome_kind === "receipt" ? {
      artifact_id: outcome.artifact_id,
      outcome_kind: outcome.outcome_kind,
      promotion_ref: outcome.promotion_ref,
    } : null,
  };
}

export function resumeRun(runDir) {
  const state = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  validateProtocol(state, "run state");
  resolveArtifactReferences({ runDir }, state);
  const inspect = inspectRun(runDir);
  if (["completed", "cancelled"].includes(state.lifecycle_state)) {
    return { ...inspect, next_action: null };
  }
  return {
    ...inspect,
    next_action: null,
    checkpoint: state.lifecycle_state === "material_decision_required"
      ? "material_decision_required" : "runtime_reconciliation_required",
  };
}

function ensureOutside(workspace, runRoot) {
  for (const [source, target] of [
    [resolve(workspace), resolve(runRoot)],
    ...(existsSync(workspace) && existsSync(runRoot)
      ? [[realpathSync(workspace), realpathSync(runRoot)]] : []),
  ]) {
    const rel = relative(source, target);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      throw new Error("run root must be outside the target workspace");
    }
  }
}

function skillRecord(workspace) {
  const path = join(workspace, skillSource);
  if (!existsSync(path)) throw new Error(`dependency_unavailable: ${skillSource}`);
  const content = readFileSync(path, "utf8");
  const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const version = content.match(/^version:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !version) throw new Error(`dependency_unavailable: invalid ${skillSource}`);
  return { id: name, version, source: skillSource, digest: fileDigest(path) };
}

function parseOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

export async function runLocalChange({
  workspace,
  runRoot,
  requestText,
  targetFile = "change.txt",
  expectedContent = "local change completed\n",
  runtimeFactory,
  hooks = {},
  budgetOverride = {},
}) {
  workspace = resolve(workspace);
  runRoot = resolve(runRoot);
  if (!existsSync(workspace)) throw new Error(`workspace does not exist: ${workspace}`);
  ensureOutside(workspace, runRoot);
  if (!/^[A-Za-z0-9._/-]+$/.test(targetFile) || targetFile.startsWith(".") || targetFile.includes("..")) {
    throw new Error(`invalid target file: ${targetFile}`);
  }
  mkdirSync(runRoot, { recursive: true });
  ensureOutside(workspace, runRoot);
  const runId = `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const runDir = join(runRoot, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const baselineBranch = git(workspace, ["branch", "--show-current"]).trim();
  const baselineTarget = workspaceSnapshot(workspace);
  const baselineStatus = gitStatus(workspace);
  const workspaceBaseline = {
    branch: baselineBranch,
    head: baselineTarget.base,
    status_digest: digest(Buffer.from(baselineStatus)),
    snapshot_digest: baselineTarget.digest,
    protected_paths: dirtyPaths(workspace),
  };
  if (baselineTarget.entries.some(({ path }) => path === targetFile)) {
    throw new Error(`target file already exists in the intake snapshot: ${targetFile}`);
  }
  const skill = skillRecord(workspace);
  const taskWorkspace = mkdtempSync(join(runDir, "task-workspace-"));
  let adapter;
  let state;
  const runBudget = { ...budget, ...budgetOverride };
  for (const [field, value] of Object.entries(runBudget)) {
    if (!Number.isSafeInteger(value) || value < 0 || value > budget[field]) {
      throw new Error(`invalid budget narrowing: ${field}=${value}`);
    }
  }
  const ctx = { runDir, runId, admittedRefs: [], hooks };
  try {
    cloneWorkspace(workspace, taskWorkspace);
    const taskBaseline = workspaceSnapshot(taskWorkspace);
    if (taskBaseline.digest !== baselineTarget.digest) {
      throw new Error("isolated task workspace did not reproduce the intake snapshot");
    }
    adapter = runtimeFactory
      ? await runtimeFactory({
        workspace: taskWorkspace,
        runDir,
        baselineSnapshot: taskBaseline,
        targetFile,
        expectedContent,
        requestText,
        runId,
      })
      : new OpenCodeAdapter({
        workspace: taskWorkspace,
        runDir,
        baselineSnapshot: taskBaseline,
        targetFile,
      });
    const admittedAttemptDeadlineSeconds = adapter.attemptDeadlineSeconds ?? m1AttemptDeadlineSeconds;
    if (!Number.isSafeInteger(admittedAttemptDeadlineSeconds) || admittedAttemptDeadlineSeconds < 1) {
      throw new Error(`invalid Attempt deadline: ${admittedAttemptDeadlineSeconds}`);
    }
    adapter.runId = runId;
    await adapter.start();

    const requestAttempt = await adapter.newAttempt({
      role: "planner",
      attemptId: "planner-request",
      attempt: 1,
    });
    const bootstrapObservation = adapter.preflightObservation({
      attemptId: "planner-request",
      role: "planner",
      binding: requestAttempt.binding,
      artifactId: "runtime-bootstrap",
    });
    const bootstrapRuntimeRef = writeArtifact(ctx, "artifacts/runtime/bootstrap.json", bootstrapObservation);
    const bootstrap = envelope({
      kind: "bootstrap_envelope",
      artifactId: "bootstrap-1",
      runId,
      producer: kernelProducer(),
      inputRefs: [],
      createdAt: now(),
      runtime_ref: bootstrapRuntimeRef,
      role: "planner",
      workflow_definition: "intake",
      raw_request: requestText,
      repository_policy_refs: [],
      capabilities: ["repository_read"],
      admitted_commands: [],
      deadline_seconds: admittedAttemptDeadlineSeconds,
      idempotency_key: `bootstrap-${runId}`,
    });
    const bootstrapRef = writeArtifact(ctx, "artifacts/bootstrap/bootstrap-1.json", bootstrap);
    state = initialRun({
      runId,
      bootstrapRef,
      idempotencyKey: bootstrap.idempotency_key,
      binding: requestAttempt.binding,
      workspaceBaseline,
      executionContext: { target_file: targetFile, expected_content: expectedContent, request_text: requestText },
      runBudget,
    });
    writeRunState(ctx, state);

    const requestPrompt = [
      "Return exactly one JSON object and no Markdown for the Request proposal. Do not inspect or read any file and do not use any tool; all intake facts are below.",
      `Raw human request: ${requestText}`,
      `Target snapshot digest: ${taskBaseline.digest}`,
      "Select local-change@1 with no proposed narrowing.",
      "Use this shape: {\"objective\":\"...\",\"scope\":[\"...\"],\"exclusions\":[\"...\"],\"ambiguities\":[],\"assumptions\":[],\"target_snapshot\":\"...\",\"preset_selection\":{\"preset\":\"local-change@1\",\"selection_evidence\":[{\"claim\":\"...\",\"source\":\"intake\",\"observation\":\"...\"}],\"proposed_narrowing\":null,\"rationale\":\"...\"}}",
    ].join("\n");
    const requestExecution = await adapter.execute({
      role: "planner",
      attemptId: "planner-request",
      attempt: 1,
      binding: requestAttempt.binding,
      prompt: requestPrompt,
      beforeSnapshot: taskBaseline,
      deadlineSeconds: bootstrap.deadline_seconds,
    });
    admitAttemptExecution(ctx, requestExecution, "Request planner Attempt");
    const requestRuntime = requestExecution.observation;
    const requestRuntimeRef = writeArtifact(ctx, "artifacts/runtime/planner-request.json", requestRuntime);
    const request = requestProposal(responseObject(requestExecution.text, "Request planner"), {
      requestText,
      targetSnapshot: taskBaseline.digest,
    });
    const requestArtifact = makeRequestArtifact({
      runId,
      request,
      requestRef: null,
      runtimeRef: requestRuntimeRef,
      actorId: requestAttempt.binding.agent_identity,
      bootstrapRef,
    });
    const requestRef = writeArtifact(ctx, "artifacts/request.json", requestArtifact);
    const effectivePolicy = {
      ...policyFor(request, budgetOverride),
      preset_selection_ref: requestRef,
    };
    state = applyTransition(ctx, state, "request_admitted", {
      lifecycle_state: "active",
      admission_state: "admitted",
      request_ref: requestRef,
      effective_policy: effectivePolicy,
      budget: runBudget,
      runtime_bindings: [requestExecution.binding],
    }, [requestRef, requestRuntimeRef]);

    admitBudget(state, "planner_attempt");
    admitBudget(state, "graph_revision");
    const graphOneAttempt = await adapter.newAttempt({
      role: "planner",
      attemptId: "planner-graph-1",
      attempt: 2,
    });
    const graphOnePrompt = [
      "Return exactly one JSON object and no Markdown for graph revision 1 and its implementation Packet. Do not inspect or read any file and do not use any tool; the kernel already supplied the skill record.",
      `Implement the single file ${targetFile} for this objective: ${request.objective}`,
      `Return graph.nodes[0].task_id=implementation-1, workflow_definition=implementation, and a Packet that names skill ${skill.id}@${skill.version} and command verify-change.`,
      "Use this shape: {\"graph\":{\"nodes\":[{\"task_id\":\"implementation-1\",\"workflow_definition\":\"implementation\",\"requires\":[],\"read_resources\":[],\"write_resources\":[\"target\"]}]},\"packet\":{\"objective\":\"...\",\"acceptance_criteria\":[\"...\"],\"allowed_resources\":[\"target\"],\"forbidden_resources\":[\".git\"],\"skills\":[{\"id\":\"m1-local-change\",\"version\":\"1\",\"source\":\".opencode/skills/m1-local-change/SKILL.md\",\"digest\":\"...\"}],\"capabilities\":[\"repository_read\",\"local_write\",\"command_execute\"],\"admitted_commands\":[{\"command_id\":\"verify-change\",\"argv\":[],\"cwd\":\".\",\"timeout_seconds\":10}],\"deadline_seconds\":300,\"escalation_condition\":\"...\"}}",
    ].join("\n");
    const graphOneExecution = await adapter.execute({
      role: "planner",
      attemptId: "planner-graph-1",
      attempt: 2,
      binding: graphOneAttempt.binding,
      prompt: graphOnePrompt,
      beforeSnapshot: taskBaseline,
      deadlineSeconds: admittedAttemptDeadlineSeconds,
    });
    admitAttemptExecution(ctx, graphOneExecution, "graph revision 1 planner Attempt");
    const graphOneRuntimeRef = writeArtifact(ctx, "artifacts/runtime/planner-graph-1.json", graphOneExecution.observation);
    const implementation = implementationPlan(responseObject(graphOneExecution.text, "revision 1 planner"), {
      targetFile,
      skill,
      command: commandSpec(targetFile, expectedContent),
      requestText,
      attemptDeadlineSeconds: admittedAttemptDeadlineSeconds,
    });
    const implementationPacket = makePacket({
      runId,
      graphRevision: 1,
      taskId: "implementation-1",
      packet: implementation.packet,
      runtimeRef: graphOneRuntimeRef,
      artifactId: "packet-implementation-1",
      actorId: graphOneAttempt.binding.agent_identity,
    });
    const implementationPacketRef = writeArtifact(ctx, "artifacts/tasks/implementation-1/attempts/1/packet.json", implementationPacket);
    const graphOne = makeGraph({
      runId,
      graphRevision: 1,
      runtimeRef: graphOneRuntimeRef,
      requestRef,
      triggerRef: requestRef,
      nodes: [{ ...implementation.node, packet_ref: implementationPacketRef }],
      actorId: graphOneAttempt.binding.agent_identity,
    });
    const graphOneRef = writeArtifact(ctx, "artifacts/graphs/0001.json", graphOne);
    state = applyTransition(ctx, state, "graph_revision_1_admitted", {
      active_graph_ref: graphOneRef,
      runtime_bindings: [requestExecution.binding, graphOneExecution.binding],
      tasks: {
        "implementation-1": { task_state: "planned", attempts: 0 },
      },
    }, [graphOneRef, implementationPacketRef, graphOneRuntimeRef]);

    admitBudget(state, "execution_attempt");
    const workerAttempt = await adapter.newAttempt({
      role: "worker",
      attemptId: "worker-implementation-1",
      taskId: "implementation-1",
      attempt: 1,
    });
    state = applyTransition(ctx, state, "implementation_dispatched", {
      runtime_bindings: [...state.runtime_bindings, workerAttempt.binding],
      tasks: {
        "implementation-1": { task_state: "active", attempts: 1 },
      },
    }, [implementationPacketRef]);
    await hooks.afterWorkerDispatch?.({ runDir, runId, state, adapter, binding: workerAttempt.binding });
    state = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
    if (state.lifecycle_state !== "active") {
      return { run_id: runId, run_dir: runDir, inspect: inspectRun(runDir), checkpoint: state.lifecycle_state };
    }
    const workerPrompt = [
      `Implement the admitted local-change Packet. Modify exactly ${targetFile}.`,
      `Create it with exactly this UTF-8 content: ${JSON.stringify(expectedContent)}.`,
      "Do not modify protected unrelated files, the Git metadata, the skill file, or any other path.",
      "Use your edit/write tool, never shell or network. After editing, report what changed in plain text.",
    ].join("\n");
    const workerExecution = await adapter.execute({
      role: "worker",
      attemptId: "worker-implementation-1",
      taskId: "implementation-1",
      attempt: 1,
      binding: workerAttempt.binding,
      prompt: workerPrompt,
      beforeSnapshot: taskBaseline,
      deadlineSeconds: implementation.packet.deadline_seconds,
    });
    admitAttemptExecution(ctx, workerExecution, "implementation worker Attempt");
    const commandExecution = runCommand(taskWorkspace, commandSpec(targetFile, expectedContent));
    const preCommitSnapshot = workspaceSnapshot(taskWorkspace);
    const workerChanges = diffEntries(taskBaseline, preCommitSnapshot);
    const allowedChanges = new Set([targetFile]);
    if (workerChanges.length === 0 || workerChanges.some(({ path }) => !allowedChanges.has(path))) {
      throw new Error(`worker diff violates Packet resources: ${JSON.stringify(workerChanges)}`);
    }
    git(taskWorkspace, ["add", "-A"]);
    git(taskWorkspace, ["commit", "-qm", "M1 local-change Result"]);
    const resultCommit = git(taskWorkspace, ["rev-parse", "HEAD"]).trim();
    const workerSnapshot = workspaceSnapshot(taskWorkspace);
    const workerObservation = {
      ...workerExecution.observation,
      observed_changes: workerChanges,
      observed_output_snapshot: workerSnapshot.digest,
      command_executions: [commandExecution],
    };
    const workerRuntimeRef = writeArtifact(ctx, "artifacts/runtime/worker-implementation-1.json", workerObservation);
    const workerResult = envelope({
      kind: "result",
      artifactId: "result-implementation-1",
      runId,
      graph_revision: 1,
      task_id: "implementation-1",
      attempt: 1,
      producer: workerProducer(workerAttempt.binding.agent_identity),
      runtime_ref: workerRuntimeRef,
      inputRefs: [implementationPacketRef],
      createdAt: now(),
      claims: [workerExecution.text || `created ${targetFile}`],
      evidence: [{
        claim: "the admitted command confirmed the requested file content",
        source: `command:${commandExecution.command_id}`,
        observation: "kernel runner returned succeeded",
        command_ref: {
          kind: "command_execution",
          runtime_ref: workerRuntimeRef,
          command_id: commandExecution.command_id,
          output_digest: commandExecution.output_digest,
        },
      }],
      changed_resources: workerChanges.map(({ path }) => path),
      output_snapshot: workerSnapshot.digest,
    });
    await hooks.beforeResultAdmission?.({ workerResult });
    const resultRef = writeArtifact(ctx, "artifacts/tasks/implementation-1/attempts/1/result.json", workerResult);
    state = applyTransition(ctx, state, "implementation_result_admitted", {
      runtime_bindings: state.runtime_bindings.map((binding) =>
        binding.attempt_id === workerExecution.binding.attempt_id ? workerExecution.binding : binding),
      tasks: {
        "implementation-1": { task_state: "artifacts_published", attempts: 1, artifact_ref: resultRef },
      },
    }, [workerRuntimeRef, resultRef]);

    admitBudget(state, "planner_attempt");
    admitBudget(state, "graph_revision");
    const graphTwoAttempt = await adapter.newAttempt({
      role: "planner",
      attemptId: "planner-graph-2",
      attempt: 3,
    });
    const graphTwoPrompt = [
      "Return exactly one JSON object and no Markdown for graph revision 2. Do not inspect or read any file and do not use any tool; the kernel already supplied the Result ref.",
      "Carry forward implementation-1 by its Result ref and add exactly one independent verification task.",
      "Use this shape: {\"carry_forward_task_id\":\"implementation-1\",\"verifier_task\":{\"task_id\":\"verification-1\",\"workflow_definition\":\"verification\",\"requires\":[\"implementation-1\"],\"read_resources\":[\"target\"],\"write_resources\":[]},\"verifier_packet\":{\"objective\":\"...\",\"acceptance_criteria\":[\"...\"],\"allowed_resources\":[\"target\"],\"forbidden_resources\":[\".git\"],\"capabilities\":[\"repository_read\"],\"admitted_commands\":[],\"deadline_seconds\":300,\"escalation_condition\":\"...\"}}",
    ].join("\n");
    const graphTwoExecution = await adapter.execute({
      role: "planner",
      attemptId: "planner-graph-2",
      attempt: 3,
      binding: graphTwoAttempt.binding,
      prompt: graphTwoPrompt,
      beforeSnapshot: workerSnapshot,
      deadlineSeconds: admittedAttemptDeadlineSeconds,
    });
    admitAttemptExecution(ctx, graphTwoExecution, "graph revision 2 planner Attempt");
    const graphTwoRuntimeRef = writeArtifact(ctx, "artifacts/runtime/planner-graph-2.json", graphTwoExecution.observation);
    const verification = verificationPlan(responseObject(graphTwoExecution.text, "revision 2 planner"), {
      targetFile,
      requestText,
      attemptDeadlineSeconds: admittedAttemptDeadlineSeconds,
    });
    const verificationPacket = makePacket({
      runId,
      graphRevision: 2,
      taskId: "verification-1",
      packet: verification.packet,
      runtimeRef: graphTwoRuntimeRef,
      artifactId: "packet-verification-1",
      targetTaskRef: resultRef,
      targetSnapshot: workerSnapshot.digest,
      actorId: graphTwoAttempt.binding.agent_identity,
    });
    const verificationPacketRef = writeArtifact(ctx, "artifacts/tasks/verification-1/attempts/1/packet.json", verificationPacket);
    const graphTwo = makeGraph({
      runId,
      graphRevision: 2,
      runtimeRef: graphTwoRuntimeRef,
      requestRef,
      triggerRef: resultRef,
      parentRef: graphOneRef,
      inputRefs: [requestRef, graphOneRef, resultRef],
      nodes: [
        { ...implementation.node, packet_ref: implementationPacketRef },
        { ...verification.task, packet_ref: verificationPacketRef },
      ],
      actorId: graphTwoAttempt.binding.agent_identity,
    });
    const graphTwoRef = writeArtifact(ctx, "artifacts/graphs/0002.json", graphTwo);
    state = applyTransition(ctx, state, "graph_revision_2_admitted", {
      active_graph_ref: graphTwoRef,
      runtime_bindings: [...state.runtime_bindings, graphTwoExecution.binding],
      tasks: {
        ...state.tasks,
        "verification-1": { task_state: "planned", attempts: 0 },
      },
    }, [graphTwoRef, verificationPacketRef, graphTwoRuntimeRef, resultRef]);

    admitBudget(state, "execution_attempt");
    const verifierAttempt = await adapter.newAttempt({
      role: "verifier",
      attemptId: "verifier-1",
      taskId: "verification-1",
      attempt: 1,
    });
    if (verifierAttempt.binding.agent_identity === workerAttempt.binding.agent_identity) {
      throw new Error("verifier_not_independent");
    }
    state = applyTransition(ctx, state, "verification_dispatched", {
      runtime_bindings: [...state.runtime_bindings, verifierAttempt.binding],
      tasks: {
        ...state.tasks,
        "verification-1": { task_state: "active", attempts: 1 },
      },
    }, [verificationPacketRef]);
    const verifierPrompt = [
      `Use your read tool exactly once on ${targetFile}; do not read any other path and do not use edit, write, shell, network, or delegation.`,
      `The expected UTF-8 content is ${JSON.stringify(expectedContent)}.`,
      `Independently inspect the frozen Result/Output Snapshot: Result ref ${resultRef.path} (${resultRef.digest}), declared output snapshot ${workerSnapshot.digest}, changed resource ${targetFile}.`,
      "After the read, do not call another tool. Your final response MUST be exactly one JSON object and no Markdown, with this shape: {\"verdict\":\"pass\",\"findings\":[],\"evidence\":[{\"claim\":\"the declared change is present\",\"source\":\"verifier-read\",\"observation\":\"the named target bytes match the frozen Result Output Snapshot\"}]}",
    ].join("\n");
    const verifierExecution = await adapter.execute({
      role: "verifier",
      attemptId: "verifier-1",
      taskId: "verification-1",
      attempt: 1,
      binding: verifierAttempt.binding,
      prompt: verifierPrompt,
      beforeSnapshot: workerSnapshot,
      deadlineSeconds: verification.packet.deadline_seconds,
    });
    admitAttemptExecution(ctx, verifierExecution, "independent verifier Attempt");
    const observedVerifierSnapshot = workspaceSnapshot(taskWorkspace);
    if (observedVerifierSnapshot.digest !== workerSnapshot.digest) {
      throw new Error(`Output Snapshot changed during verification: ${JSON.stringify(diffEntries(workerSnapshot, observedVerifierSnapshot))}`);
    }
    verifierExecution.snapshot = observedVerifierSnapshot;
    verifierExecution.changes = diffEntries(workerSnapshot, observedVerifierSnapshot);
    verifierExecution.observation = {
      ...verifierExecution.observation,
      observed_changes: verifierExecution.changes,
      observed_output_snapshot: observedVerifierSnapshot.digest,
    };
    const verifierRuntimeRef = writeArtifact(ctx, "artifacts/runtime/verifier-1.json", verifierExecution.observation);
    const reviewProposal = parseReview(responseObject(verifierExecution.text, "verifier"));
    const review = envelope({
      kind: "review",
      artifactId: "review-verification-1",
      runId,
      graph_revision: 2,
      task_id: "verification-1",
      attempt: 1,
      producer: verifierProducer(verifierAttempt.binding.agent_identity),
      runtime_ref: verifierRuntimeRef,
      inputRefs: [verificationPacketRef, resultRef],
      createdAt: now(),
      target_task_ref: resultRef,
      target_snapshot: workerSnapshot.digest,
      verdict: reviewProposal.verdict,
      evidence: reviewProposal.evidence,
      findings: reviewProposal.findings,
    });
    const reviewRef = writeArtifact(ctx, "artifacts/tasks/verification-1/attempts/1/review.json", review);
    state = applyTransition(ctx, state, "review_admitted", {
      runtime_bindings: state.runtime_bindings.map((binding) =>
        binding.attempt_id === verifierExecution.binding.attempt_id ? verifierExecution.binding : binding),
      tasks: {
        ...state.tasks,
        "verification-1": { task_state: "artifacts_published", attempts: 1, artifact_ref: reviewRef },
      },
    }, [verifierRuntimeRef, reviewRef]);

    const resultRepo = join(runDir, "result-repository.git");
    git(runDir, ["init", "--bare", "-q", resultRepo]);
    git(resultRepo, ["fetch", "-q", taskWorkspace, resultCommit]);
    const resultRefName = `refs/orchestrator/results/${runId}`;
    git(resultRepo, ["update-ref", resultRefName, resultCommit, ""]);
    await hooks.afterResultRefCas?.({ resultRepo, resultRefName, resultCommit, taskWorkspace });
    const promotedRefOid = resultRefOid(resultRepo, resultRefName);
    if (promotedRefOid !== resultCommit) throw new Error("result_ref_drift");
    const promotedSnapshot = snapshotFromResultRef(resultRepo, resultRefName).digest;
    if (promotedSnapshot !== workerSnapshot.digest) {
      throw new Error("Promotion snapshot mismatch");
    }
    const promotion = envelope({
      kind: "promotion",
      artifactId: "promotion-1",
      runId,
      producer: kernelProducer(),
      inputRefs: [resultRef, reviewRef],
      createdAt: now(),
      verified_snapshot: workerSnapshot.digest,
      result_ref: resultRefName,
      expected_ref_oid: null,
      promoted_ref_oid: promotedRefOid,
      promoted_resources: [targetFile],
      promoted_snapshot: promotedSnapshot,
    });
    const promotionRef = writeArtifact(ctx, "artifacts/promotions/promotion-1.json", promotion);
    const receipt = envelope({
      kind: "outcome",
      artifactId: "outcome-0001",
      runId,
      producer: kernelProducer(),
      inputRefs: [requestRef, graphOneRef, graphTwoRef, resultRef, reviewRef, promotionRef],
      createdAt: now(),
      preset: "local-change@1",
      effective_policy: effectivePolicy,
      outcome_kind: "receipt",
      summary: "Verified local-change result preserved under the harness-owned Result Ref.",
      artifact_refs: [requestRef, graphOneRef, graphTwoRef, implementationPacketRef, resultRef, verificationPacketRef, reviewRef, promotionRef],
      limitations: ["v1 preserved a harness-owned Result Ref; it did not apply changes to the user branch."],
      accepted_snapshot: workerSnapshot.digest,
      verified_snapshot: workerSnapshot.digest,
      promoted_snapshot: promotedSnapshot,
      promotion_ref: promotionRef,
    });
    const outcomeRef = writeArtifact(ctx, "artifacts/outcomes/0001.json", receipt);
    state = applyTransition(ctx, state, "receipt_admitted", {
      lifecycle_state: "completed",
      active_graph_ref: graphTwoRef,
      runtime_bindings: state.runtime_bindings,
    }, [outcomeRef, promotionRef]);
    writeRunState(ctx, state);
    const finalTarget = workspaceSnapshot(workspace);
    const finalStatus = gitStatus(workspace);
    const finalBranch = git(workspace, ["branch", "--show-current"]).trim();
    if (finalBranch !== baselineBranch
      || finalTarget.digest !== baselineTarget.digest
      || finalStatus !== baselineStatus) {
      throw new Error("user branch/worktree changed during local-change run");
    }
    return {
      run_id: runId,
      run_dir: runDir,
      result_ref: resultRefName,
      promoted_ref_oid: promotedRefOid,
      output_snapshot: workerSnapshot.digest,
      user_workspace_unchanged: true,
      inspect: inspectRun(runDir),
    };
  } catch (error) {
    await recordFailure(ctx, state, error);
    throw error;
  } finally {
    await adapter?.stop();
    rmSync(taskWorkspace, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = ["inspect", "resume"].includes(argv[0]) ? argv[0] : "run";
  const workspace = parseOption(argv, "--workspace");
  const runRoot = parseOption(argv, "--run-root");
  if (!workspace || !runRoot) throw new Error("usage: local-change.mjs run --workspace <dir> --run-root <dir> --request <text>");
  if (command === "inspect" || command === "resume") {
    const runId = parseOption(argv, "--run-id");
    const root = resolve(runRoot);
    const selected = runId ?? (await import("node:fs")).readdirSync(join(root, "runs")).sort().at(-1);
    if (!selected) throw new Error("no Run exists under the run root");
    if (!/^[A-Za-z0-9._-]+$/.test(selected)) throw new Error(`invalid Run id: ${selected}`);
    const runDir = join(root, "runs", selected);
    process.stdout.write(`${JSON.stringify(command === "resume" ? resumeRun(runDir) : inspectRun(runDir), null, 2)}\n`);
    return;
  }
  const requestText = parseOption(argv, "--request", "Add change.txt with the requested local change.");
  const targetFile = parseOption(argv, "--target-file", "change.txt");
  const expectedContent = parseOption(argv, "--content", "local change completed\\n").replaceAll("\\n", "\n");
  const result = await runLocalChange({ workspace, runRoot, requestText, targetFile, expectedContent });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
