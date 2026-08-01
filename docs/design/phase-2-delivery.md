# Phase 2 delivery and readiness model

## Status and authority

This document re-baselines Phase 2 design around the accepted ADR-0003
readiness amendment. It is a delivery-design record, not a Phase 2 contract or
runtime implementation. ADR-0003 remains the durable decision authority;
`docs/contracts/` and public tests remain the authority for observable product
behavior.

The existing `phase-2-v2-*.md` records are design inputs. They do not, alone
or together, declare Phase 2 complete or authorize an implementation task.

## Delivery unit

Phase 2 is delivered as bounded behavior slices, not as a prerequisite that
every possible Phase 2 design topic be completed first. A behavior slice names:

- one operator-observable behavior and its explicit exclusions;
- the matching product contract to change;
- the implementation surface that realizes that contract; and
- public evidence that observes the behavior at the contract boundary.

The behavior is not part of the product merely because a design record or
contract exists. Its contract, implementation, and public evidence must
co-land in the same bounded slice. Contract-only and implementation-only work
are both incomplete.

## Slice readiness

Before selecting an implementation task, an independent read-only scope gate
classifies each ADR-0003 direction category for the candidate behavior slice as
`resolved`, `not applicable` with an explicit guard, or `blocking`.

The gate records exactly one outcome:

- `implementation-ready` when the candidate has no blocking specification gap;
  this does not claim that Phase 2 as a whole is specified; or
- `specification-required: <named blocking items>` when the gate identifies
  the missing decisions needed by that candidate.

The gate is an admission check, not a recurring decomposition mechanism. Once
it has admitted a selected issue or named its blocking decisions, later work
must execute that result; it must not request another readiness gate merely to
split the same accepted issue more finely or to reopen a direct human decision.
The next gate is for a later candidate, or for the same candidate only after a
named blocker has actually changed.

For example, a nonparallel slice may mark resource admission not applicable
only while its contract retains `max_concurrency: 1`. Receipt behavior is not
applicable only when the candidate explicitly excludes terminal task acceptance
and every receipt trigger; missing receipt capability is `blocking`. A parallel
or receipt-producing slice cannot use those guards and must treat the
corresponding missing design as blocking. The same semantic rule applies to
every category: a missing capability is not an N/A guard.

## Task selection and design reset

The next task is the smallest dependency-ready change that removes a named
blocking item. Transcription, indexing, or consolidation that removes no
blocker cannot outrank it. A candidate that combines an independent,
unapproved product decision remains `specification-required`.

Accordingly, the prior unconditional “next task is a specification task”
direction is historical. Phase 2 design now starts each candidate with the
readiness gate above, then either fills only its named gaps or co-lands that
candidate's contract, implementation, and public evidence. The durable
[readiness ledger](phase-2-readiness-ledger.md) records the first candidate,
its independent result, and the one next packet it permits.

## Boundaries retained

Phase 2 remains human-invoked and operator-polled. It does not add a daemon,
watchdog, automatic repair, provider/model allocation, cross-run queue,
hash/tamper mechanism, or Phase 3 maintenance behavior. Version-1 runs remain
readable and are never migrated in place.
