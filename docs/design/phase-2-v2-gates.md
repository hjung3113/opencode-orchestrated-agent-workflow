# Phase 2 v2 gate rendering

## Status and boundary

This is accepted direction for later v2 lifecycle behavior and remains
unimplemented. The shipped v2 `/route` preparation contract covers only
prepared-run artifacts; it does not make the behavior below current. Phase 2
becomes observable only when a later matching contract, implementation, and
public evidence co-land in one bounded slice; see
[delivery and readiness](phase-2-delivery.md).

## Artifact facts

A v2 gate lives in the run's `gates/` directory. The host orchestrator creates
it and a human may fill only its declared answer slot. This carries forward the
Phase-1 ownership boundary without adding a gate format or a new writer.

## Rendered facts

Every future v2 gate renders its question, the consequence of each option, its
options, a non-binding recommendation, its valid decision combinations, and
the declared answer slot. The question, consequence, options, recommendation,
and answer slot carry forward the Phase-1 rendered-gate facts; valid decision
combinations are the additional ADR-0003 obligation.

A gate declares which combinations of its own declared options are valid. An
answer outside those declared combinations records no decision and leaves the
gate unanswered. This records no expression, grammar, truth table, or encoding.

## Gate families and stop effect

The only named v2 gate families in this record are the unresolved-attempt
attestation gate and the decision-conflict gate. The attestation gate is the
clear condition for its typed block. The decision-conflict gate is created by
the host rather than allowing it to choose product direction.

An operation that records an unanswered gate stops. It launches no worker,
performs no admission or dispatch, and infers no state from human silence.
Recording an answer creates no acceptance fact, execution-state change,
automatic admission, promotion, dispatch, packet, retry or repair task,
receipt, or increase above `max_concurrency: 1`.

The attestation gate does not change its existing relation to retry: an
unresolved attempt receives no retry packet until its human attestation exists.

## Version relation

Version-1 runs retain the Phase-1 `gates/<gate-id>.md` form and `/route`
answer-ingestion behavior, are never migrated in place, and this v2 statement
is additive.

## Provenance

This record resolves ADR-0003 obligation 7 and consumes Decision 1 from
ADR-0003; the accepted baseline claims at
`runs/3a63c3442de67bdd/tasks/phase2-v2-state-spec/result.md` and
`runs/c51df7d251bc80e7/tasks/phase2-v2-state-spec-repair/result.md`; the six
existing v2 design records; and the Phase-1 gate facts in
`docs/design/core-principles.md`, `docs/contracts/phase-1-artifacts.md`,
`docs/contracts/slice-a0-route.md`, and `CONTEXT.md`.

## Explicit deferrals

Gate authority and decision provenance relative to `decisions.json`, gate-id
naming and file format, stale-decision and decision-currency rules, the
`non-retryable-failure-resting-state` pin, typed-block payload and lifecycle,
receipt reconstruction, adapter capability, credentials and execution, resource
declarations and overlap predicates, concurrency above one, filesystem failure
and recovery, and runtime implementation remain later slices. This record has
no gate template, schema, CLI behavior, predicate, verifier, packet, receipt,
adapter, code, or pseudocode.
