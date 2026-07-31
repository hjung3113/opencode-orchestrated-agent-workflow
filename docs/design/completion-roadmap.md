# Original design completion roadmap

## Status and authority

This is the proposed planning record for completing the intent of the
pre-split design proposal at
`02d54ec:ORCHESTRATED_AGENT_WORKFLOW_DESIGN.md`. It records a dependency-ordered
roadmap; it does not authorize runtime behavior, worker dispatch, retries,
parallelism, or maintenance automation by itself.

Current observable behavior remains owned by `docs/contracts/` and public
tests. The shipped v2 `/route` preparation behavior is governed by
`docs/contracts/phase-2-v2-route-preparation.md`. ADR-0003 remains the durable
Phase 2 direction authority.

This roadmap orders candidates; [Phase 2 delivery and readiness](phase-2-delivery.md)'s
readiness gate remains the admission test for each one.

## Goal and boundary

The original design requires an evidence-driven, human-invoked loop: later
work receives current decisions and evidence; a failed review becomes a repair
task; and the final result can be reconstructed from files. The first priority
is to make that loop usable for a declared self-target dogfood run without
introducing automatic execution.

The roadmap retains these boundaries throughout:

- version-1 runs remain readable and are never migrated in place;
- `max_concurrency: 1` remains mandatory; any other declared value is refused
  until separately admitted;
- workers and independent verifiers own only task-local claims;
- a host operation is the sole writer of run-level state; and
- no daemon, watchdog, automatic repair, cross-run queue, provider/model
  routing, hash/tamper system, or hidden lifecycle controller is introduced.

## Roadmap

### 0. Close record-only lifecycle decisions and documentation currency

Tracking: [#18](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/issues/18)
in [Phase 2A — Record-Only Lifecycle Dogfood](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/milestone/6).

Before another runtime slice, establish one current-versus-planned authority
map and resolve the contract gaps for a manual v2 lifecycle:

- **DG-A (open):** approve a later human-invoked `/route` as the reconciler and
  sole creator of a later first-attempt packet; `/start` and `/resume` remain
  deferred. Approval requires amending the Reconciliation section of
  `phase-2-v2-transitions.md`, which currently assigns reconciliation to
  `/start` and `/resume`.
- **DG-B:** choose either a finding-bound dynamic repair node or a predeclared
  repair slot. A repair cannot overwrite history or consume retry budget.
- define task kinds and authority, the sole producer of `not_applicable`,
  eligible manual claims and their schemas, decision/gate identity and
  currency, self-target binding, terminal receipt reconstruction, and repair
  supersession/dependency/receipt effects.

This is design and contract work only. It does not change the existing v1 or
v2 runtime.

### 1. Co-land the record-only lifecycle and dogfood it

Tracking: [#19](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/issues/19)
in [Phase 2A — Record-Only Lifecycle Dogfood](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/milestone/6).

After step 0, co-land contract, implementation, and public evidence for one
serial v2 vertical slice. Manual worker and independent-verifier artifacts are
reconciled by the approved human-invoked operation. It records execution and
acceptance separately, stops at an unanswered gate, honors current decision
provenance, creates exactly one evidence-derived dependency-ready or
finding-bound repair packet, and emits a reconstructable terminal receipt.

Its required exit evidence is an external-state, explicit-self-target dogfood
run through research, design, specification, ticketing, implementation,
rejected verification, evidence-bound repair, pass, and receipt. Falsified
claim evidence must not unlock acceptance or a later packet.

This is the earliest safe dogfood point. It remains manual and single-slot: it
does not add `/start`, `/resume`, retry, automatic promotion, automatic repair,
parallel admission, daemon behavior, or migration.

### 2. Admit `/start` only when dogfood proves manual handoff is the bottleneck

Tracking: [#20](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/issues/20)
in [Phase 2: Reliable Orchestration](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/milestone/4).

The gate is measured dogfood evidence and a fresh human decision. If admitted,
`/start` dispatches one existing immutable packet through one configured
development-environment adapter. It does not create packets, reconcile claims,
retry, admit parallel work, or decide product direction.

### 3. Add `/resume` and bounded retry only after a repeated-failure need

Tracking: [#21](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/issues/21)
in [Phase 2: Reliable Orchestration](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/milestone/4).

The gate is a repeated failure observed in dogfood that the record-only loop
cannot resolve. A later immutable attempt must contain prior-failure context;
the declared retry budget is atomically consumed and observable. Typed blocks
and unresolved-attempt human attestation are required. There is no background
retry, timeout, watchdog, or automatic repair.

### 4. Consider parallel admission only with separate evidence

Tracking: [#22](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/issues/22)
in [Phase 2: Reliable Orchestration](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/milestone/4).

Keep `max_concurrency: 1` unless stable single-slot dogfood demonstrates a
throughput constraint. A later contract must make declared read/write conflict
serialization and bounded resource admission publicly observable. Daemons,
cross-run queues, leases/watchdogs, provider/model allocation, and automatic
repair remain excluded.

### 5. Begin Phase 3 maintenance only from stable dogfood evidence

Tracking: [#23](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/issues/23)
in [Phase 3: Long-Term Maintenance](https://github.com/hjung3113/opencode-orchestrated-agent-workflow/milestone/5).

Only recurring, observed maintenance candidates authorize this phase. It adds
`/maintain`, a curated backlog, drift and dependency review, and repeated
finding analysis. Accepted maintenance work must return through normal
intake/discovery/ticketing rather than being silently fixed.

## Completion interpretation

Step 1 completes the original design's record-only, evidence-driven lifecycle
intent and makes the harness dogfoodable. It does not claim to complete all of
ADR-0003. Steps 2 through 5 remain evidence-gated behavior slices; no planning
record alone authorizes their implementation.

## Provenance

This proposed sequence was informed by the independent Sol-medium and
Opus-medium design debate and Sol-high adversarial review recorded in the
current root `HANDOFF.md`. It remains pending explicit human acceptance and
does not supersede the governing contracts or ADRs.
