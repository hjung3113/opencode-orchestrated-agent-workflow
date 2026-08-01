# Phase 2 v2 record-only lifecycle decision

## Status and boundary

This document closes the Issue #18 design decisions needed before a later v2
record-only lifecycle slice can be selected. It is a design record, not a
contract or implementation. The only current v2 behavior is `/route`
preparation under the [v2 `/route` preparation contract](../contracts/phase-2-v2-route-preparation.md):
it creates prepared-run artifacts and immutable attempt-one packets, but never
observes claims, dispatches, verifies, retries, repairs, or writes a receipt.

The later lifecycle remains human-invoked and record-only at
`max_concurrency: 1`. It adds no `/start`, `/resume`, adapter execution,
automatic promotion, automatic repair, parallel admission, daemon, migration,
or self-targeted dogfood run.

## Task kinds, target, and writers

A later record-only lifecycle v2 task declares one immutable kind before packet
creation:

| Task kind | Required task-local claims | Acceptance authority | Dependency-satisfaction terminal facts |
| --- | --- | --- | --- |
| `implementation` | Worker `result.md`, worker `evidence-claim.json`, independent `verification.json` | Host records the independent verifier's `passed` or `failed` verdict | `succeeded` plus `passed` |
| `non_implementation` | Manual worker `result.md` and `evidence-claim.json` | Host alone records `not_applicable` after structural reconciliation | `succeeded` plus `not_applicable` |

Task kind is declaration-owned: neither a worker nor verifier can change it.
`not_applicable` is not a worker or verifier verdict. Only the host records it,
and only for a declared `non_implementation` task with a structurally valid
complete manual claim and evidence-claim reference. The host records
provenance; it does not judge the claim's substantive truth.

Every later record-only product-validation run must declare one explicit
non-self target. The host binds that target identity into the run declaration,
packet, claim, verification result, and receipt provenance. A run whose target
is this checkout is outside this lifecycle. The concrete target-reference field
and path syntax are a later contract concern; they cannot be inferred from a
local checkout path or developer-home configuration.

## Record-only claim and verifier shapes

The later contract reuses the Phase-1 structural minimum and binds every value
to the v2 task id, attempt, and declared non-self target:

| Artifact | Sole writer | Required structural facts | Host effect |
| --- | --- | --- | --- |
| `result.md` | Selected manual worker | `status: complete`, `outcome: succeeded|failed`, task id, attempt, target reference | Host may record terminal execution only. |
| `evidence-claim.json` | Selected manual worker | Matching task id and attempt, target reference, non-empty commands, repository-relative changed files, and criterion-to-evidence mapping | Host may record a path only; it does not execute commands or inspect evidence. |
| `verification.json` | Independent verifier, implementation only | Matching task id and attempt, target reference, recorded evidence-claim path, non-empty verifier label, `passed|failed` verdict, and criterion results | Host may record acceptance only after terminal execution. |

No manual claim is eligible when its task id, attempt, target reference, or
declared task kind disagrees with the immutable packet. A missing, incomplete,
or structurally invalid claim records no execution or acceptance fact and does
not rewrite a packet. An implementation task cannot receive
`not_applicable`; a non-implementation task never receives a verifier verdict.

## Refusal and no-mutation boundary

The later lifecycle contract must refuse before changing host state when a
claim, verifier result, required decision reference, or repair reference does
not bind to the immutable task, attempt, target, and recorded graph revision.
That refusal leaves `run.json`, `graph.json`, events, packets, claim paths,
receipt, and failed history unchanged. Version-1 runs remain readable and are
never migrated in place. This record defines the invariant only; refusal names,
exit codes, and JSON channels belong to the later co-landing contract.

## Reconciliation, decisions, and repair

A later human-invoked `/route` is the only reconciler. Under the existing
single run-local lock and atomic replacement rule, it may record a complete
manual result, evidence-claim path, verifier verdict, or `not_applicable`
fact. It never runs a command, launches a worker or verifier, judges evidence,
or accepts a claim merely because it exists.

Each required decision reference names an immutable decision id and the gate
answer that created it. The host is the sole writer of that provenance. A later
recorded decision with the same decision id supersedes the earlier answer;
superseded decisions and the artifacts that cite them remain visible but are
not current. An unanswered, absent, or superseded required decision blocks the
affected task and creates no packet. Gate rendering retains the existing
question, options, consequences, recommendation, valid-combination, and human
answer-slot boundary; the host never chooses a product decision.

When an independent verifier records a failed finding for an implementation
task, later `/route` adds one finding-bound repair node. The node cites the
failed task, attempt, verifier result, and failing criteria; it is initially
blocked and has no packet. It never overwrites the failed attempt or consumes
retry budget. Only a subsequent human-invoked `/route` may select that node
and create its immutable first packet; no worker starts automatically.

## Receipt terminal predicate

A later `/route` may write one immutable final receipt only when every
non-superseded declared task and every finding-bound repair node has a recorded
terminal acceptance fact, no required decision is unanswered or superseded,
and every failed implementation verification has either its recorded
finding-bound repair history or a recorded human decision that no repair is
required. The receipt copies only host-recorded graph facts and the declared
target provenance; it does not reread claims, evaluate evidence, alter task
state, create a packet, or hide failed history.

## Explicit deferrals

This record defines no JSON field encoding, CLI shape, filesystem-recovery
policy, gate filename grammar, adapter capability, `/start`, `/resume`, retry
attempt, resource admission above one, contract, source, test, external run
state, or GitHub behavior. Those require a later bounded co-landing slice.
