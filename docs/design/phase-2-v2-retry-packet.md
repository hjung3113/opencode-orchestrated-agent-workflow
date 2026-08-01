# Phase 2 v2 retry-attempt packet baseline

## Status and boundary

This is accepted direction for later v2 lifecycle behavior and remains
unimplemented. The shipped v2 `/route` preparation contract covers only
prepared-run artifacts; it does not make the behavior below current. Phase 2
becomes observable only when a later matching contract, implementation, and
public evidence co-land in one bounded slice; see
[delivery and readiness](phase-2-delivery.md).

## Artifact facts and delta

A later retry packet is `tasks/<id>/attempts/<n+1>/packet.md`. The host
orchestrator is its sole writer. A human-invoked `/resume` creates it before
dispatch, immutably bound to its run declaration and graph revision. This is a
delta over the same task's first-attempt packet; this record does not specify
that first packet's base content.

## Accepted later-attempt content

| Additional carried content | Accepted source |
| --- | --- |
| Prior attempt number and new attempt number | Transition baseline, Retry baseline |
| Recorded prior-attempt outcome | Transition baseline, Reconciliation |
| `worker-failed-retryable`, or `attempt-unresolved` and its human attestation | Typed-block catalog, Catalog; transition baseline, Reconciliation |
| `budget_before` and `budget_after` for the consumed retry-budget unit | Transition baseline, Retry baseline |
| Bound run declaration and graph revision | Transition baseline, States and operation responsibility |

The prior-failure context is a copy of already-recorded host facts. Including it
judges neither the prior claim's truth nor its acceptance.

## Admission and non-creation

The packet exists only after a reconciled prior attempt and remaining declared
per-task retry budget. Under the one run-local host lock, budget consumption
and packet creation are one atomic transition. No packet is created for an
exhausted budget, terminal failure, or unresolved attempt without its human
attestation. The `non-retryable-failure-resting-state` remains deferred to the
CLI contract slice.

## Provenance and exclusions

ADR-0003 obligation 6; the external baseline and repair claims at
`runs/3a63c3442de67bdd/tasks/phase2-v2-state-spec/result.md` and
`runs/c51df7d251bc80e7/tasks/phase2-v2-state-spec-repair/result.md`; and the
v2 baseline, transition, and typed-block records are the sole sources.

This record defines no JSON or field schema, key/type table, CLI or error
shape, template body, code, gate rule, resource rule, dependency predicate,
verifier, receipt, adapter, recovery, or runtime behavior. Those remain later
slices.
