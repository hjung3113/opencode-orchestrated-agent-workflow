import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("OpenCode 1.18.5 exposes every capability required by M4", () => {
  const target = mkdtempSync(join(tmpdir(), "m4-opencode-target-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: target });
    execFileSync("git", ["config", "user.email", "m4@example.invalid"], { cwd: target });
    execFileSync("git", ["config", "user.name", "M4 Probe"], { cwd: target });
    writeFileSync(join(target, "tracked.txt"), "unchanged\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: target });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: target });

    const matrix = JSON.parse(execFileSync(process.execPath, [
      "scripts/probe-opencode-m4.mjs", "--target", target,
    ], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 60_000 }));

    assert.equal(matrix.schema_version, 1);
    assert.deepEqual(matrix.runtime, {
      executable: execFileSync("sh", ["-c", "command -v opencode"], { encoding: "utf8" }).trim(),
      version: "1.18.5",
    });
    assert.deepEqual(matrix.rows.map(({ id }) => id), [
      "bundle.external_assets",
      "permissions.ordered",
      "command.exact_arguments",
      "sessions.second_session",
      "tools.schema_and_events",
      "collisions.observable_inputs",
      "target.unchanged",
    ]);
    assert.deepEqual(matrix.rows.filter(({ status }) => status !== "pass"), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
