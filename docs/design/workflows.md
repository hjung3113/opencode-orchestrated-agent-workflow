## 5. Workflows

### 5.1 Intake and meta-prompt refinement

**Goal:** Convert a human message into a faithful, inspectable request
contract without pretending that missing information was supplied.

The meta-prompting skill is central here. It is a clarification and task-
framing tool, not an unconstrained prompt beautifier and not an authority that
changes user intent.

The sole Phase-1 output is `request.md`, containing the interpreted objective,
scope, exclusions, safe assumptions, and ambiguity classification. It is a
task-framing artifact, not an authority that changes user intent.

Ambiguity classification:

- `executable`: enough information exists to proceed.
- `assumption-permitted`: a low-risk default can be recorded and used.
- `clarification-required`: the answer would materially change product
  direction, cost, data handling, public exposure, or irreversible work.

Only the first two may proceed automatically. The third makes `/route` write a
concise `gates/<gate-id>.md` and stop for the human answer.

### 5.2 Discovery / research

**Goal:** Establish facts needed for a later decision, rather than make the
decision itself.

Inputs include the request contract, active decisions, and a bounded research
question. The task records findings, sources, limitations, and open questions
in its `result.md`; its `evidence-claim.json` identifies the cited sources.

Research tasks should be small and independently useful. If a provider's cost
or API constraint is unknown, create a provider-constraint task; do not route
directly to design based on an unverified guess.

### 5.3 Design

**Goal:** Compare alternatives, establish boundaries, and propose durable
decisions.

The task records alternatives, trade-offs, proposed decisions, and risks in
`result.md`. An ADR is created only when a human accepts a durable decision.

The design workflow may recommend a decision but cannot mark a material
decision accepted unless the authority rules allow it. The orchestrator routes
competing material choices to a human decision gate.

### 5.4 Specification

**Goal:** Turn accepted design decisions into observable, testable contracts.

The task records behavior, invariants, non-goals, observable acceptance
criteria, allowed/excluded scope, and an observation method for every
criterion in `result.md`.

Specification does not implement. In Phase 1, `/route` performs only a
structural exit check: a missing observation method makes the specification
unroutable. This does not introduce an additional verifier role.

For a Phase 2 candidate behavior, this is future delivery design, not current
workflow behavior. Specification is not an unconditional next phase. An
independent read-only readiness gate first identifies named blocking decisions
for that candidate. Only those gaps receive specification work; when there are
none, the candidate's contract, implementation, and public evidence must
co-land in one bounded delivery slice before the behavior is observable. See
[Phase 2 delivery and readiness](phase-2-delivery.md).

### 5.5 Ticketing and task-graph compilation

**Goal:** Convert an approved specification into small, independently
verifiable execution units.

It proposes small task candidates and their dependencies in its own task claim.
On a later routing pass, `/route` alone updates the record-only `graph.json`
and renders one immutable `packet.md` for the selected next task; it does not
compile an executable scheduler.

Every task packet contains:

```md
# Objective
# Inputs and source artifacts
# Allowed paths
# Forbidden paths
# Non-goals
# Expected outputs
# Acceptance criteria
# Evidence required
# Preconditions and dependent tasks
```

The graph declares dependencies and path boundaries for later scheduling.
Phase 1 selects one task only; safe parallel scheduling is Phase-2 work.

### 5.6 Implementation

**Goal:** Complete one approved ticket, and nothing broader.

An implementation agent receives a compiled task packet, not raw broad history.
It writes `result.md` (concise outcome, changes, limitations, and any blocker)
and `evidence-claim.json` (commands, results, changed files, and acceptance
mapping). A later routing pass records execution and acceptance state; the
worker never writes run-level lifecycle state.

It must create a `scope-escalation` request rather than making unapproved
architecture changes or broad cleanup.

### 5.7 Verification and review

**Goal:** Independently determine whether the implementation meets its actual
contract.

Review examines the specification, allowed paths, changed content, and
evidence. It does not accept “completed” as proof. It writes
`verification.json` with pass/fail per acceptance criterion and any
acceptance-mapped finding.

A failing review does not become an informal chat back to the implementer.
The orchestrator creates a new repair task with the review findings as input.

### 5.8 Maintenance

**Goal:** Keep a completed project healthy without allowing a maintenance loop
to become unbounded autonomous development.

Maintenance can identify:

- documentation/specification/code drift;
- outdated or risky dependencies;
- flaky tests;
- temporary workarounds and known limitations;
- repeated review findings;
- evidence or receipt gaps.

It records candidates in a curated maintenance backlog. Each accepted item
returns through the normal Intake/Discovery/Ticketing flow rather than being
silently fixed.
