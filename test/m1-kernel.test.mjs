import assert from "node:assert/strict";
import test from "node:test";
import { StateConflict, transitionRun } from "../scripts/local-change.mjs";

test("kernel transition is compare-and-swap and idempotent", () => {
  const state = {
    state_version: 1,
    transitions: [],
    lifecycle_state: "pre_intake",
    admission_state: "pre_intake",
  };
  const next = transitionRun(state, {
    eventId: "request_admitted-2",
    eventKind: "request_admitted",
    expectedStateVersion: 1,
    patch: { lifecycle_state: "active", admission_state: "admitted" },
  });
  assert.equal(next.state_version, 2);
  assert.equal(next.lifecycle_state, "active");
  assert.equal(next.transitions.length, 1);
  assert.deepEqual(
    transitionRun(next, {
      eventId: "request_admitted-2",
      eventKind: "request_admitted",
      expectedStateVersion: 2,
      patch: { lifecycle_state: "completed" },
    }),
    next,
  );
  assert.throws(() => transitionRun(state, {
    eventId: "stale-2",
    eventKind: "stale",
    expectedStateVersion: 2,
  }), StateConflict);
});
