# Phase 2 v2 baseline vocabulary and artifact ownership

## Status and boundary

This is accepted Phase 2 direction, recorded for reference and unimplemented.
`docs/contracts/` continues to describe Phase 1 only. Phase 2 becomes
observable only when a later matching contract, implementation, and public
evidence co-land in one bounded slice; see
[delivery and readiness](phase-2-delivery.md).

This record names v2 artifacts and ownership; it defines no behavior. The
current Phase 1 runtime, vocabulary, contracts, workflows, and artifacts stay
unchanged.

## Accepted v2 artifacts

Every row has status: **Phase 2 accepted, unimplemented**.

| Artifact | Path | Sole writer | Primary consumer | Authority |
| --- | --- | --- | --- | --- |
| v2 run declaration | `run.json` | Host orchestrator | Host and readers | Compatibility record for one schema-version-2 run |
| Event record | `events/<sequence>.json` | Host orchestrator | Host and readers | Ordered run fact |
| Graph summary | `graph.json` | Host orchestrator | Host and readers | Recorded task and attempt summary |
| Attempt | `tasks/<id>/attempts/<n>/` | Host packet; selected worker `result.md` and `evidence-claim.json` | Host and selected worker | Immutable task-local packet and claims directory |
| Typed block | `blocks/<task-id>.json` | Host orchestrator | Host and readers | Named observed-condition record |
| Unresolved-attempt attestation | `gates/attempt-unresolved-<task-id>-<attempt>.md` | Host creates; human fills answer slot | Host | Human statement about a prior unresolved attempt |
| Decision record | Gate-record naming remains deferred | Host orchestrator | Host and readers | Recorded decision provenance for one schema-version-2 run ([decision provenance](phase-2-v2-decisions.md); [decision currency](phase-2-v2-decision-currency.md)) |
| Verification result | Per attempt under `tasks/<id>/attempts/<n>/` | Independent verifier | Host | Verification verdict for one attempt ([verification](phase-2-v2-verification.md)) |

An independent verifier owns only its verification result. This statement
records ownership only; verifier behavior remains a later slice.

The receipt row remains absent and deferred: no accepted receipt content,
trigger, or v2 run-terminal condition exists.

## Baseline invariants

- The host orchestrator is the sole run-level writer under one run-local lock
  with atomic replacement.
- A worker owns only claims inside its own immutable attempt directory.
- An independent verifier owns only its verification result.
- Version-1 runs remain readable and are never migrated in place.
- `max_concurrency: 1` is the v2 baseline restriction. Any increase belongs to
  the later resource-admission slice; this record provides no admission or
  scheduling rule.

## Provenance

The accepted baseline and repair are external task claims at
`runs/3a63c3442de67bdd/tasks/phase2-v2-state-spec/result.md` and
`runs/c51df7d251bc80e7/tasks/phase2-v2-state-spec-repair/result.md` under the
external orchestrator run-state root. ADR-0003 records the accepted direction.
This baseline-table completion is authorized by
`/tmp/phase2-post-currency-scope-gate.md`, consumes ADR-0003 Decision 1 and
obligation 9, and cites this record plus `phase-2-v2-blocks.md`,
`phase-2-v2-decision-currency.md`, `phase-2-v2-decisions.md`,
`phase-2-v2-dependency-satisfaction.md`, `phase-2-v2-gates.md`,
`phase-2-v2-retry-packet.md`, `phase-2-v2-transitions.md`, and
`phase-2-v2-verification.md`.

## Explicit deferrals

This record defers transitions and state-change rules; CLI behavior and request
or response shapes; retry and typed-block payloads; resource admission;
verifier, receipt, and adapter work; gate semantics; and runtime
implementation. It adds no contract, workflow, source, test, ADR, or Phase 1
behavior change.
