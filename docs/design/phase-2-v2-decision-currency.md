# Phase 2 v2 decision currency

## Status and boundary

This is accepted direction for later v2 lifecycle behavior and remains
unimplemented. The shipped v2 `/route` preparation contract covers only
prepared-run artifacts; it does not make the behavior below current. Phase 2
becomes observable only when a later matching contract, implementation, and
public evidence co-land in one bounded slice; see
[delivery and readiness](phase-2-delivery.md).

## Currency and stale facts

A decision recorded as provenance in `phase-2-v2-decisions.md` is current
until a later recorded decision supersedes it. A superseded decision is
retained and remains visible, following `docs/design/core-principles.md`.

A superseded decision cannot satisfy a later record-only `/route`
current-required-decisions precondition in `phase-2-v2-transitions.md`.
Artifacts citing it are stale and cannot satisfy current acceptance, as recorded in
`docs/design/core-principles.md`. This adds no acceptance value or precondition.

## Admission boundary

When the currency precondition is false, its typed block belongs to the
existing admission-block family in `phase-2-v2-blocks.md`: the task is blocked
and admission stops. This names no new block, payload, or lifecycle.

Currency causes no acceptance fact, execution-state change, automatic
admission, promotion, dispatch, packet, retry or repair task, receipt,
re-verification, increase above `max_concurrency: 1`, or host choice of
product direction.

## Version relation and baseline gap

Version-1 runs retain the Phase-1 `decisions.json` form, supersession, and
stale-marking behavior, are never migrated in place, and this v2 statement is
additive.

The baseline artifact table records a planned receipt row, whose terminal
predicate is defined by the Issue #18 record-only lifecycle decision.
Decision-record and verifier rows remain planned. This document defines no
baseline artifact shape.

## Provenance

This record consumes ADR-0003 Decision 1 and obligation 9 and advances the
later record-only `/route` decision-currentness precondition from the accepted baseline claims at
`runs/3a63c3442de67bdd/tasks/phase2-v2-state-spec/result.md` and
`runs/c51df7d251bc80e7/tasks/phase2-v2-state-spec-repair/result.md`; the eight
existing v2 design records; `docs/design/core-principles.md`; and
`docs/contracts/phase-1-artifacts.md`.

## Explicit deferrals

Decision-conflict detection, decision/question identity, gate-id naming and
file format, stale-marking mechanism or timing, the
`non-retryable-failure-resting-state` pin, typed-block payload and lifecycle,
receipt content/trigger/reconstruction, verifier packet and schema, adapter
capability/credentials/execution, policy approval, resource declarations and
overlap predicates, concurrency above one, CLI shapes, filesystem failure and
recovery, and runtime implementation remain later slices. This record has no
schema, template, predicate, CLI behavior, verifier, packet, receipt, adapter,
code, or pseudocode.
