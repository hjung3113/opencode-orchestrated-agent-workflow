# OpenCode Orchestrated Agent Workflow

This context defines the terms for the small, human-invoked workflow system
and the boundary used while dogfooding it in this repository.

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
Mutable, reconstructable artifacts for one harness or dogfood run, stored under
the external `ORCHESTRATOR_RUN_STATE_DIR`.
_Avoid_: Repository knowledge, source of truth

**Dogfood run**:
A declared run whose product target is this repository and whose artifacts are
subject to the same gates and evidence requirements as any other run.
_Avoid_: Untracked experiment, implicit self-test

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
