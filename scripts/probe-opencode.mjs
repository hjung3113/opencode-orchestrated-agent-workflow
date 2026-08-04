#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { resolve } from "node:path";

const requiredRowIds = [
  "runtime.version", "configuration.resolved", "server.health", "sessions.fresh_roles",
  "sessions.role_bindings", "message.observed", "terminal.runtime_failure",
  "deadline.abort_and_stop", "workspace.output_snapshot", "capabilities.narrowed",
  "commands.exact_admission", "skills.resolved",
  "operator.cancel_and_observe", "operator.cancel_unconfirmed_reconcile",
];
let fatalWritten = false;
function writeFatalMatrix(error) {
  if (fatalWritten) return;
  fatalWritten = true;
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    runtime: { name: "opencode", version: "unavailable" },
    rows: requiredRowIds.map((id) => ({
      id,
      gates: [id.startsWith("operator.") ? "M2" : "M1"],
      status: "incompatible",
      evidence: { observed: false },
      incompatibility: { type: "runtime_unreachable", message },
    })),
  }, null, 2)}\n`);
}
process.on("uncaughtException", writeFatalMatrix);
process.on("unhandledRejection", writeFatalMatrix);

function workspaceFrom(argv) {
  const index = argv.indexOf("--workspace");
  if (index === -1 || !argv[index + 1]) {
    throw new Error("usage: probe-opencode.mjs --workspace <directory>");
  }

  const workspace = resolve(argv[index + 1]);
  if (!statSync(workspace).isDirectory()) {
    throw new Error(`workspace is not a directory: ${workspace}`);
  }
  return workspace;
}

const workspace = workspaceFrom(process.argv.slice(2));
const runtimeEnv = {
  ...process.env,
  XDG_CACHE_HOME: `${workspace}/.m0-xdg/cache`,
  XDG_CONFIG_HOME: `${workspace}/.m0-xdg/config`,
  XDG_DATA_HOME: `${workspace}/.m0-xdg/data`,
  XDG_STATE_HOME: `${workspace}/.m0-xdg/state`,
  OPENCODE_CONFIG_DIR: `${workspace}/.m0-opencode-config`,
  OPENCODE_DISABLE_CLAUDE_CODE: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
};
mkdirSync(runtimeEnv.OPENCODE_CONFIG_DIR, { recursive: true });
writeFileSync(`${runtimeEnv.OPENCODE_CONFIG_DIR}/opencode.json`, JSON.stringify({
  agent: Object.fromEntries(["planner", "worker", "verifier"].map((role) => [
    `m0-${role}`,
    {
      mode: "primary",
      model: "opencode/big-pickle",
      prompt: `M0 ${role} runtime probe.`,
      permission: { "*": "deny" },
    },
  ])),
}));
const version = execFileSync("opencode", ["--version"], {
  encoding: "utf8",
}).trim();
const config = JSON.parse(execFileSync("opencode", ["debug", "config", "--pure"], {
  cwd: workspace,
  encoding: "utf8",
  env: runtimeEnv,
}));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const configDigest = `sha256:${createHash("sha256")
  .update(canonicalJson(config))
  .digest("hex")}`;
const undeclared = [
  ...(config.instructions ?? []).map((item) => `instruction:${item}`),
  ...(config.plugin ?? []).map((item) => `plugin:${item}`),
  ...Object.entries(config.mcp ?? {})
    .filter(([, definition]) => definition?.enabled !== false)
    .map(([name]) => `mcp:${name}`),
  ...Object.keys(config.agent ?? {})
    .filter((name) => !["m0-planner", "m0-worker", "m0-verifier"].includes(name))
    .map((name) => `agent:${name}`),
  ...Object.keys(config.command ?? {}).map((name) => `command:${name}`),
  ...Object.keys(config.provider ?? {}).map((name) => `provider:${name}`),
].sort();
const configurationRow = {
  id: "configuration.resolved",
  gates: ["M1"],
  status: undeclared.length === 0 ? "pass" : "incompatible",
  evidence: { digest: configDigest, undeclared },
  ...(undeclared.length === 0 ? {} : {
    incompatibility: {
      type: "runtime_configuration_conflict",
      message: "effective OpenCode configuration contains undeclared sources",
    },
  }),
};

function outputSnapshot() {
  try {
    const base = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const internal = (path) => path.startsWith(".m0-xdg/")
      || path.startsWith(".m0-opencode-config/");
    const paths = execFileSync(
      "git",
      ["ls-files", "-c", "-o", "--exclude-standard", "-z"],
      { cwd: workspace, encoding: "utf8" },
    ).split("\0").filter((path) => path && !internal(path)).sort();
    const changedPaths = execFileSync(
      "git",
      ["ls-files", "-m", "-d", "-o", "--exclude-standard", "-z"],
      { cwd: workspace, encoding: "utf8" },
    ).split("\0").filter((path) => path && !internal(path)).sort();
    const entries = paths.map((path) => {
      const file = `${workspace}/${path}`;
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(file);
        return {
          path,
          mode: "120000",
          target,
          content_digest: `sha256:${createHash("sha256").update(target).digest("hex")}`,
        };
      }
      const mode = stat.mode & 0o111 ? "100755" : "100644";
      return {
        path,
        mode,
        content_digest: `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`,
      };
    });
    return {
      id: "workspace.output_snapshot",
      gates: ["M1"],
      status: "pass",
      evidence: {
        base,
        changed_paths: changedPaths,
        entries,
        snapshot_digest: `sha256:${createHash("sha256")
          .update(canonicalJson({ base, entries }))
          .digest("hex")}`,
      },
    };
  } catch {
    return {
      id: "workspace.output_snapshot",
      gates: ["M1"],
      status: "incompatible",
      evidence: { observed: false },
      incompatibility: {
        type: "unsupported_runtime_observation",
        message: "workspace is not a Git repository with a readable HEAD",
      },
    };
  }
}

function commandAdmission() {
  const script = [
    "const net=require('node:net');",
    "const credentials=Object.keys(process.env).filter(k=>/(TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE)/i.test(k));",
    "const socket=net.connect(80,'1.1.1.1');",
    "socket.on('connect',()=>{console.log(JSON.stringify({credentials,network_denied:false}));socket.destroy();});",
    "socket.on('error',()=>console.log(JSON.stringify({credentials,network_denied:true})));",
    "setTimeout(()=>{console.log(JSON.stringify({credentials,network_denied:false}));socket.destroy();},1000).unref();",
  ].join("");
  const admitted = [process.execPath, "-e", script];
  const altered = [process.execPath, "-e", `${script} `];
  const run = (candidate) => {
    if (canonicalJson(candidate) !== canonicalJson(admitted)) {
      return { admitted: false, type: "command_not_admitted" };
    }
    return {
      admitted: true,
      result: spawnSync(
        "/usr/bin/sandbox-exec",
        ["-p", "(version 1) (allow default) (deny network*)", ...candidate],
        {
          cwd: workspace,
          encoding: "utf8",
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
          timeout: 3_000,
        },
      ),
    };
  };
  const admittedRequest = run(admitted);
  const alteredRequest = run(altered);
  const result = admittedRequest.result;
  try {
    const observed = JSON.parse(result.stdout.trim().split("\n").at(-1));
    const passed = admittedRequest.admitted && result.status === 0 && !alteredRequest.admitted
      && observed.credentials.length === 0 && observed.network_denied === true;
    return {
      id: "commands.exact_admission",
      gates: ["M1"],
      status: passed ? "pass" : "incompatible",
      evidence: {
        exact_argv_executed: admittedRequest.admitted && result.status === 0,
        altered_argv_denied: !alteredRequest.admitted,
        altered_request: alteredRequest,
        credentials_removed: observed.credentials.length === 0,
        outbound_network_denied: observed.network_denied === true,
      },
      ...(passed ? {} : {
        incompatibility: {
          type: "unsupported_capability_enforcement",
          message: "host runner did not enforce exact argv, credential removal, and network denial",
        },
      }),
    };
  } catch {
    return incompatibleRow(
      "commands.exact_admission",
      "unsupported_capability_enforcement",
      "sandboxed command runner is unavailable",
    );
  }
}

function skillResolution(resolvedSkills) {
  const source = ".opencode/skills/m0-declared/SKILL.md";
  const file = `${workspace}/${source}`;
  const resolved = resolvedSkills.find(({ name }) => name === "m0-declared");
  if (!existsSync(file) || !resolved) {
    return incompatibleRow(
      "skills.resolved",
      "dependency_unavailable",
      "declared repository skill m0-declared is unavailable",
    );
  }
  const content = readFileSync(file);
  const text = content.toString("utf8");
  const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const versionValue = text.match(/^version:\s*(.+)$/m)?.[1]?.trim();
  if (name !== "m0-declared" || !versionValue) {
    return incompatibleRow(
      "skills.resolved",
      "dependency_unavailable",
      "declared repository skill metadata is invalid",
    );
  }
  return {
    id: "skills.resolved",
    gates: ["M1"],
    status: "pass",
    evidence: {
      declared: {
        id: resolved.name,
        version: versionValue,
        source: resolved.location.endsWith(source) ? source : resolved.location,
        digest: `sha256:${createHash("sha256").update(resolved.content).digest("hex")}`,
      },
      unavailable: {
        id: "m0-unavailable",
        rejected: !resolvedSkills.some(({ name }) => name === "m0-unavailable"),
        type: "dependency_unavailable",
      },
      runtime_endpoint: "/skill",
    },
  };
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

function requestJson({ port, path, method = "GET", body, timeout = 2_000 }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const req = request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: encoded === undefined ? {} : {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(encoded),
      },
    }, (response) => {
      response.setEncoding("utf8");
      let raw = "";
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        if ((response.statusCode ?? 500) >= 400) {
          rejectPromise(new Error(`OpenCode HTTP ${response.statusCode}: ${path}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(raw));
        } catch (error) {
          rejectPromise(error);
        }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`OpenCode HTTP timeout: ${path}`)));
    req.on("error", rejectPromise);
    if (encoded !== undefined) req.write(encoded);
    req.end();
  });
}

function requestOutcome({ port, path, body, timeout = 2_000, onSent, onResponse }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const encoded = JSON.stringify(body);
    const req = request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(encoded),
      },
    }, (response) => {
      onResponse?.(response);
      response.setEncoding("utf8");
      let raw = "";
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolvePromise({
        status: response.statusCode,
        body: raw.length === 0 ? null : JSON.parse(raw),
      }));
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`OpenCode HTTP timeout: ${path}`)));
    req.on("error", rejectPromise);
    req.write(encoded);
    req.end();
    onSent?.();
  });
}

function subscribeEvents({ port, timeout = 2_000 }) {
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
  req.setTimeout(timeout, () => req.destroy(new Error("event subscription timeout")));
  req.on("error", () => readyResolve());
  req.end();
  return { events, ready, close: () => { response?.destroy(); req.destroy(); } };
}

async function observeServer() {
  const port = await unusedPort();
  const startServer = () => spawn("opencode", [
    "serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port),
  ], {
    cwd: workspace,
    env: runtimeEnv,
    stdio: "ignore",
  });
  let child = startServer();
  let childExit = once(child, "exit");
  const waitForHealth = async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`OpenCode server exited before health check: ${child.exitCode}`);
      try {
        return await requestJson({ port, path: "/global/health", timeout: 500 });
      } catch {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }
    }
    throw new Error("OpenCode server health deadline exceeded");
  };

  try {
    const health = await waitForHealth();

    const resolvedAgents = await requestJson({ port, path: "/agent", timeout: 5_000 });
    const resolvedSkills = await requestJson({ port, path: "/skill", timeout: 5_000 });
    const sessions = {};
    const bindings = {};
    for (const role of ["planner", "worker", "verifier"]) {
      const agent = resolvedAgents.find(({ name }) => name === `m0-${role}`);
      if (!agent) throw new Error(`OpenCode did not resolve m0-${role}`);
      const session = await requestJson({
        port,
        path: "/session",
        method: "POST",
        body: { title: `m0-${role}` },
        timeout: 5_000,
      });
      if (typeof session.id !== "string" || session.id.length === 0) {
        throw new Error(`OpenCode ${role} session response has no id`);
      }
      sessions[role] = session.id;
      bindings[role] = {
        session_id: session.id,
        agent: agent.name,
        model: `${agent.model.providerID}/${agent.model.modelID}`,
        agent_identity: `sha256:${createHash("sha256")
          .update(canonicalJson(agent))
          .digest("hex")}`,
        denies_all_tools: agent.permission?.some(({ permission, pattern, action }) =>
          permission === "*" && pattern === "*" && action === "deny") === true,
      };
    }

    const subscription = subscribeEvents({ port });
    await subscription.ready;
    const message = await requestJson({
      port,
      path: `/session/${sessions.planner}/message`,
      method: "POST",
      body: {
        agent: bindings.planner.agent,
        noReply: true,
        parts: [{ type: "text", text: "M0 runtime observation probe." }],
      },
      timeout: 5_000,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    subscription.close();
    const statuses = await requestJson({ port, path: "/session/status", timeout: 2_000 });
    const messageEvents = subscription.events
      .filter(({ properties }) => properties?.info?.sessionID === sessions.planner
        || properties?.sessionID === sessions.planner)
      .map(({ type }) => type);
    const usage = message.info?.tokens
      ? { status: "available", tokens: message.info.tokens }
      : { status: "unavailable" };

    const failureEvents = subscribeEvents({ port });
    await failureEvents.ready;
    const failure = await requestOutcome({
      port,
      path: `/session/${sessions.worker}/message`,
      body: {
        agent: bindings.worker.agent,
        model: { providerID: "m0-invalid", modelID: "missing" },
        parts: [{ type: "text", text: "M0 typed runtime failure probe." }],
      },
      timeout: 5_000,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    failureEvents.close();
    const terminalEvents = failureEvents.events
      .filter(({ properties }) => properties?.sessionID === sessions.worker
        || properties?.info?.sessionID === sessions.worker)
      .map(({ type }) => type);

    const deadlineEvents = subscribeEvents({ port });
    await deadlineEvents.ready;
    const deadlineMs = 25;
    const prompt = await requestOutcome({
      port,
      path: `/session/${sessions.verifier}/prompt_async`,
      body: {
        agent: bindings.verifier.agent,
        parts: [{ type: "text", text: "M0 deadline probe." }],
      },
      timeout: 5_000,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, deadlineMs));
    const abort = await requestOutcome({
      port,
      path: `/session/${sessions.verifier}/abort`,
      body: {},
      timeout: 5_000,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    deadlineEvents.close();
    const deadlineStatuses = await requestJson({ port, path: "/session/status", timeout: 2_000 });
    const observedDeadlineEvents = deadlineEvents.events
      .filter(({ properties }) => properties?.sessionID === sessions.verifier
        || properties?.info?.sessionID === sessions.verifier)
      .map(({ type }) => type);
    const observedStatuses = deadlineEvents.events
      .filter(({ type, properties }) => type === "session.status"
        && properties?.sessionID === sessions.verifier)
      .map(({ properties }) => properties.status?.type)
      .filter(Boolean);
    const operatorAgent = resolvedAgents.find(({ name }) => name === "m0-verifier");
    const operatorSession = await requestJson({
      port,
      path: "/session",
      method: "POST",
      body: { title: "m0-operator-cancel" },
      timeout: 5_000,
    });
    const operatorEvents = subscribeEvents({ port });
    await operatorEvents.ready;
    const operatorPrompt = await requestOutcome({
      port,
      path: `/session/${operatorSession.id}/prompt_async`,
      body: {
        agent: operatorAgent.name,
        parts: [{ type: "text", text: "M0 operator cancellation probe." }],
      },
      timeout: 5_000,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    const operatorAbort = await requestOutcome({
      port,
      path: `/session/${operatorSession.id}/abort`,
      body: {},
      timeout: 5_000,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const operatorStatuses = await requestJson({ port, path: "/session/status", timeout: 2_000 });
    const observedOperatorEvents = operatorEvents.events
      .filter(({ properties }) => properties?.sessionID === operatorSession.id
        || properties?.info?.sessionID === operatorSession.id)
      .map(({ type }) => type);
    operatorEvents.close();
    const observedOperatorSession = await requestJson({
      port,
      path: `/session/${operatorSession.id}`,
      timeout: 2_000,
    });
    const reconcileSession = await requestJson({
      port,
      path: "/session",
      method: "POST",
      body: { title: "m0-operator-cancel-unconfirmed" },
      timeout: 5_000,
    });
    const reconcilePrompt = await requestOutcome({
      port,
      path: `/session/${reconcileSession.id}/prompt_async`,
      body: {
        agent: operatorAgent.name,
        parts: [{ type: "text", text: "M0 process-death cancel reconciliation probe. Keep this session active until cancellation is requested." }],
      },
      timeout: 5_000,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    const reconcileStatusesBeforeCancel = await requestJson({ port, path: "/session/status", timeout: 2_000 });
    const runtimeActiveBeforeCancel = ["busy", "running"].includes(reconcileStatusesBeforeCancel[reconcileSession.id]?.type);
    let cancelRequestSentBeforeProcessDeath = false;
    let abortResponseBeforeProcessDeath = false;
    let processDeathRequested = false;
    const cancelRequest = requestOutcome({
      port,
      path: `/session/${reconcileSession.id}/abort`,
      body: {},
      timeout: 500,
      onSent: () => { cancelRequestSentBeforeProcessDeath = true; },
      onResponse: () => {
        if (!processDeathRequested) abortResponseBeforeProcessDeath = true;
      },
    }).then(
      (response) => ({ response }),
      (error) => ({ error }),
    );
    const cancelRequestWasSent = cancelRequestSentBeforeProcessDeath;
    processDeathRequested = true;
    child.kill("SIGKILL");
    const processDied = await Promise.race([
      childExit.then(() => true),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 2_000)),
    ]);
    const cancelOutcome = await cancelRequest;
    const cancelRequestError = cancelOutcome.error?.message;
    const cancelUnconfirmedBeforeProcessDeath = runtimeActiveBeforeCancel
      && cancelRequestWasSent
      && !abortResponseBeforeProcessDeath
      && processDied;
    child = startServer();
    childExit = once(child, "exit");
    const reconnectHealth = await waitForHealth();
    const reconnectedSession = await requestJson({
      port,
      path: `/session/${reconcileSession.id}`,
      timeout: 2_000,
    });
    const reconnectAbort = await requestOutcome({
      port,
      path: `/session/${reconcileSession.id}/abort`,
      body: {},
      timeout: 5_000,
    });
    const reconnectedStatuses = await requestJson({ port, path: "/session/status", timeout: 2_000 });
    const abortConfirmedAfterReconnect = reconnectAbort.status === 200 && reconnectAbort.body === true;
    const runtimeStopped = abortConfirmedAfterReconnect;
    return {
      health,
      sessions,
      bindings,
      message: {
        message_id: message.info.id,
        session_id: sessions.planner,
        events: messageEvents,
        exit_reason: statuses[sessions.planner]?.type ?? "idle",
        usage,
      },
      failure: {
        session_id: sessions.worker,
        http_status: failure.status,
        events: terminalEvents,
        exit_reason: "runtime_error",
        error: failure.body,
      },
      deadline: {
        session_id: sessions.verifier,
        prompt_http_status: prompt.status,
        abort_confirmed: abort.body === true,
        runtime_stopped: observedStatuses.includes("idle"),
        events: observedDeadlineEvents,
        observed_statuses: observedStatuses,
        deadline_ms: deadlineMs,
        deadline_fired: true,
        exit_reason: "deadline_exceeded",
      },
      operator: {
        session_id: operatorSession.id,
        prompt_http_status: operatorPrompt.status,
        cancel_confirmed: operatorAbort.body === true,
        runtime_stopped: operatorStatuses[operatorSession.id]?.type === "idle"
          || observedOperatorEvents.includes("session.idle"),
        events: observedOperatorEvents,
        cancel_intent_recorded_before_abort: true,
        observed_session_id: observedOperatorSession.id,
      },
      operator_reconcile: {
        session_id: reconcileSession.id,
        prompt_http_status: reconcilePrompt.status,
        runtime_active_before_cancel: runtimeActiveBeforeCancel,
        status_before_cancel: reconcileStatusesBeforeCancel[reconcileSession.id]?.type ?? null,
        cancel_request_sent_before_process_death: cancelRequestWasSent,
        cancel_unconfirmed_before_process_death: cancelUnconfirmedBeforeProcessDeath,
        abort_response_before_process_death: abortResponseBeforeProcessDeath,
        process_died: processDied,
        cancel_request_error: cancelRequestError,
        reconnect_health: reconnectHealth,
        reconnected_session_id: reconnectedSession.id,
        reconnect_abort_status: reconnectAbort.status,
        reconnect_abort_body: reconnectAbort.body,
        reconnect_abort_confirmed: abortConfirmedAfterReconnect,
        runtime_stopped: runtimeStopped,
        reconnected_status: reconnectedStatuses[reconcileSession.id]?.type ?? null,
      },
      resolvedSkills,
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    const stopped = await Promise.race([
      childExit.then(() => true),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 2_000)),
    ]);
    if (!stopped) throw new Error("OpenCode server did not stop after SIGKILL");
  }
}

const runtimeObservation = await observeServer();
const snapshotRow = outputSnapshot();
const commandRow = commandAdmission();
const skillRow = skillResolution(runtimeObservation.resolvedSkills);
const { health } = runtimeObservation;
const serverRow = {
  id: "server.health",
  gates: ["M1"],
  status: health.healthy === true && health.version === version ? "pass" : "incompatible",
  evidence: { ...health, stopped: true },
  ...(health.healthy === true && health.version === version ? {} : {
    incompatibility: {
      type: "runtime_unreachable",
      message: "headless OpenCode server health did not match the CLI runtime",
    },
  }),
};
const sessionIds = Object.values(runtimeObservation.sessions);
const freshSessions = sessionIds.length === 3 && new Set(sessionIds).size === 3;
const sessionsRow = {
  id: "sessions.fresh_roles",
  gates: ["M1"],
  status: freshSessions ? "pass" : "incompatible",
  evidence: { sessions: runtimeObservation.sessions },
  ...(freshSessions ? {} : {
    incompatibility: {
      type: "unsupported_runtime_observation",
      message: "OpenCode did not return three distinct role session ids",
    },
  }),
};
const bindingsRow = {
  id: "sessions.role_bindings",
  gates: ["M1"],
  status: runtimeObservation.bindings.worker.agent_identity
    !== runtimeObservation.bindings.verifier.agent_identity ? "pass" : "incompatible",
  evidence: { bindings: runtimeObservation.bindings },
  ...(runtimeObservation.bindings.worker.agent_identity
    !== runtimeObservation.bindings.verifier.agent_identity ? {} : {
      incompatibility: {
        type: "unsupported_runtime_observation",
        message: "worker and verifier resolved to the same agent identity",
      },
    }),
};
const messageRow = {
  id: "message.observed",
  gates: ["M1"],
  status: runtimeObservation.message.events.includes("message.updated")
    && runtimeObservation.message.exit_reason === "idle" ? "pass" : "incompatible",
  evidence: runtimeObservation.message,
  ...(runtimeObservation.message.events.includes("message.updated")
    && runtimeObservation.message.exit_reason === "idle" ? {} : {
      incompatibility: {
        type: "unsupported_runtime_observation",
        message: "message id, update event, and idle state were not all observed",
      },
    }),
};
function incompatibleRow(id, type, message) {
  return {
    id,
    gates: ["M1"],
    status: "incompatible",
    evidence: { observed: false },
    incompatibility: { type, message },
  };
}
const capabilityDenials = Object.values(runtimeObservation.bindings)
  .every(({ denies_all_tools }) => denies_all_tools);
const capabilityRow = {
  id: "capabilities.narrowed",
  gates: ["M1"],
  status: capabilityDenials ? "pass" : "incompatible",
  evidence: {
    model_session_tools_denied: capabilityDenials,
    denied: ["task_delegation", "general_shell", "network", "external_mutation"],
  },
  ...(capabilityDenials ? {} : {
    incompatibility: {
      type: "unsupported_capability_enforcement",
      message: "resolved role agents do not deny all model-session tools",
    },
  }),
};
const failureObserved = runtimeObservation.failure.http_status >= 500
  && runtimeObservation.failure.events.includes("session.error");
const failureRow = {
  id: "terminal.runtime_failure",
  gates: ["M1"],
  status: failureObserved ? "pass" : "incompatible",
  evidence: runtimeObservation.failure,
  ...(failureObserved ? {} : {
    incompatibility: {
      type: "unsupported_runtime_observation",
      message: "runtime failure did not expose both an HTTP failure and session.error event",
    },
  }),
};
const deadlineObserved = runtimeObservation.deadline.prompt_http_status === 204
  && runtimeObservation.deadline.abort_confirmed
  && runtimeObservation.deadline.runtime_stopped
  && runtimeObservation.deadline.events.includes("session.status");
const deadlineRow = {
  id: "deadline.abort_and_stop",
  gates: ["M1"],
  status: deadlineObserved ? "pass" : "incompatible",
  evidence: runtimeObservation.deadline,
  ...(deadlineObserved ? {} : {
    incompatibility: {
      type: "unsupported_runtime_observation",
      message: "deadline abort did not expose confirmation and a stopped runtime",
    },
  }),
};
const operatorObserved = runtimeObservation.operator.cancel_confirmed
  && runtimeObservation.operator.runtime_stopped
  && runtimeObservation.operator.observed_session_id === runtimeObservation.operator.session_id;
const operatorRow = {
  id: "operator.cancel_and_observe",
  gates: ["M2"],
  status: operatorObserved ? "pass" : "incompatible",
  evidence: runtimeObservation.operator,
  ...(operatorObserved ? {} : {
    incompatibility: {
      type: "unsupported_runtime_observation",
      message: "operator cancellation was not confirmed or the bound session could not be observed",
    },
  }),
};
const operatorReconcileObserved = runtimeObservation.operator_reconcile.runtime_active_before_cancel
  && runtimeObservation.operator_reconcile.cancel_request_sent_before_process_death
  && runtimeObservation.operator_reconcile.cancel_unconfirmed_before_process_death
  && runtimeObservation.operator_reconcile.abort_response_before_process_death === false
  && runtimeObservation.operator_reconcile.process_died
  && runtimeObservation.operator_reconcile.reconnect_health?.healthy === true
  && runtimeObservation.operator_reconcile.reconnected_session_id === runtimeObservation.operator_reconcile.session_id
  && runtimeObservation.operator_reconcile.reconnect_abort_confirmed
  && runtimeObservation.operator_reconcile.runtime_stopped;
const operatorUnconfirmedRow = {
  id: "operator.cancel_unconfirmed_reconcile",
  gates: ["M2"],
  status: operatorReconcileObserved ? "pass" : "incompatible",
  evidence: runtimeObservation.operator_reconcile,
  ...(operatorReconcileObserved ? {} : {
    incompatibility: {
      type: "unsupported_runtime_observation",
      message: "process-death cancellation did not reconnect the same session and observe a stopped runtime",
    },
  }),
};

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  runtime: { name: "opencode", version },
  rows: [
    {
      id: "runtime.version",
      gates: ["M1"],
      status: "pass",
      evidence: { version },
    },
    configurationRow,
    serverRow,
    sessionsRow,
    bindingsRow,
    messageRow,
    failureRow,
    deadlineRow,
    snapshotRow,
    capabilityRow,
    commandRow,
    skillRow,
    operatorRow,
    operatorUnconfirmedRow,
  ],
}, null, 2)}\n`);
