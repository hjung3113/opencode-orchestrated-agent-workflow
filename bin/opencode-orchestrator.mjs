#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  DependencyUnavailable,
  StateConflict,
  cancelRun,
  digest,
  inspectRun,
  requestRoute,
  resumeRun,
  runLocalChange,
} from "../scripts/local-change.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = join(packageRoot, "opencode");
const operatorSchemaVersion = "1";
const operatorActions = new Set(["run", "status", "resume", "cancel"]);
const bundleAssets = [
  "opencode/opencode.json",
  "opencode/commands/orchestrate.md",
  "opencode/commands/orchestrate-status.md",
  "opencode/commands/orchestrate-resume.md",
  "opencode/commands/orchestrate-cancel.md",
  "opencode/agents/orchestrator.md",
  "opencode/tools/orchestrator_operator.ts",
  "opencode/tools/request_route.ts",
  "workflow-agents/planner@1.json",
  "workflow-agents/worker@1.json",
  "workflow-agents/verifier@1.json",
  "workflows/intake@1.json",
  "workflows/implementation@1.json",
  "workflows/verification@1.json",
  "workflows/repair@1.json",
  "route-rules/m4@1.json",
  "skills/manifest.v1.json",
  "skills/adapters/ask-matt-advisory@1.mjs",
  "skills/adapters/implement@1.mjs",
  "skills/adapters/tdd@1.mjs",
  "skills/adapters/code-review@1.mjs",
  "skills/adapters/diagnosing-bugs@1.mjs",
];

// Filled from the checked-in #34 asset tree; a changed byte or path fails closed.
const bundleDigest = "sha256:b9df2e52912db2991a093ddde5b47bd7d0872fb09a17844d41f25b1041088e3f";
const generatedConfigIgnore = "node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore";
const generatedDependencyEntries = new Set(
  generatedConfigIgnore.split("\n").filter((name) => name !== ".gitignore"),
);

const collisionNames = {
  commands: ["orchestrate", "orchestrate-status", "orchestrate-resume", "orchestrate-cancel"],
  agents: ["orchestrator"],
  tools: ["orchestrator_operator", "request_route"],
  skills: ["ask-matt", "implement", "tdd", "code-review", "diagnosing-bugs"],
};

export class OperatorError extends Error {
  constructor(type, message) {
    super(message);
    this.name = "OperatorError";
    this.type = type;
  }
}

function fileSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isWithin(child, parent) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function canonicalPath(value, label) {
  if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value) {
    throw new OperatorError("invalid_operator_input", `${label} must be an absolute path`);
  }
  return value;
}

function existingRealPath(value) {
  const absolute = resolve(value);
  let existing = absolute;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  try {
    return join(realpathSync(existing), relative(existing, absolute));
  } catch {
    return absolute;
  }
}

function validatePaths(target, runRoot) {
  const absoluteTarget = canonicalPath(target, "target");
  const absoluteRunRoot = canonicalPath(runRoot, "run-root");
  if (!existsSync(absoluteTarget) || !lstatSync(absoluteTarget).isDirectory()) {
    throw new OperatorError("invalid_operator_input", `target does not exist: ${absoluteTarget}`);
  }
  const targetPath = existingRealPath(absoluteTarget);
  const runRootPath = existingRealPath(absoluteRunRoot);
  if (isWithin(targetPath, runRootPath) || isWithin(runRootPath, targetPath)) {
    throw new OperatorError("invalid_operator_input", "run-root must be outside the target workspace");
  }
  const home = process.env.HOME ? existingRealPath(process.env.HOME) : null;
  const developerRoots = [
    home && join(home, ".config"),
    home && join(home, ".agents"),
    home && join(home, ".claude"),
    process.env.XDG_CONFIG_HOME,
    process.env.XDG_CACHE_HOME,
    process.env.XDG_DATA_HOME,
    process.env.XDG_STATE_HOME,
  ].filter(Boolean).map(existingRealPath);
  if (developerRoots.some((root) => isWithin(runRootPath, root))) {
    throw new OperatorError("runtime_configuration_conflict", "run-root must be outside developer-home configuration");
  }
  return { target: absoluteTarget, runRoot: absoluteRunRoot };
}

function bundleTree(root = packageRoot) {
  const rows = bundleAssets.map((asset) => {
    const path = join(root, asset);
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new DependencyUnavailable(`missing #34 bundle asset ${asset}`);
    }
    const mode = (lstatSync(path).mode & 0o777).toString(8).padStart(4, "0");
    const bytes = readFileSync(path);
    return `${asset}\0${mode}\0${fileSha256(bytes)}\n`;
  });
  return rows.join("");
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

function validateBundle() {
  const tree = bundleTree();
  if (fileSha256(tree) !== bundleDigest) {
    throw new DependencyUnavailable("#34 bundle manifest digest mismatch");
  }
  const expected = new Set(bundleAssets);
  const gitignorePath = join(packageRoot, "opencode/.gitignore");
  const gitignoreAccepted = existsSync(gitignorePath)
    && readFileSync(gitignorePath, "utf8") === generatedConfigIgnore;
  for (const root of ["opencode", "workflow-agents", "workflows", "route-rules", "skills"]) {
    for (const file of walkFiles(join(packageRoot, root))) {
      const asset = `${root}/${file}`;
      if (asset === "opencode/.gitignore" && gitignoreAccepted) continue;
      if (root === "opencode" && gitignoreAccepted && generatedDependencyEntries.has(file.split("/")[0])) continue;
      if (!expected.has(asset)) throw new OperatorError("runtime_configuration_conflict", `undeclared bundle asset: ${asset}`);
    }
  }
  const operatorTool = readFileSync(join(bundleRoot, "tools/orchestrator_operator.ts"), "utf8");
  const routeTool = readFileSync(join(bundleRoot, "tools/request_route.ts"), "utf8");
  if (!operatorTool.includes('from "../../bin/opencode-orchestrator.mjs"')
    || !operatorTool.includes("invokeOperator")
    || /child_process|execFile|spawn|local-change\.mjs/.test(operatorTool)
    || !routeTool.includes('from "../../bin/opencode-orchestrator.mjs"')
    || !routeTool.includes("requestRoute")) {
    throw new OperatorError("unsupported_capability_enforcement", "#34 tool adapters do not use the shared operator export");
  }
  return { bundleRoot, digest: bundleDigest };
}

function configuredRoots(target) {
  const home = process.env.HOME;
  return [
    target,
    join(target, ".opencode"),
    process.env.XDG_CONFIG_HOME && join(process.env.XDG_CONFIG_HOME, "opencode"),
    home && join(home, ".config/opencode"),
    home && join(home, ".opencode"),
  ].filter((path) => path && resolve(path) !== resolve(bundleRoot));
}

function configuredNames(root) {
  if (!existsSync(root)) return [];
  const names = [];
  for (const [kind, values] of Object.entries(collisionNames)) {
    const directory = join(root, kind);
    for (const name of values) {
      if (["commands", "agents", "tools"].includes(kind)) {
        for (const extension of [".md", ".ts", ".js"]) {
          if (existsSync(join(directory, `${name}${extension}`))) names.push(`${kind}/${name}`);
        }
      }
    }
  }
  for (const skillRoot of [join(root, "skills")]) {
    for (const name of collisionNames.skills) {
      if (existsSync(join(skillRoot, name))) names.push(`skills/${name}`);
    }
  }
  for (const path of [join(root, "opencode.json"), join(root, "config.json")]) {
    if (!existsSync(path)) continue;
    try {
      const config = JSON.parse(readFileSync(path, "utf8"));
      for (const kind of ["command", "agent", "tool"]) {
        for (const name of Object.keys(config[kind] ?? {})) {
          const normalized = kind === "command" ? "commands" : `${kind}s`;
          if (collisionNames[normalized]?.includes(name)) names.push(`${normalized}/${name}`);
        }
      }
    } catch {
      throw new OperatorError("runtime_configuration_conflict", `invalid OpenCode configuration: ${path}`);
    }
  }
  return names;
}

function validateCollisions(target) {
  const collisions = configuredRoots(target).flatMap((root) =>
    configuredNames(root).map((name) => `${root}:${name}`));
  const home = process.env.HOME;
  for (const root of [home && join(home, ".agents/skills"), home && join(home, ".claude/skills")].filter(Boolean)) {
    for (const name of collisionNames.skills) {
      if (existsSync(join(root, name))) collisions.push(`${root}:skills/${name}`);
    }
  }
  if (collisions.length > 0) {
    throw new OperatorError("runtime_configuration_conflict", `conflicting OpenCode assets: ${collisions.join(", ")}`);
  }
}

function launchEnvironment(runRoot) {
  const runtimeRoot = join(runRoot, "operator-runtime");
  const values = {
    HOME: join(runtimeRoot, "home"),
    OPENCODE_CONFIG_DIR: bundleRoot,
    XDG_CONFIG_HOME: join(runtimeRoot, "config"),
    XDG_CACHE_HOME: join(runtimeRoot, "cache"),
    XDG_DATA_HOME: join(runtimeRoot, "data"),
    XDG_STATE_HOME: join(runtimeRoot, "state"),
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    ORCHESTRATOR_RUN_ROOT: runRoot,
  };
  for (const [name, value] of Object.entries(values)) {
    if (name !== "HOME" && process.env[name] !== undefined && process.env[name] !== value) {
      throw new OperatorError("runtime_configuration_conflict", `launcher environment conflict: ${name}`);
    }
  }
  for (const name of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT"]) {
    if (process.env[name] !== undefined) {
      throw new OperatorError("runtime_configuration_conflict", `launcher environment conflict: ${name}`);
    }
  }
  const environment = { ...process.env };
  delete environment.OPENCODE_CONFIG;
  delete environment.OPENCODE_CONFIG_CONTENT;
  return { ...environment, ...values };
}

function opencodeExecutable() {
  let executable;
  try {
    executable = execFileSync("which", ["opencode"], { encoding: "utf8" }).trim();
  } catch {
    throw new DependencyUnavailable("OpenCode executable is not on PATH");
  }
  if (!executable) throw new DependencyUnavailable("OpenCode executable is not on PATH");
  const path = existingRealPath(executable);
  let version;
  try {
    version = execFileSync(path, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    throw new OperatorError("unsupported_capability_enforcement", "OpenCode version could not be observed");
  }
  if (version.length === 0) {
    throw new OperatorError("unsupported_capability_enforcement", "OpenCode version could not be observed");
  }
  return { path, version };
}

export function preflight({ target, runRoot, checkConfiguration = false } = {}) {
  const paths = validatePaths(target, runRoot);
  const bundle = validateBundle();
  validateCollisions(paths.target);
  const executable = opencodeExecutable();
  const environment = launchEnvironment(paths.runRoot);
  if (checkConfiguration) {
    validateResolvedConfiguration(executable.path, paths.target, environment);
    validateBundle();
  }
  return { ...paths, ...bundle, executable, environment };
}

function validateResolvedConfiguration(executable, target, environment) {
  let parsed;
  try {
    parsed = JSON.parse(execFileSync(executable, ["debug", "config", "--pure"], {
      cwd: target,
      encoding: "utf8",
      env: environment,
    }));
  } catch {
    throw new OperatorError("unsupported_capability_enforcement", "OpenCode resolved configuration could not be observed");
  }
  const commands = Object.keys(parsed.command ?? {});
  const agents = Object.keys(parsed.agent ?? {});
  if (!collisionNames.commands.every((name) => commands.includes(name))) {
    throw new OperatorError("unsupported_capability_enforcement", "the four #34 commands were not resolved");
  }
  if (!agents.includes("orchestrator")) {
    throw new OperatorError("unsupported_capability_enforcement", "the orchestrator primary was not resolved");
  }
  if ((parsed.instructions ?? []).length > 0
    || (parsed.plugin ?? []).length > 0
    || Object.keys(parsed.mcp ?? {}).length > 0) {
    throw new OperatorError("unsupported_capability_enforcement", "undeclared OpenCode instructions, plugins, or MCP servers remain active");
  }
  const agent = parsed.agent.orchestrator;
  if (!agent
    || agent.mode !== "primary"
    || agent.tools?.["*"] !== false
    || agent.tools?.orchestrator_operator !== true
    || agent.permission?.["*"] !== "deny"
    || agent.permission?.orchestrator_operator !== "allow"
    || Object.keys(agent.tools ?? {}).some((name) => !["*", "orchestrator_operator"].includes(name))
    || Object.keys(agent.permission ?? {}).some((name) => !["*", "orchestrator_operator"].includes(name))) {
    throw new OperatorError("unsupported_capability_enforcement", "orchestrator permissions are broader than the operator envelope");
  }
  for (const name of collisionNames.commands) {
    const command = parsed.command[name];
    if (command.agent !== "orchestrator" || command.subtask !== false) {
      throw new OperatorError("unsupported_capability_enforcement", `command ${name} is not bound to the orchestrator primary`);
    }
  }
  return parsed;
}

function contextPaths(context = {}) {
  return {
    target: context.target ?? context.workspace ?? process.env.ORCHESTRATOR_TARGET ?? context.directory,
    runRoot: context.runRoot ?? process.env.ORCHESTRATOR_RUN_ROOT,
  };
}

function validateRunId(runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new OperatorError("invalid_operator_input", "run_id must use the closed Run id shape");
  }
}

function runDirectory(runRoot, runId) {
  validateRunId(runId);
  const path = resolve(runRoot, "runs", runId);
  if (!existsSync(path) || !existsSync(join(path, "run.json"))) {
    throw new OperatorError("run_not_found", `Run does not exist: ${runId}`);
  }
  return path;
}

function artifactReference(runDir, path, artifact) {
  return {
    reference_kind: "artifact",
    artifact_id: artifact.artifact_id,
    path,
    digest: digest(artifact),
  };
}

function latestOutcome(runDir) {
  const state = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const refs = state.transitions.flatMap(({ record_refs }) => record_refs ?? [])
    .filter(({ path }) => typeof path === "string" && path.startsWith("artifacts/outcomes/"));
  const path = refs.at(-1)?.path;
  if (!path || !existsSync(join(runDir, path))) return null;
  const outcome = JSON.parse(readFileSync(join(runDir, path), "utf8"));
  return { outcome, ref: artifactReference(runDir, path, outcome) };
}

function operatorProjection(action, runDir, result, legacy = false) {
  const inspection = result.inspect ?? result;
  const latest = latestOutcome(runDir);
  let verifiedResult = null;
  if (latest?.outcome?.outcome_kind === "receipt" && latest.outcome.promotion_ref) {
    const promotionPath = latest.outcome.promotion_ref.path;
    const promotion = JSON.parse(readFileSync(join(runDir, promotionPath), "utf8"));
    verifiedResult = {
      result_ref: promotion.result_ref,
      promoted_object_id: promotion.promoted_ref_oid,
      output_snapshot: promotion.promoted_snapshot,
    };
  }
  const projection = {
    schema_version: operatorSchemaVersion,
    action,
    run_id: inspection.run_id,
    state_version: inspection.state_version,
    lifecycle_state: inspection.lifecycle_state,
    checkpoint: result.checkpoint ?? null,
    next_action: result.next_action ?? null,
    runtime_bindings: inspection.runtime_bindings ?? [],
    active_runtime_bindings: inspection.active_runtime_bindings ?? [],
    outcome: latest ? { kind: latest.outcome.outcome_kind, artifact_ref: latest.ref } : null,
    verified_result: verifiedResult,
  };
  if (!legacy) return projection;
  return {
    ...projection,
    run_dir: runDir,
    derived_status: inspection.derived_status,
    result_artifact_ref: inspection.result_artifact_ref,
    result_ref: inspection.result_ref,
    receipt: inspection.receipt,
    ...(result.promoted_ref_oid ? { promoted_ref_oid: result.promoted_ref_oid } : {}),
    ...(result.output_snapshot ? { output_snapshot: result.output_snapshot } : {}),
    ...(result.user_workspace_unchanged !== undefined
      ? { user_workspace_unchanged: result.user_workspace_unchanged } : {}),
  };
}

function operatorFailure(action, error, runId = null) {
  const message = String(error?.message ?? error);
  const type = error?.type
    ?? (error instanceof StateConflict ? "state_conflict" : null)
    ?? (error instanceof DependencyUnavailable ? "dependency_unavailable" : null)
    ?? (error?.code === "unsupported_capability_enforcement" ? "unsupported_capability_enforcement" : null)
    ?? (/runtime_configuration_conflict/i.test(message) ? "runtime_configuration_conflict" : null)
    ?? (/OpenCode|provider|fetch failed|network timeout/i.test(message) ? "runtime_provider_failure" : null)
    ?? (/does not exist|not found/i.test(message) ? "run_not_found" : "operator_action_rejected");
  return { schema_version: operatorSchemaVersion, action, run_id: runId, error: { type, message } };
}

function actionInput(action, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OperatorError("invalid_operator_input", "operator input must be an object");
  }
  const allowed = {
    run: ["action", "request"],
    status: ["action", "run_id"],
    cancel: ["action", "run_id"],
    resume: ["action", "run_id", "decision"],
  }[action];
  if (!allowed || input.action !== action || Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new OperatorError("invalid_operator_input", `invalid closed ${action} input`);
  }
  if (action === "run" && (typeof input.request !== "string" || input.request.trim().length === 0)) {
    throw new OperatorError("invalid_operator_input", "run requires a non-empty request");
  }
  if (action !== "run") validateRunId(input.run_id);
  if (action === "resume" && input.decision !== undefined) {
    if (!input.decision || typeof input.decision !== "object" || Array.isArray(input.decision)
      || Object.keys(input.decision).sort().join(",") !== "disposition,text"
      || !["accepted", "rejected"].includes(input.decision.disposition)
      || typeof input.decision.text !== "string" || input.decision.text.trim().length === 0) {
      throw new OperatorError("invalid_operator_input", "resume decision must contain disposition and non-empty text");
    }
  }
  return input;
}

async function runOperator({ request, runtimeFactory, hooks, target, workspace, runRoot, budgetOverride, legacy } = {}) {
  const paths = contextPaths({ target, workspace, runRoot });
  preflight({ ...paths, checkConfiguration: true });
  const result = await runLocalChange({
    workspace: paths.target,
    runRoot: paths.runRoot,
    requestText: request,
    runtimeFactory,
    hooks,
    budgetOverride,
  });
  return operatorProjection("run", result.run_dir, result, legacy);
}

async function inspectOperator({ run_id: runId, target, workspace, runRoot, legacy } = {}) {
  const paths = contextPaths({ target, workspace, runRoot });
  validatePaths(paths.target, paths.runRoot);
  const runDir = runDirectory(paths.runRoot, runId);
  return operatorProjection("status", runDir, inspectRun(runDir), legacy);
}

async function resumeOperator({ run_id: runId, decision, target, workspace, runRoot, runtime, hooks, legacy } = {}) {
  const paths = contextPaths({ target, workspace, runRoot });
  validatePaths(paths.target, paths.runRoot);
  const runDir = runDirectory(paths.runRoot, runId);
  const result = await resumeRun(runDir, {
    workspace: paths.target,
    decision: decision?.text,
    decisionDisposition: decision?.disposition,
    runtime,
    hooks,
  });
  return operatorProjection("resume", runDir, result, legacy);
}

async function cancelOperator({ run_id: runId, target, workspace, runRoot, runtime, hooks, legacy } = {}) {
  const paths = contextPaths({ target, workspace, runRoot });
  validatePaths(paths.target, paths.runRoot);
  const runDir = runDirectory(paths.runRoot, runId);
  const result = await cancelRun(runDir, { runtime, hooks });
  return operatorProjection("cancel", runDir, result, legacy);
}

const rawOperator = { run: runOperator, inspect: inspectOperator, resume: resumeOperator, cancel: cancelOperator };

async function callOperator(method, input, action = method === "inspect" ? "status" : method) {
  try {
    return await rawOperator[method](input);
  } catch (error) {
    return operatorFailure(action, error, input?.run_id ?? null);
  }
}

export const operator = Object.freeze({
  run: (input) => callOperator("run", input),
  inspect: (input) => callOperator("inspect", input, "status"),
  resume: (input) => callOperator("resume", input),
  cancel: (input) => callOperator("cancel", input),
});

export async function invokeOperator(input, context = {}) {
  const action = input?.action;
  if (!operatorActions.has(action)) return operatorFailure(action ?? "run", new OperatorError("invalid_operator_input", "unknown operator action"));
  try {
    const valid = actionInput(action, input);
    return await operator[action === "status" ? "inspect" : action]({ ...valid, ...context });
  } catch (error) {
    return operatorFailure(action, error, input?.run_id ?? null);
  }
}

export { requestRoute };

function parseOption(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function parseLauncherArgs(argv) {
  if (argv.length !== 4 || argv[0] !== "--target" || argv[2] !== "--run-root") {
    throw new OperatorError("invalid_operator_input", "usage: npm run opencode -- --target <absolute-target> --run-root <absolute-run-root>");
  }
  if (argv.filter((value) => value === "--target").length !== 1 || argv.filter((value) => value === "--run-root").length !== 1) {
    throw new OperatorError("invalid_operator_input", "launcher arguments must not repeat");
  }
  return { target: parseOption(argv, "--target"), runRoot: parseOption(argv, "--run-root") };
}

export function operatorChildEnvironment(preflightResult) {
  return {
    ...preflightResult.environment,
    ORCHESTRATOR_TARGET: preflightResult.target,
    ORCHESTRATOR_NODE_EXEC: process.execPath,
  };
}

export function launch(argv = process.argv.slice(2)) {
  const { target, runRoot } = parseLauncherArgs(argv);
  const preflightResult = preflight({ target, runRoot, checkConfiguration: true });
  for (const directory of ["home", "config", "cache", "data", "state"].map((name) =>
    join(preflightResult.runRoot, "operator-runtime", name))) {
    mkdirSync(directory, { recursive: true });
  }
  const result = spawnSync(preflightResult.executable.path, [
    preflightResult.target,
    "--pure",
    "--agent",
    "orchestrator",
  ], {
    cwd: preflightResult.target,
    env: operatorChildEnvironment(preflightResult),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  launch();
}
