#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const targetIndex = args.indexOf("--target");
if (targetIndex < 0 || !args[targetIndex + 1]) {
  throw new Error("usage: probe-opencode-m4.mjs --target <clean-git-directory>");
}
const target = resolve(args[targetIndex + 1]);
const executable = execFileSync("sh", ["-c", "command -v opencode"], { encoding: "utf8" }).trim();
const version = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
assert.ok(version.length > 0, "OpenCode runtime identity must be observable");
const minimumOpenCodeVersion = [1, 18, 5];
const observedSegments = version.replace(/^v/i, "").split("-")[0].split(".").map((part) => Number.parseInt(part, 10));
let olderThanMinimum = false;
for (let index = 0; index < minimumOpenCodeVersion.length && !olderThanMinimum; index += 1) {
  const observed = Number.isNaN(observedSegments[index]) ? 0 : observedSegments[index];
  if (observed < minimumOpenCodeVersion[index]) olderThanMinimum = true;
  else if (observed > minimumOpenCodeVersion[index]) break;
}
assert.ok(!olderThanMinimum, `OpenCode ${minimumOpenCodeVersion.join(".")} or newer is required; found ${version}`);

const scratch = mkdtempSync(join(tmpdir(), "m4-opencode-probe-"));
const bundle = join(scratch, "bundle");
const globalRoot = join(scratch, "xdg", "config", "opencode");
const collisionTarget = join(scratch, "collision-target");
const rows = [];
let runtime;
let provider;

function write(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function json(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

const sorted = (items) => [...items].sort();

function command(path, marker) {
  write(path, `---\ndescription: ${marker}\nagent: orchestrator\nsubtask: false\n---\n\nBEGIN[$ARGUMENTS]END\n`);
}

function agent(path, marker, allowedTool = "orchestrator_operator", mode = "primary") {
  write(path, `---\ndescription: ${marker}\nmode: ${mode}\nmodel: m4-fixture/fixture\ntools:\n  "*": false\n  ${allowedTool}: true\npermission:\n  "*": deny\n  ${allowedTool}: allow\n---\n\nM4 capability fixture. Call ${allowedTool} once, then stop.\n`);
}

function skill(path, marker) {
  write(path, `---\nname: ${basename(resolve(path, ".."))}\ndescription: ${marker}\n---\n\n# ${marker}\n`);
}

function tool(path, marker) {
  write(path, `import { tool } from "@opencode-ai/plugin";\n\nexport default tool({\n  description: ${JSON.stringify(marker)},\n  args: { value: tool.schema.string() },\n  async execute(args, context) {\n    return JSON.stringify({ marker: ${JSON.stringify(marker)}, value: args.value, session_id: context.sessionID });\n  },\n});\n`);
}

function plugin(path, marker) {
  write(path, `export default async () => ({ marker: ${JSON.stringify(marker)} });\n`);
}

function source(scope, root, marker) {
  command(join(root, "commands", "orchestrate.md"), marker);
  agent(join(root, "agents", "orchestrator.md"), marker);
  tool(join(root, "tools", "orchestrator_operator.ts"), marker);
  tool(join(root, "tools", "request_route.ts"), `${marker}-request-route`);
  if (scope === "bundle") {
    for (const name of ["orchestrate-status", "orchestrate-resume", "orchestrate-cancel"]) {
      command(join(root, "commands", `${name}.md`), `${marker}-${name}`);
    }
    agent(join(root, "agents", "request-route-probe.md"), `${marker}-request-route`, "request_route", "subagent");
    return;
  }
  command(join(root, "commands", `${scope}-only.md`), `${scope}-only-marker`);
  agent(join(root, "agents", `${scope}-only.md`), `${scope}-only-marker`);
  tool(join(root, "tools", `${scope}_only.ts`), `${scope}-only-marker`);
  skill(join(root, "skills", "m4-skill", "SKILL.md"), marker);
  skill(join(root, "skills", `${scope}-only`, "SKILL.md"), `${scope}-only-marker`);
  plugin(join(root, "plugins", "collision.js"), marker);
  plugin(join(root, "plugins", `${scope}-only.js`), `${scope}-only-marker`);
  write(join(root, "collision.md"), `${marker}\n`);
  write(join(root, `${scope}-only-instruction.md`), `${scope}-only-marker\n`);
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitFor(port, path = "/global/health") {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.ok) return response;
    } catch { /* server is starting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`OpenCode server did not expose ${path}`);
}

async function request(port, path, options) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: options?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!response.ok) throw new Error(`OpenCode HTTP ${response.status}: ${path}`);
  return response.status === 204 ? null : response.json();
}

function subscribe(port) {
  const events = [];
  const controller = new AbortController();
  const decoder = new TextDecoder();
  const ready = (async () => {
    const response = await fetch(`http://127.0.0.1:${port}/event`, { signal: controller.signal });
    const reader = response.body.getReader();
    let buffer = "";
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const records = buffer.split("\n\n");
          buffer = records.pop();
          for (const record of records) {
            const line = record.split("\n").find((item) => item.startsWith("data: "));
            if (line) events.push(JSON.parse(line.slice(6)));
          }
        }
      } catch (error) {
        if (error.name !== "AbortError") throw error;
      }
    })();
  })();
  return { events, ready, close: () => controller.abort() };
}

function startProvider() {
  const observed = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url?.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }));
      return;
    }
    const body = JSON.parse(raw);
    observed.push(body);
    const hasToolResult = body.messages?.at(-1)?.role === "tool";
    res.setHeader("content-type", "text/event-stream");
    const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: "m4-fixture", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    if (hasToolResult) {
      chunk({ role: "assistant", content: "fixture complete" });
      chunk({}, "stop");
    } else {
      const availableTools = body.tools?.map(({ function: definition }) => definition.name) ?? [];
      const toolName = availableTools.includes("orchestrator_operator")
        ? "orchestrator_operator" : "request_route";
      const content = body.messages?.findLast(({ role }) => role === "user")?.content ?? "";
      const value = content.match(/^BEGIN\[([\s\S]*)\]END$/)?.[1] ?? content;
      chunk({ role: "assistant", tool_calls: [{
        index: 0, id: `call_${observed.length}`, type: "function",
        function: { name: toolName, arguments: JSON.stringify({ value }) },
      }] });
      chunk({}, "tool_calls");
    }
    res.end("data: [DONE]\n\n");
  });
  return { server, observed };
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit");
}

try {
  const providerPort = await freePort();
  provider = startProvider();
  provider.server.listen(providerPort, "127.0.0.1");
  await once(provider.server, "listening");

  source("bundle", bundle, "bundle-marker");
  mkdirSync(collisionTarget, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: collisionTarget });
  source("target", join(collisionTarget, ".opencode"), "target-marker");
  json(join(collisionTarget, "opencode.json"), {
    $schema: "https://opencode.ai/config.json",
    instructions: [
      join(collisionTarget, ".opencode", "collision.md"),
      join(collisionTarget, ".opencode", "target-only-instruction.md"),
    ],
    plugin: [
      `file://${join(collisionTarget, ".opencode", "plugins", "collision.js")}`,
      `file://${join(collisionTarget, ".opencode", "plugins", "target-only.js")}`,
    ],
    mcp: {
      collision: { type: "local", command: ["false", "target"], enabled: false },
      target_marker: { type: "local", command: ["false"], enabled: false },
    },
  });
  json(join(bundle, "opencode.json"), {
    $schema: "https://opencode.ai/config.json",
    model: "m4-fixture/fixture",
    default_agent: "orchestrator",
    provider: {
      "m4-fixture": {
        npm: "@ai-sdk/openai-compatible",
        name: "M4 Fixture",
        options: { baseURL: `http://127.0.0.1:${providerPort}/v1`, apiKey: "fixture" },
        models: { fixture: { name: "fixture" } },
      },
    },
  });
  const env = {
    ...process.env,
    HOME: join(scratch, "home"),
    XDG_CONFIG_HOME: join(scratch, "xdg", "config"),
    XDG_CACHE_HOME: join(scratch, "xdg", "cache"),
    XDG_DATA_HOME: join(scratch, "xdg", "data"),
    XDG_STATE_HOME: join(scratch, "xdg", "state"),
    OPENCODE_CONFIG_DIR: bundle,
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
  };
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_CONFIG_CONTENT;
  mkdirSync(env.HOME, { recursive: true });
  const baseline = {
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--porcelain=v2", "--untracked-files=all", "--ignored"], { cwd: target, encoding: "utf8" }),
  };
  let port = await freePort();
  runtime = spawn(executable, ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: target, env, stdio: "ignore",
  });
  await waitFor(port);

  const directory = `?directory=${encodeURIComponent(target)}`;
  const collisionDirectory = `?directory=${encodeURIComponent(collisionTarget)}`;
  const [commands, agents, skills, toolIds, tools, config, mcp] = await Promise.all([
    request(port, `/command${directory}`),
    request(port, `/agent${directory}`),
    request(port, `/skill${directory}`),
    request(port, `/experimental/tool/ids${directory}`),
    request(port, `/experimental/tool${directory}&provider=m4-fixture&model=fixture`),
    request(port, `/config${directory}`),
    request(port, `/mcp${directory}`),
  ]);
  const orchestrate = commands.find(({ name }) => name === "orchestrate");
  const orchestrator = agents.find(({ name }) => name === "orchestrator");
  const operatorTool = tools.find(({ id }) => id === "orchestrator_operator");
  const requestRouteTool = tools.find(({ id }) => id === "request_route");
  assert.equal(orchestrate.description, "bundle-marker");
  assert.equal(orchestrate.subtask, false);
  assert.equal(orchestrator.description, "bundle-marker");
  assert.equal(operatorTool.description, "bundle-marker");
  assert.equal(requestRouteTool.description, "bundle-marker-request-route");
  for (const definition of [operatorTool, requestRouteTool]) {
    assert.equal(definition.parameters.type, "object");
    assert.deepEqual(definition.parameters.properties, { value: { type: "string" } });
    assert.deepEqual(definition.parameters.required, ["value"]);
  }
  for (const name of ["orchestrate", "orchestrate-status", "orchestrate-resume", "orchestrate-cancel"]) {
    const definition = commands.find((item) => item.name === name);
    assert.equal(definition.agent, "orchestrator");
    assert.equal(definition.subtask, false);
    assert.ok(definition.description.startsWith("bundle-marker"));
  }
  assert.deepEqual(sorted(commands.map(({ name }) => name)), sorted([
    "init", "review", "customize-opencode", "orchestrate", "orchestrate-status",
    "orchestrate-resume", "orchestrate-cancel",
  ]));
  assert.deepEqual(sorted(agents.map(({ name }) => name)), sorted([
    "orchestrator", "request-route-probe", "build", "plan", "general", "explore", "compaction", "summary", "title",
  ]));
  assert.deepEqual(sorted(toolIds), sorted([
    "invalid", "question", "bash", "read", "glob", "grep", "edit", "write", "task",
    "webfetch", "todowrite", "websearch", "skill", "apply_patch",
    "orchestrator_operator", "request_route",
  ]));
  assert.deepEqual(skills.map(({ name }) => name), ["customize-opencode"]);
  assert.deepEqual(config.instructions ?? [], []);
  assert.deepEqual(config.plugin ?? [], []);
  assert.deepEqual(config.mcp ?? {}, {});
  assert.deepEqual(mcp, {});
  rows.push({ id: "bundle.external_assets", status: "pass", evidence: {
    config_dir: bundle,
    commands: commands.map(({ name, description, subtask }) => ({ name, description, subtask })),
    agents: agents.map(({ name, description, mode, native }) => ({ name, description, mode, native })),
    tool_ids: toolIds,
    tool_schemas: { orchestrator_operator: operatorTool.parameters, request_route: requestRouteTool.parameters },
    skills: skills.map(({ name, description, location }) => ({ name, description, location })),
    config: { instructions: config.instructions, plugin: config.plugin, mcp: config.mcp },
    mcp_status: mcp,
  } });

  const permissionOrder = orchestrator.permission.map(({ permission, pattern, action }) => ({
    permission, pattern, action,
  }));
  const denyIndex = permissionOrder.findIndex(({ permission, pattern, action }) =>
    permission === "*" && pattern === "*" && action === "deny");
  const allowIndex = permissionOrder.findIndex(({ permission, pattern, action }) =>
    permission === "orchestrator_operator" && pattern === "*" && action === "allow");
  assert.ok(denyIndex >= 0 && allowIndex > denyIndex);
  assert.deepEqual(permissionOrder.slice(allowIndex + 1), [{
    permission: "external_directory",
    pattern: join(env.XDG_DATA_HOME, "opencode", "tool-output", "*"),
    action: "allow",
  }]);
  const permissionRow = { id: "permissions.ordered", status: "pass", evidence: {
    permission_order: permissionOrder,
  } };
  rows.push(permissionRow);

  const subscription = subscribe(port);
  await subscription.ready;
  const session = await request(port, `/session${directory}`, {
    method: "POST", body: JSON.stringify({ title: "m4-exact-input" }),
  });
  const exactArguments = [
    " leading and trailing ", "multiple   spaces", "line one\nline two", "'quotes' \"double\"",
    "$HOME; $(touch nope) | &", "**Markdown** `code`", "유니코드 /orchestrate --fake",
  ];
  for (const argumentsValue of exactArguments) {
    await request(port, `/session/${session.id}/command${directory}`, {
      method: "POST", body: JSON.stringify({ command: "orchestrate", arguments: argumentsValue }),
    });
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  const observedInputs = provider.observed
    .map(({ messages }) => messages?.findLast(({ role }) => role === "user")?.content)
    .filter(Boolean);
  for (const argumentsValue of exactArguments) {
    assert.ok(observedInputs.some((content) => content === `BEGIN[${argumentsValue}]END`));
  }
  const exposedTools = provider.observed[0].tools.map(({ function: definition }) => definition.name);
  assert.deepEqual(exposedTools, ["orchestrator_operator"]);
  permissionRow.evidence.exposed_tool_ids = exposedTools;
  rows.push({ id: "command.exact_arguments", status: "pass", evidence: {
    cases: exactArguments, observed: observedInputs.filter((item) => item.startsWith("BEGIN[")),
  } });

  const messages = await request(port, `/session/${session.id}/message${directory}`);
  const toolParts = messages.flatMap(({ parts }) => parts)
    .filter(({ type, state }) => type === "tool" && state?.status === "completed");
  assert.ok(toolParts.some(({ tool, state }) => tool === "orchestrator_operator"
    && exactArguments.includes(state.input.value)
    && JSON.parse(state.output).marker === "bundle-marker"
    && JSON.parse(state.output).value === state.input.value));

  const secondSession = await request(port, `/session${directory}`, {
    method: "POST", body: JSON.stringify({ title: "m4-second-session" }),
  });
  assert.notEqual(secondSession.id, session.id);
  await request(port, `/session/${secondSession.id}/command${directory}`, {
    method: "POST", body: JSON.stringify({ command: "orchestrate-status", arguments: session.id }),
  });
  const secondMessages = await request(port, `/session/${secondSession.id}/message${directory}`);
  const secondControl = secondMessages.flatMap(({ parts }) => parts).find(({ type, tool, state }) =>
    type === "tool" && tool === "orchestrator_operator" && state?.status === "completed");
  assert.equal(secondControl.state.input.value, session.id);
  assert.equal(JSON.parse(secondControl.state.output).session_id, secondSession.id);
  rows.push({ id: "sessions.second_session", status: "pass", evidence: {
    original_session_id: session.id,
    second_session_id: secondSession.id,
    addressed_original: secondControl.state.input.value,
    control_tool_session_id: JSON.parse(secondControl.state.output).session_id,
  } });

  const routeSession = await request(port, `/session${directory}`, {
    method: "POST", body: JSON.stringify({ title: "m4-request-route" }),
  });
  await request(port, `/session/${routeSession.id}/message${directory}`, {
    method: "POST",
    body: JSON.stringify({
      agent: "request-route-probe",
      parts: [{ type: "text", text: "route fixture" }],
    }),
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  subscription.close();
  const routeMessages = await request(port, `/session/${routeSession.id}/message${directory}`);
  const routePart = routeMessages.flatMap(({ parts }) => parts).find(({ type, tool, state }) =>
    type === "tool" && tool === "request_route" && state?.status === "completed");
  assert.equal(routePart.state.input.value, "route fixture");
  assert.equal(JSON.parse(routePart.state.output).marker, "bundle-marker-request-route");
  const eventTypes = subscription.events.map(({ type }) => type);
  const toolEvents = subscription.events
    .map(({ properties }) => properties?.part)
    .filter(({ type, tool, state } = {}) => type === "tool"
      && ["orchestrator_operator", "request_route"].includes(tool)
      && state?.status === "completed");
  assert.deepEqual(sorted(new Set(toolEvents.map(({ tool }) => tool))), ["orchestrator_operator", "request_route"]);
  for (const part of toolEvents) {
    assert.ok(part.callID);
    const output = JSON.parse(part.state.output);
    if (part.tool === "orchestrator_operator") {
      assert.ok(exactArguments.includes(part.state.input.value) || part.state.input.value === session.id);
      assert.equal(output.marker, "bundle-marker");
    } else {
      assert.equal(part.state.input.value, "route fixture");
      assert.equal(output.marker, "bundle-marker-request-route");
    }
  }
  rows.push({ id: "tools.schema_and_events", status: "pass", evidence: {
    schemas: {
      orchestrator_operator: operatorTool.parameters,
      request_route: requestRouteTool.parameters,
    },
    completed_calls: toolParts.length,
    event_types: [...new Set(eventTypes)],
    completed_event_tools: sorted(new Set(toolEvents.map(({ tool }) => tool))),
  } });

  await stop(runtime);
  const collisionConfigRoot = join(collisionTarget, ".opencode");
  write(join(collisionConfigRoot, ".gitignore"), "node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n");
  for (const name of ["package.json", "package-lock.json", "bun.lock"]) {
    if (existsSync(join(bundle, name))) copyFileSync(join(bundle, name), join(collisionConfigRoot, name));
  }
  symlinkSync(join(bundle, "node_modules"), join(collisionConfigRoot, "node_modules"), "dir");
  for (const [root, marker] of [
    [join(env.HOME, ".agents", "skills"), "home-agents-marker"],
    [join(env.HOME, ".claude", "skills"), "home-claude-marker"],
  ]) {
    skill(join(root, "m4-skill", "SKILL.md"), marker);
    skill(join(root, `${marker}-only`, "SKILL.md"), `${marker}-only`);
  }
  execFileSync("git", ["config", "user.email", "m4@example.invalid"], { cwd: collisionTarget });
  execFileSync("git", ["config", "user.name", "M4 Probe"], { cwd: collisionTarget });
  execFileSync("git", ["add", "-f", "."], { cwd: collisionTarget });
  execFileSync("git", ["commit", "-qm", "collision fixture"], { cwd: collisionTarget });
  const collisionBaseline = {
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: collisionTarget, encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--porcelain=v2", "--untracked-files=all", "--ignored"], { cwd: collisionTarget, encoding: "utf8" }),
  };
  source("global", globalRoot, "global-marker");
  json(join(globalRoot, "opencode.json"), {
    $schema: "https://opencode.ai/config.json",
    instructions: [join(globalRoot, "collision.md"), join(globalRoot, "global-only-instruction.md")],
    plugin: [
      `file://${join(globalRoot, "plugins", "collision.js")}`,
      `file://${join(globalRoot, "plugins", "global-only.js")}`,
    ],
    mcp: {
      collision: { type: "local", command: ["false", "global"], enabled: false },
      global_marker: { type: "local", command: ["false"], enabled: false },
    },
  });
  port = await freePort();
  runtime = spawn(executable, ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: collisionTarget, env, stdio: "ignore",
  });
  await waitFor(port);

  const [collisionCommands, collisionAgents, collisionSkills, collisionTools, collisionConfig] = await Promise.all([
    request(port, `/command${collisionDirectory}`),
    request(port, `/agent${collisionDirectory}`),
    request(port, `/skill${collisionDirectory}`),
    request(port, `/experimental/tool${collisionDirectory}&provider=m4-fixture&model=fixture`),
    request(port, `/config${collisionDirectory}`),
  ]);
  const collisionCommand = collisionCommands.find(({ name }) => name === "orchestrate");
  const collisionAgent = collisionAgents.find(({ name }) => name === "orchestrator");
  const collisionSkill = collisionSkills.find(({ name }) => name === "m4-skill");
  const collisionOperatorTools = collisionTools.filter(({ id }) => id === "orchestrator_operator");
  assert.ok(collisionCommands.some(({ name }) => name === "init"));
  assert.ok(collisionCommands.some(({ name, description }) => name === "global-only" && description === "global-only-marker"));
  assert.ok(collisionCommands.some(({ name, description }) => name === "target-only" && description === "target-only-marker"));
  assert.ok(collisionAgents.some(({ name, description }) => name === "global-only" && description === "global-only-marker"));
  assert.ok(collisionAgents.some(({ name, description }) => name === "target-only" && description === "target-only-marker"));
  assert.ok(collisionSkills.some(({ name, description }) => name === "global-only" && description === "global-only-marker"));
  assert.ok(collisionSkills.some(({ name, description }) => name === "target-only" && description === "target-only-marker"));
  assert.ok(collisionTools.some(({ id, description }) => id === "global_only" && description === "global-only-marker"));
  assert.ok(collisionTools.some(({ id, description }) => id === "target_only" && description === "target-only-marker"));
  assert.equal(collisionCommand.description, "bundle-marker");
  assert.equal(collisionAgent.description, "bundle-marker");
  const selectedSkillLocation = realpathSync(collisionSkill.location);
  assert.ok([
    realpathSync(join(globalRoot, "skills", "m4-skill", "SKILL.md")),
    realpathSync(join(collisionTarget, ".opencode", "skills", "m4-skill", "SKILL.md")),
    realpathSync(join(env.HOME, ".agents", "skills", "m4-skill", "SKILL.md")),
  ].includes(selectedSkillLocation));
  assert.ok(readFileSync(selectedSkillLocation, "utf8").includes(`description: ${collisionSkill.description}`));
  assert.deepEqual(sorted(collisionOperatorTools.map(({ description }) => description)), [
    "bundle-marker", "global-marker", "target-marker",
  ]);
  assert.deepEqual(sorted(collisionCommands.map(({ name }) => name)), sorted([
    "init", "review", "customize-opencode", "orchestrate", "orchestrate-status",
    "orchestrate-resume", "orchestrate-cancel", "m4-skill", "global-only", "target-only",
    "home-agents-marker-only",
  ]));
  assert.deepEqual(sorted(collisionAgents.map(({ name }) => name)), sorted([
    "orchestrator", "build", "plan", "general", "explore", "compaction", "summary", "title",
    "request-route-probe", "global-only", "target-only",
  ]));
  assert.deepEqual(sorted(collisionTools.map(({ id }) => id)), sorted([
    "invalid", "question", "bash", "read", "glob", "grep", "edit", "write", "task",
    "webfetch", "todowrite", "skill", "orchestrator_operator", "orchestrator_operator",
    "orchestrator_operator", "request_route", "request_route", "request_route",
    "global_only", "target_only",
  ]));
  assert.deepEqual(sorted(collisionSkills.map(({ name }) => name)), sorted([
    "customize-opencode", "m4-skill", "global-only", "target-only", "home-agents-marker-only",
  ]));
  assert.ok(!collisionSkills.some(({ description }) => description.startsWith("home-claude-marker")));
  assert.ok(collisionConfig.instructions.includes(join(globalRoot, "global-only-instruction.md")));
  assert.ok(collisionConfig.instructions.includes(join(collisionTarget, ".opencode", "target-only-instruction.md")));
  assert.ok(collisionConfig.plugin.includes(`file://${join(globalRoot, "plugins", "global-only.js")}`));
  assert.ok(collisionConfig.plugin.includes(`file://${join(collisionTarget, ".opencode", "plugins", "target-only.js")}`));
  assert.deepEqual(Object.keys(collisionConfig.mcp).sort(), ["collision", "global_marker", "target_marker"]);
  assert.equal(collisionConfig.mcp.collision.command.at(-1), "target");
  assert.deepEqual(sorted(collisionConfig.instructions), sorted([
    join(globalRoot, "collision.md"), join(globalRoot, "global-only-instruction.md"),
    join(collisionTarget, ".opencode", "collision.md"),
    join(collisionTarget, ".opencode", "target-only-instruction.md"),
  ]));
  assert.deepEqual(sorted(new Set(collisionConfig.plugin.map((url) => realpathSync(fileURLToPath(url))))), sorted([
    realpathSync(join(globalRoot, "plugins", "collision.js")),
    realpathSync(join(globalRoot, "plugins", "global-only.js")),
    realpathSync(join(collisionTarget, ".opencode", "plugins", "collision.js")),
    realpathSync(join(collisionTarget, ".opencode", "plugins", "target-only.js")),
  ]));
  const collisionSources = Object.fromEntries(["global", "target", "bundle"].map((scope) => {
    const root = scope === "global" ? globalRoot
      : scope === "target" ? join(collisionTarget, ".opencode") : bundle;
    return [scope, {
      command: join(root, "commands", "orchestrate.md"),
      agent: join(root, "agents", "orchestrator.md"),
      tool: join(root, "tools", "orchestrator_operator.ts"),
      ...(scope === "bundle" ? {} : {
        plugin: join(root, "plugins", "collision.js"),
        instruction: join(root, "collision.md"),
        skill: join(root, "skills", "m4-skill", "SKILL.md"),
      }),
    }];
  }));
  collisionSources.home_agents = {
    skill: join(env.HOME, ".agents", "skills", "m4-skill", "SKILL.md"),
  };
  collisionSources.home_claude_disabled = {
    skill: join(env.HOME, ".claude", "skills", "m4-skill", "SKILL.md"),
  };
  for (const paths of Object.values(collisionSources)) {
    for (const path of Object.values(paths)) assert.ok(readFileSync(path, "utf8").includes("marker"));
  }
  rows.push({ id: "collisions.observable_inputs", status: "pass", evidence: {
    effective_catalog: {
      command: collisionCommand.description,
      agent: collisionAgent.description,
      skill: { description: collisionSkill.description, location: selectedSkillLocation },
      mcp: collisionConfig.mcp.collision.command.at(-1),
    },
    same_name: {
      command: collisionCommand.description,
      agent: collisionAgent.description,
      tools: collisionOperatorTools.map(({ description }) => description),
      skill: { description: collisionSkill.description, location: selectedSkillLocation },
    },
    sources: collisionSources,
    residual_builtins: collisionCommands.filter(({ name }) => ["init", "review"].includes(name)).map(({ name }) => name),
    unrelated: {
      commands: collisionCommands.filter(({ name }) => name.endsWith("-only")).map(({ name }) => name),
      agents: collisionAgents.filter(({ name }) => name.endsWith("-only")).map(({ name }) => name),
      tools: collisionTools.filter(({ id }) => id.endsWith("_only")).map(({ id }) => id),
      skills: collisionSkills.filter(({ name }) => name.endsWith("-only")).map(({ name }) => name),
    },
    instructions: collisionConfig.instructions,
    plugins: collisionConfig.plugin,
    mcp: collisionConfig.mcp,
  } });

  const after = {
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--porcelain=v2", "--untracked-files=all", "--ignored"], { cwd: target, encoding: "utf8" }),
  };
  assert.deepEqual(after, baseline);
  const collisionAfter = {
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: collisionTarget, encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--porcelain=v2", "--untracked-files=all", "--ignored"], { cwd: collisionTarget, encoding: "utf8" }),
    diff: execFileSync("git", ["diff", "--no-ext-diff"], { cwd: collisionTarget, encoding: "utf8" }),
  };
  assert.deepEqual(collisionAfter, { ...collisionBaseline, diff: "" });
  rows.push({ id: "target.unchanged", status: "pass", evidence: {
    clean_target: after,
    collision_target: collisionAfter,
  } });
} finally {
  await stop(runtime);
  provider?.server.close();
  if (provider?.server.listening) await once(provider.server, "close");
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  runtime: { executable, version },
  rows,
}, null, 2)}\n`);
