# OpenCode Orchestrated Agent Workflow

This context defines the terms for the small, human-invoked workflow system
and its boundary from the repository development environment.

## Language

**Product harness**:
The repository-owned workflow contracts and future runtime that create,
constrain, and verify one product task.
_Avoid_: Dev environment, agent toolkit

**Development environment**:
User-owned tools and configuration outside this checkout used to develop the
product harness.
_Avoid_: Product runtime, harness state

**Run state**:
Mutable, reconstructable artifacts for one product run, stored under
the external `ORCHESTRATOR_RUN_STATE_DIR`.
_Avoid_: Repository knowledge, source of truth

**Self-targeted dogfood run**:
A historical practice in which a run named this repository as its product
target. It is suspended: repository development must not create one.
_Avoid_: Current development workflow, implicit self-test

**Routing pass**:
A human-invoked host operation that validates run artifacts, records run-level
state, and prepares at most one next task without executing a worker.
_Avoid_: Scheduler, dispatcher, daemon

**Task claim**:
A worker-owned task artifact that reports a result or evidence but is not
accepted fact until the applicable acceptance rule is satisfied.
_Avoid_: Accepted result, run-level state

**Task packet**:
The immutable, task-specific instruction prepared by a routing pass for one
worker.
_Avoid_: Decision packet, task brief

**Graph revision**:
The routing-pass-owned version of the run graph to which a task packet is
bound.
_Avoid_: Live scheduler state

**Execution state**:
The task's host-recorded lifecycle state: `pending`, `succeeded`, `failed`, or
`blocked`; Phase 1 has no observable `running` state.
_Avoid_: Acceptance state

**Acceptance state**:
The status of whether a task claim satisfies its contract: `pending`, `passed`,
`failed`, or `not_applicable`.
_Avoid_: Execution state

## Accepted future direction

**Phase 1 behavior (current)**: schema-less `/route` prepares one manual
packet and never dispatches a worker.

**Phase 2 bounded orchestration** is the direction recorded in ADR-0003. The
only shipped Phase 2 behavior is schema-version-2 `/route` preparation: it
creates a prepared run, initial graph, event, and immutable attempt-one packets
without dispatching work. Human-invoked reconciliation, `/start`, `/resume`,
retry, verification, receipts, and parallel admission remain planned until
their matching contracts and implementation co-land.

## Version-2 vocabulary

These terms apply only to schema-version-2 runs. They do not replace the
Phase 1 terms above, which remain authoritative for version-1 runs.

**Version-2 execution state**:
`blocked`, `queued`, `dispatched`, `succeeded`, or `failed`; `prepared` is the
initial run-level state for a v2 run declaration.
_Avoid_: Phase 1 execution state

**V2 run declaration**:
`run.json`, the v2 compatibility record for one declared run and its baseline
metadata.
_Avoid_: Current Phase 1 run record

**Event record**:
One ordered host-owned v2 run fact at `events/<sequence>.json`.
_Avoid_: Worker claim, live scheduler state

**Graph summary**:
The host-owned v2 projection of declared tasks and their recorded summaries.
_Avoid_: Worker-write target, Phase 1 graph contract

**Attempt**:
One immutable v2 task directory at `tasks/<id>/attempts/<n>/` containing a host
packet and task-local worker claims.
_Avoid_: Packet rewrite, task lifecycle rule

**Typed block**:
One host-owned named v2 condition at `blocks/<task-id>.json`.
_Avoid_: Error payload, transition rule

**Unresolved-attempt attestation**:
The human statement at `gates/attempt-unresolved-<task-id>-<attempt>.md` about
a prior unresolved v2 attempt.
_Avoid_: Gate semantics, acceptance decision

**Task kind**:
An immutable later record-only v2 declaration of either `implementation` or
`non_implementation`, determining whether independent verification is required
before dependency satisfaction.
_Avoid_: Worker-selected role, execution state

**Record-only reconciliation**:
A later human-invoked `/route` pass that records structurally valid manual
claims and verifier facts without launching a worker, adapter, retry, or
parallel admission.
_Avoid_: `/start`, `/resume`, background polling

**Finding-bound repair node**:
A new blocked v2 task created from one recorded failed verifier finding. It
retains the failed attempt, cites that finding, consumes no retry budget, and
has no packet until a later human-invoked `/route` selects it.
_Avoid_: Retry attempt, automatic repair, overwritten history
