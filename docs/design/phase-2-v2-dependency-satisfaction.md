# Phase 2 v2 dependency satisfaction

## Status and boundary

This is accepted direction for later v2 lifecycle behavior and remains
unimplemented. The shipped v2 `/route` preparation contract covers only
prepared-run artifacts; it does not make the behavior below current. Phase 2
becomes observable only when a later matching contract, implementation, and
public evidence co-land in one bounded slice; see
[delivery and readiness](phase-2-delivery.md).

This record fills only the declared dependency condition that a later
record-only `/route` checks. It adds no operation, artifact, interface, or
runtime behavior.

## Accepted satisfaction facts

A declared dependency condition is satisfied only by the depended-on task's
host-recorded terminal facts. A worker claim, elapsed time, silence, or reviewer
opinion does not satisfy it. This completes the later record-only `/route`
precondition named in the [transition baseline](phase-2-v2-transitions.md).

For an implementation task, satisfaction requires host-recorded execution
state `succeeded` and host-recorded acceptance `passed`. The acceptance fact is
the separate `acceptance-recorded` change described in the
[verification record](phase-2-v2-verification.md); this record defines no new
acceptance value.

For a non-implementation task, no independent verifier is required merely for
the task to be consumed. Satisfaction instead requires host-recorded execution
state `succeeded` and the existing non-verifier acceptance value
`not_applicable`. This is the Phase-1 authority-class precedent, carried
forward through the immutable declaration-owned task kind without a verifier
requirement.

Neither a `failed` or `blocked` execution state, nor `dispatched`, acceptance
`pending` or `failed`, an unresolved attempt, a typed block on the depended-on
task, or a structurally invalid verdict that recorded no acceptance fact,
satisfies a dependency.

## Admission block and operation boundary

When a dependent task's declared dependency condition is false at later
record-only `/route` selection, the host records the dependency-acceptance
typed block. It has the
admission-block family, execution-state, and stop effect already authorized by
the [typed-block catalog](phase-2-v2-blocks.md): the dependent is blocked and
admission stops. This names no payload or lifecycle and does not duplicate the
catalog's existing rows.

Satisfaction is only an admission precondition. It causes no automatic
admission, promotion, dispatch, packet creation, receipt, repair or retry task,
execution-state change on either task, or increase above the accepted
`max_concurrency: 1` baseline. It does not move first-attempt packet creation
from `/route`, or add reselection or scheduling.

## Version relation

Version-1 runs retain the Phase-1 earlier-candidates-only dependency form in
`docs/contracts/slice-a-bounded-sequence.md` and are never migrated in place.
This v2 statement is additive. It does not reopen the Phase-1 deferral that a
first task's dependency cannot be observed under that earlier-only form.

## Provenance

This record resolves ADR-0003 obligation 3 from the accepted baseline claims
at `runs/3a63c3442de67bdd/tasks/phase2-v2-state-spec/result.md` and
`runs/c51df7d251bc80e7/tasks/phase2-v2-state-spec-repair/result.md`; ADR-0003;
the [v2 baseline](phase-2-v2-baseline.md),
[transition baseline](phase-2-v2-transitions.md),
[typed-block catalog](phase-2-v2-blocks.md),
[retry-packet record](phase-2-v2-retry-packet.md), and
[verification record](phase-2-v2-verification.md); and the Phase-1 precedents
in `CONTEXT.md`, `docs/design/delivery-phases.md`, and
`docs/design/core-principles.md`.

## Explicit deferrals

The `non-retryable-failure-resting-state` pin remains the CLI slice's work.
Gate rendering and decision combinations, attestation-gate authority,
typed-block payload and lifecycle, receipt reconstruction, adapter capability,
decision-currency and policy-approval predicates, adapter execution, resource
admission and concurrency above one, filesystem failure and recovery, and
runtime implementation remain later slices. This record contains no task-kind
schema, predicate expression, CLI behavior, packet format, verifier behavior,
receipt, adapter, gate semantics, code, or pseudocode.
