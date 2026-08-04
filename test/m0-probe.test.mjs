import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("probe reports the live OpenCode version as an M1 matrix row", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const matrix = JSON.parse(stdout);
    const expectedVersion = execFileSync("opencode", ["--version"], {
      encoding: "utf8",
    }).trim();

    assert.equal(matrix.schema_version, 1);
    assert.equal(matrix.runtime.name, "opencode");
    assert.equal(matrix.runtime.version, expectedVersion);
    assert.deepEqual(matrix.rows[0], {
      id: "runtime.version",
      gates: ["M1"],
      status: "pass",
      evidence: { version: expectedVersion },
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe rejects undeclared effective OpenCode configuration", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    writeFileSync(join(fixture, "undeclared.md"), "undeclared instruction\n");
    writeFileSync(
      join(fixture, "opencode.json"),
      JSON.stringify({ instructions: ["undeclared.md"] }),
    );

    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const matrix = JSON.parse(stdout);
    const row = matrix.rows.find(({ id }) => id === "configuration.resolved");

    assert.match(row.evidence.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(row.id, "configuration.resolved");
    assert.deepEqual(row.gates, ["M1"]);
    assert.equal(row.status, "incompatible");
    assert.ok(row.evidence.undeclared.includes("instruction:undeclared.md"));
    assert.deepEqual(row.incompatibility, {
      type: "runtime_configuration_conflict",
      message: "effective OpenCode configuration contains undeclared sources",
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe starts and stops a real headless OpenCode server", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const matrix = JSON.parse(stdout);
    const row = matrix.rows.find(({ id }) => id === "server.health");

    assert.equal(row.status, "pass");
    assert.equal(row.evidence.healthy, true);
    assert.equal(row.evidence.version, matrix.runtime.version);
    assert.equal(row.evidence.stopped, true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe creates fresh planner, worker, and verifier sessions", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const matrix = JSON.parse(stdout);
    const row = matrix.rows.find(({ id }) => id === "sessions.fresh_roles");
    const ids = Object.values(row.evidence.sessions);

    assert.equal(row.status, "pass");
    assert.deepEqual(Object.keys(row.evidence.sessions), ["planner", "worker", "verifier"]);
    assert.equal(new Set(ids).size, 3);
    assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe binds resolved role identities and records a real message", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const matrix = JSON.parse(stdout);
    const bindings = matrix.rows.find(({ id }) => id === "sessions.role_bindings");
    const message = matrix.rows.find(({ id }) => id === "message.observed");

    assert.equal(bindings.status, "pass");
    assert.deepEqual(Object.keys(bindings.evidence.bindings), ["planner", "worker", "verifier"]);
    for (const [role, binding] of Object.entries(bindings.evidence.bindings)) {
      assert.equal(binding.agent, `m0-${role}`);
      assert.equal(binding.model, "opencode/big-pickle");
      assert.match(binding.agent_identity, /^sha256:[a-f0-9]{64}$/);
    }
    assert.notEqual(
      bindings.evidence.bindings.worker.agent_identity,
      bindings.evidence.bindings.verifier.agent_identity,
    );

    assert.equal(message.status, "pass");
    assert.match(message.evidence.message_id, /^msg/);
    assert.equal(message.evidence.session_id, bindings.evidence.bindings.planner.session_id);
    assert.ok(message.evidence.events.includes("message.updated"));
    assert.equal(message.evidence.exit_reason, "idle");
    assert.ok(["available", "unavailable"].includes(message.evidence.usage.status));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe reports every M1 prerequisite without inferred success", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const matrix = JSON.parse(stdout);
    const required = [
      "runtime.version",
      "configuration.resolved",
      "server.health",
      "sessions.fresh_roles",
      "sessions.role_bindings",
      "message.observed",
      "terminal.runtime_failure",
      "deadline.abort_and_stop",
      "workspace.output_snapshot",
      "capabilities.narrowed",
      "commands.exact_admission",
      "skills.resolved",
      "operator.cancel_and_observe",
      "operator.cancel_unconfirmed_reconcile",
    ];

    assert.deepEqual(matrix.rows.map(({ id }) => id), required);
    for (const row of matrix.rows) {
      assert.ok(["pass", "incompatible"].includes(row.status));
      if (row.status === "incompatible") {
        assert.equal(typeof row.incompatibility?.type, "string");
        assert.equal(typeof row.incompatibility?.message, "string");
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe observes a typed terminal runtime failure", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const row = JSON.parse(stdout).rows.find(({ id }) => id === "terminal.runtime_failure");

    assert.equal(row.status, "pass");
    assert.equal(row.evidence.exit_reason, "runtime_error");
    assert.equal(row.evidence.http_status, 500);
    assert.match(row.evidence.session_id, /^ses/);
    assert.ok(row.evidence.events.includes("session.error"));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe aborts at deadline and confirms the runtime stopped", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const row = JSON.parse(stdout).rows.find(({ id }) => id === "deadline.abort_and_stop");

    assert.equal(row.status, "pass");
    assert.equal(row.evidence.exit_reason, "deadline_exceeded");
    assert.equal(row.evidence.prompt_http_status, 204);
    assert.equal(row.evidence.abort_confirmed, true);
    assert.equal(row.evidence.runtime_stopped, true);
    assert.ok(row.evidence.events.includes("session.status"));
    assert.equal(row.evidence.deadline_ms, 25);
    assert.equal(row.evidence.deadline_fired, true);
    assert.ok(row.evidence.observed_statuses.includes("idle"));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe confirms M2 operator cancellation and later session observation", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));
  try {
    const matrix = JSON.parse(execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    ));
    const row = matrix.rows.find(({ id }) => id === "operator.cancel_and_observe");
    assert.equal(row.status, "pass");
    assert.deepEqual(row.gates, ["M2"]);
    assert.equal(row.evidence.cancel_confirmed, true);
    assert.equal(row.evidence.runtime_stopped, true);
    assert.equal(row.evidence.observed_session_id, row.evidence.session_id);
    assert.notEqual(row.evidence.session_id, matrix.rows.find(({ id }) => id === "deadline.abort_and_stop").evidence.session_id);
    const unconfirmed = matrix.rows.find(({ id }) => id === "operator.cancel_unconfirmed_reconcile");
    assert.equal(unconfirmed.status, "pass");
    assert.equal(unconfirmed.gates.includes("M2"), true);
    assert.equal(unconfirmed.evidence.runtime_active_before_cancel, true);
    assert.equal(unconfirmed.evidence.status_before_cancel, "busy");
    assert.equal(unconfirmed.evidence.cancel_request_sent_before_process_death, true);
    assert.equal(unconfirmed.evidence.cancel_unconfirmed_before_process_death, true);
    assert.equal(unconfirmed.evidence.abort_response_before_process_death, false);
    assert.equal(unconfirmed.evidence.process_died, true);
    assert.equal(unconfirmed.evidence.reconnected_session_id, unconfirmed.evidence.session_id);
    assert.equal(unconfirmed.evidence.reconnect_abort_confirmed, true);
    assert.equal(unconfirmed.evidence.runtime_stopped, true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe captures the complete workspace diff and canonical Output Snapshot", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    execFileSync("git", ["init", "-q"], { cwd: fixture });
    execFileSync("git", ["config", "user.email", "m0@example.invalid"], { cwd: fixture });
    execFileSync("git", ["config", "user.name", "M0 Probe"], { cwd: fixture });
    writeFileSync(join(fixture, "tracked.txt"), "before\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: fixture });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: fixture });
    writeFileSync(join(fixture, "tracked.txt"), "after\n");
    writeFileSync(join(fixture, "untracked.txt"), "new\n");

    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const row = JSON.parse(stdout).rows.find(({ id }) => id === "workspace.output_snapshot");

    assert.equal(row.status, "pass");
    assert.deepEqual(row.evidence.changed_paths, ["tracked.txt", "untracked.txt"]);
    assert.match(row.evidence.base, /^[a-f0-9]{40}$/);
    assert.match(row.evidence.snapshot_digest, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(row.evidence.entries.map(({ path }) => path), ["tracked.txt", "untracked.txt"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe mediates one exact admitted command in a narrowed host runner", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const row = JSON.parse(stdout).rows.find(({ id }) => id === "commands.exact_admission");

    assert.equal(row.status, "pass");
    assert.equal(row.evidence.exact_argv_executed, true);
    assert.equal(row.evidence.altered_argv_denied, true);
    assert.equal(row.evidence.credentials_removed, true);
    assert.equal(row.evidence.outbound_network_denied, true);
    assert.deepEqual(row.evidence.altered_request, {
      admitted: false,
      type: "command_not_admitted",
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe resolves a declared repository skill and rejects a missing skill", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    const skillDirectory = join(fixture, ".opencode", "skills", "m0-declared");
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(
      join(skillDirectory, "SKILL.md"),
      "---\nname: m0-declared\nversion: 1\n---\n\n# M0 declared skill\n",
    );
    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const row = JSON.parse(stdout).rows.find(({ id }) => id === "skills.resolved");

    assert.equal(row.status, "pass");
    assert.deepEqual(row.evidence.declared, {
      id: "m0-declared",
      version: "1",
      source: ".opencode/skills/m0-declared/SKILL.md",
      digest: row.evidence.declared.digest,
    });
    assert.match(row.evidence.declared.digest, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(row.evidence.unavailable, {
      id: "m0-unavailable",
      rejected: true,
      type: "dependency_unavailable",
    });
    assert.equal(row.evidence.runtime_endpoint, "/skill");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe rejects undeclared effective agents", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));
  try {
    writeFileSync(join(fixture, "opencode.json"), JSON.stringify({
      agent: { surprise: { model: "opencode/big-pickle" } },
    }));
    const matrix = JSON.parse(execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    ));
    const row = matrix.rows.find(({ id }) => id === "configuration.resolved");
    assert.equal(row.status, "incompatible");
    assert.ok(row.evidence.undeclared.includes("agent:surprise"));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("Output Snapshot records symlinks without reading their targets", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: fixture });
    execFileSync("git", ["config", "user.email", "m0@example.invalid"], { cwd: fixture });
    execFileSync("git", ["config", "user.name", "M0 Probe"], { cwd: fixture });
    writeFileSync(join(fixture, "base.txt"), "base\n");
    execFileSync("git", ["add", "base.txt"], { cwd: fixture });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: fixture });
    symlinkSync("/etc/hosts", join(fixture, "outside-link"));
    const matrix = JSON.parse(execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    ));
    const entry = matrix.rows.find(({ id }) => id === "workspace.output_snapshot")
      .evidence.entries.find(({ path }) => path === "outside-link");
    assert.equal(entry.mode, "120000");
    assert.equal(entry.target, "/etc/hosts");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("probe emits a fail-closed matrix when setup fails", () => {
  const missing = join(tmpdir(), "m0-definitely-missing-workspace");
  const stdout = execFileSync(
    process.execPath,
    ["scripts/probe-opencode.mjs", "--workspace", missing],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  const matrix = JSON.parse(stdout);
  assert.equal(matrix.rows.length, 14);
  assert.ok(matrix.rows.every(({ status, incompatibility }) =>
    status === "incompatible" && incompatibility?.type === "runtime_unreachable"));
});

test("complete M1 capability matrix passes in one disposable fixture", () => {
  const fixture = mkdtempSync(join(tmpdir(), "opencode-m0-probe-"));

  try {
    execFileSync("git", ["init", "-q"], { cwd: fixture });
    execFileSync("git", ["config", "user.email", "m0@example.invalid"], { cwd: fixture });
    execFileSync("git", ["config", "user.name", "M0 Probe"], { cwd: fixture });
    writeFileSync(join(fixture, "tracked.txt"), "before\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: fixture });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: fixture });
    writeFileSync(join(fixture, "tracked.txt"), "after\n");
    const skillDirectory = join(fixture, ".opencode", "skills", "m0-declared");
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(
      join(skillDirectory, "SKILL.md"),
      "---\nname: m0-declared\nversion: 1\n---\n\n# M0 declared skill\n",
    );

    const stdout = execFileSync(
      process.execPath,
      ["scripts/probe-opencode.mjs", "--workspace", fixture],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    const matrix = JSON.parse(stdout);

    assert.equal(matrix.rows.length, 14);
    assert.deepEqual(
      matrix.rows.filter(({ gates, status }) => gates.includes("M1") && status !== "pass"),
      [],
    );
    assert.deepEqual(
      matrix.rows.filter(({ gates, status }) => gates.includes("M2") && status !== "pass"),
      [],
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
