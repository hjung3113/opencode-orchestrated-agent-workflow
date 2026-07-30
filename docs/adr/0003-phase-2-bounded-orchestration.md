# Adopt bounded reliable orchestration for Phase 2

## Status

Accepted 2026-07-30 by direct human approval in the Phase 2 design workflow.
No gate artifact was created because the current Phase 1 runtime has no
post-design gate operation. Implementation has not begun.

## Context

Phase 1 proved a human-invoked, record-only route with immutable packets and
file-backed ownership. Phase 2 requires reliable dependency-aware execution,
safe parallel admission, bounded retry and `/resume`, reproducible receipts,
and decision-conflict detection without importing a daemon or a general-purpose
control plane.

The accepted design and independent reviews are recorded in external run state:

- `runs/7247aca3389aec4a/tasks/phase2-design/result.md`;
- `runs/06a2def56075c0d7/tasks/phase2-design-repair/result.md`; and
- `/tmp/phase2-design-followup-opus-review.md`.

## Decision

For Phase 2, adopt these four bounded decisions:

1. A single host orchestrator extends the human-invoked routing pass. Its future
   operations are `/route`, `/start`, and `/resume`; it is not a daemon. New
   version-2 run records use ordered host-owned event records; independent
   verification is an explicit graph node; and the host creates decision-conflict
   gate artifacts rather than choosing product direction.
2. A human may explicitly invoke `/start` or `/resume` to dispatch only
   declared, dependency-ready, conflict-free tasks through one configured
   adapter. The adapter's executable target and credentials remain
   development-environment configuration, not repository defaults or run-state
   paths.
3. A human-invoked `/resume` may create a next immutable attempt only within a
   declared per-task retry budget and only after the prior attempt is reconciled.
   There is no background or unbounded retry.
4. New Phase 2 runs use schema version 2. Existing version-1 runs remain
   readable and are never migrated in place.

This decision adopts direction only. The Phase 2 specification must define all
observable interfaces, state transitions, resource declarations, verifier-node
behavior, block types, receipt reconstruction, and migration/refusal behavior
before implementation begins.

## Consequences

- ADR-0002 remains authoritative for every Phase 1 operation and artifact.
  This ADR supersedes it only for the accepted Phase 2 operations after their
  contracts are specified and implemented.
- Workers remain owners of their task-attempt claims. Independent verifiers
  remain owners of verification results. The host orchestrator is the sole
  writer of run-level state for its accepted operations.
- Current source and public contracts continue to implement Phase 1 only. This
  ADR does not make `/start`, `/resume`, parallelism, or retry observable yet.
- The next task is a specification task. It must turn the accepted direction and
  these deferred obligations into observable contracts without adding runtime
  behavior:
  1. include `schema-version-unsupported` in the block taxonomy;
  2. define the pre-start task state;
  3. define terminal dependency satisfaction for non-implementation tasks;
  4. name the artifact for an `attempt-unresolved` human attestation;
  5. define `/start` repeatability and its reconciliation relation to `/resume`;
  6. define retry-attempt packet contents and prior-failure context;
  7. render every future gate with options, consequences, recommendation, and
     valid decision combinations;
  8. update shared vocabulary consistently with the accepted version-2 terms;
     and
  9. retain atomic write semantics alongside the single run-level writer/lock.

## Amendment: readiness and exit for later Phase 2 slices

This amendment governs later Phase 2 slice selection without declaring the
current specification complete or selecting an implementation slice.

1. For a selected Phase 2 behavior slice, each category in the direction-only
   specification requirement above is classified for that slice as `resolved`,
   `not applicable` with an explicit guard, or `blocking`. A `blocking` item is
   a named missing specification decision needed for that slice to co-land its
   contract, implementation, and public evidence.
2. An independent read-only scope gate with no implementation role records
   exactly one result: `implementation-ready`, or
   `specification-required: <named blocking items>`. `implementation-ready`
   means only that the selected candidate slice has no blocking specification
   gap; it does not declare the Phase 2 specification complete.
3. A `docs/design/` record is implementation input, not a current contract. A
   selected behavior becomes observable only when its matching contract,
   implementation, and public evidence co-land in the same bounded slice.
   A contract-only or implementation-only landing is insufficient.
4. The next task is the smallest dependency-ready change that removes at least
   one named blocking item. Transcription, indexing, or cleanup that removes no
   blocker cannot take priority over blocker removal, and a candidate that
   combines an independent unapproved product decision remains
   `specification-required`.
5. The former next-task direction in Consequences was a one-time instruction
   immediately after this ADR's original acceptance and does not bind selection
   after an `implementation-ready` result. The statement that current source
   and public contracts implement Phase 1 only is a fact as of that original
   acceptance. The adjacent statement remains an enduring rule: this ADR alone
   does not make a Phase 2 behavior observable without the co-landing required
   above.

## Non-goals

- Daemons, watchdogs, timeouts, leases, automatic repair, provider failover,
  model allocation, cross-run queues, hashes/tamper evidence, or Phase 3
  maintenance and drift workflows.
- In-place migration of Phase 1 run directories.
