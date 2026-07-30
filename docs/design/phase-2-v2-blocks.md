# Phase 2 v2 typed-block catalog

## Status and boundary

This is accepted Phase 2 direction, recorded for reference and unimplemented.
`docs/contracts/` continues to describe Phase 1 only. Phase 2 becomes
observable only when a later matching contract, implementation, and public
evidence co-land in one bounded slice; see
[delivery and readiness](phase-2-delivery.md).

This record gives names, producing recorded changes, stop effects, and clear
conditions for host-owned v2 blocks. It defines no block payload, interface,
transition rule, or runtime behavior.

## Artifact facts

`blocks/<task-id>.json` is a host-orchestrator-only artifact. A typed block is
a separate observed fact from a task's execution state, and a block can be
observed before any new attempt is created. Recording a block observes its
condition; it judges neither a worker claim's truth nor its acceptance.

## Catalog

Every row is **Phase 2 accepted, unimplemented**. The cited recorded changes
are rows in [the transition baseline](phase-2-v2-transitions.md).

| Block name | Producing recorded change | Resulting task execution state | Stops | Clear condition |
| --- | --- | --- | --- | --- |
| `attempt-unresolved` | Reconciliation: a `/resume` observes a missing or incomplete result for a dispatched attempt | `blocked` | A new attempt packet and retry for that unresolved attempt | The named human attestation exists |
| `worker-failed-retryable` | Reconciliation: a complete valid failed result has a retryable declared failure | `blocked` | A new attempt packet or automatic retry | A later explicit `/resume` has reconciled the prior attempt and remaining declared per-task budget |
| `schema-version-unsupported` | `/start` or `/resume` refuses a version-1 run without mutation | Unchanged historical v1 state; no v2 task state is created | `/start` and `/resume` admission for that v1 run | None: version-1 runs remain readable, are refused without mutation, and are never migrated in place |

`/start` admission may also record a typed block whenever a declared
precondition is false. That is one admission-block family, not a list of new
block names: dependency acceptance, adapter capability, decision currency, and
policy approval each keep their per-precondition name for the later slice that
defines its predicate.

The upstream transition record uses both `failed` for complete-result
reconciliation and `blocked` for an exhausted budget or terminal failure. This
catalog does not choose a single non-retryable-failure resting state without
editing that acceptance-pending record. The named
`non-retryable-failure-resting-state` ambiguity is deferred to the CLI contract
slice. Whether a task can hold more than one active block in its one-file
per-task path, and any block lifecycle beyond the clear conditions above, are
also deferred.

## Provenance

The catalog transcribes accepted direction from ADR-0003; the external
run-state claims at
`runs/3a63c3442de67bdd/tasks/phase2-v2-state-spec/result.md` and
`runs/c51df7d251bc80e7/tasks/phase2-v2-state-spec-repair/result.md`; and the
repository records [the v2 baseline](phase-2-v2-baseline.md) and
[the v2 transition baseline](phase-2-v2-transitions.md). No catalog row
introduces a new condition or authority.

## Explicit deferrals

This record contains no JSON field schema or payload shape, error code,
operator or console message text, CLI request or response shape, exit code,
retry-packet field format, resource declaration or overlap predicate,
dependency-acceptance predicate, gate rendering or decision-combination rule,
verifier, receipt, adapter, code, or pseudocode. Gate authority, block payload
and lifecycle, retry-packet fields, CLI behavior, resource admission, verifier,
receipt, adapter, dependency acceptance, filesystem recovery, and runtime
implementation remain later slices.
