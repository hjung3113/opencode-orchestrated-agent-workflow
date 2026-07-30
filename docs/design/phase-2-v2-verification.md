# Phase 2 v2 verification and acceptance baseline

## Status and boundary

This is accepted Phase 2 direction, recorded for reference and unimplemented.
`docs/contracts/` continues to describe Phase 1 only. Phase 2 becomes
observable only when a later matching contract, implementation, and public
evidence co-land in one bounded slice; see
[delivery and readiness](phase-2-delivery.md).

## Artifact and ownership

The v2 verification artifact is per attempt under `tasks/<id>/attempts/<n>/`.
An independent verifier is its sole writer. It is distinct from the selected
worker's `result.md` and `evidence-claim.json`. The host orchestrator is the
sole writer of the separate resulting acceptance fact.

## Accepted recording facts

Acceptance is a host-recorded fact separate from execution state. On either
human-invoked `/start` or `/resume`, after `result-observed` reconciliation,
the host records a structurally valid verifier verdict in its own atomic
`acceptance-recorded` change under the existing one-writer,
atomic-replacement, single run-local lock invariant. Recording observes that
verdict; the host does not judge criteria, evidence, or run commands.

`passed` inherits the Phase-1 precedent: execution succeeded and all criterion
results passed. A structurally invalid or inconsistent verdict records no
acceptance fact. Acceptance recording creates no receipt, repair or retry task,
later-task promotion, execution-state change, or new attempt.

Version-1 runs retain `tasks/<id>/verification.json` under the Phase-1
contract and are never migrated in place; this v2 node is additive.

## Forward references

ADR-0003 obligation 3, terminal dependency satisfaction for
non-implementation tasks, becomes specifiable after this node; its predicate
remains a later named slice. `non-retryable-failure-resting-state` remains
deferred to the CLI slice.

The sources are ADR-0003; the external baseline and repair claims at
`runs/3a63c3442de67bdd/tasks/phase2-v2-state-spec/result.md` and
`runs/c51df7d251bc80e7/tasks/phase2-v2-state-spec-repair/result.md`; the v2
baseline, transition, and typed-block records; and
`docs/contracts/slice-b-verification.md` as Phase-1 precedent.

## Exclusions

This record defines no verification field schema, CLI, error or exit code,
verifier packet template, dependency predicate, gate rule, receipt, adapter,
resource rule, code, or runtime behavior. Those remain later slices.
