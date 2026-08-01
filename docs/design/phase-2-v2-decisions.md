# Phase 2 v2 decision provenance

## Status and boundary

This is accepted direction for later v2 lifecycle behavior and remains
unimplemented. The shipped v2 `/route` preparation contract covers only
prepared-run artifacts; it does not make the behavior below current. Phase 2
becomes observable only when a later matching contract, implementation, and
public evidence co-land in one bounded slice; see
[delivery and readiness](phase-2-delivery.md).

## Artifact and ownership

V2 decision provenance is host-orchestrator-owned run-level state. It carries
forward the Phase-1 `decisions.json` writer and accepted-human-gate authority
from `docs/contracts/phase-1-artifacts.md` under the same single run-local lock
and atomic replacement as other host writes from
`phase-2-v2-baseline.md`. The v2 artifact name follows the gate-record
deferral in `phase-2-v2-gates.md`; this record defines no artifact schema or
baseline-table row.

## Recorded decision facts

A gate answer inside that gate's declared valid combinations, filled only in
its declared answer slot, is recorded as decision provenance. An answer outside
the declared combinations, or an unanswered gate, records no decision and the
gate remains unanswered. Silence infers nothing.

Recording a decision creates no acceptance fact, execution-state change,
automatic admission, promotion, dispatch, packet, retry or repair task,
receipt, or increase above `max_concurrency: 1`. The host does not choose
product direction when it creates a decision-conflict gate.

The later record-only `/route` consumes required decision references before it
reconciles or creates a later first-attempt packet. What makes a decision
current is defined by the decision-currency record.

## Version relation and baseline gap

Version-1 runs retain the Phase-1 `decisions.json` form and `/route`
answer-ingestion behavior, are never migrated in place, and this v2 statement
is additive.

The v2 baseline decision-record row is planned and its gate-record naming
remains deferred. Its verifier and receipt rows are also planned; the
record-only lifecycle decision defines only the receipt terminal predicate. A
later authorized baseline-touching slice owns their artifact shapes.

## Provenance

This record consumes ADR-0003 Decision 1 and obligation 9; the accepted
baseline claims at `runs/3a63c3442de67bdd/tasks/phase2-v2-state-spec/result.md`
and `runs/c51df7d251bc80e7/tasks/phase2-v2-state-spec-repair/result.md`; the
seven existing v2 design records; and the Phase-1 sources
`docs/design/core-principles.md`, `docs/contracts/phase-1-artifacts.md`, and
`docs/contracts/slice-a0-route.md`.

## Explicit deferrals

Decision currency and stale-decision rules, decision-conflict detection,
gate-id naming and file format, the `non-retryable-failure-resting-state` pin,
typed-block payload and lifecycle, receipt content/trigger/reconstruction,
verifier packet and schema, adapter capability/credentials/execution, resource
declarations and overlap predicates, concurrency above one, filesystem failure
and recovery, and runtime implementation remain later slices. This record has
no schema, template, predicate, CLI behavior, verifier, packet, receipt,
adapter, code, or pseudocode.
