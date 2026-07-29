# OpenCode Orchestrated Agent Workflow — Design Proposal

## Status

Design proposal with one adopted integration decision: the unmodified pinned
`llm-wiki` knowledge adapter. It does not authorize implementation of the
workflow runtime, automatic process spawning, or changes to external systems.

## 1. Purpose

Build an OpenCode-oriented agent system that can take a project from an
initial human request through research, design, specification, ticketing,
implementation, verification, and ongoing maintenance.

The system must not treat that path as one long agent prompt. Each phase is a
separate workflow with explicit inputs, outputs, gates, and ownership. A
central **orchestrator** continuously reads the results of completed work,
combines the active decisions and remaining uncertainty, and compiles the next
smallest useful task graph. It may schedule compatible tasks sequentially or
in parallel.

The system borrows the useful principles of a conductor-style workflow:

- acceptance criteria and scope before execution;
- durable, host-owned execution state;
- evidence rather than self-reported completion;
- independent review;
- explicit stop conditions when a failure repeats.

It deliberately does **not** copy a heavyweight lifecycle/control plane,
provider/model-routing machinery, or worktree/terminal-specific mechanisms.
The intended result is a small, comprehensible project workflow that can grow
only when a demonstrated need appears.

## 2. Core principles

1. **Separate thought phases from delivery phases.** Research, design, spec,
   ticketing, and implementation are different kinds of work with different
   acceptable outputs.
2. **Files are the inter-agent protocol.** Agents do not rely on private chat
   history or direct agent-to-agent messages. Every handoff is an inspectable
   artifact in the run directory.
3. **The orchestrator owns routing, not domain decisions.** It compiles tasks
   from evidence and decisions; it does not silently invent product direction.
4. **Decisions are first-class state.** Accepted decisions are injected into
   later prompts. Proposed, rejected, and superseded decisions remain visible.
5. **Ambiguity is handled explicitly.** A meta-prompt intake workflow extracts
   ambiguity, missing information, and safe assumptions before work begins.
6. **Only evidence closes work.** An implementation result is a claim until an
   independent verifier checks its evidence against the specification.
7. **Scope expansion becomes a new task.** An agent must not smuggle broad
   refactors, new features, or unapproved decisions into a narrow task.
8. **Automation has bounded failure.** Repeated failures become a well-described
   block or a human decision request, not an endless retry loop.

### 2.1 Five engineering layers: prompt → context → harness → loop → graph

The workflow uses the following five layers as a shared vocabulary. Each layer
absorbs the concerns below it; a reliable multi-agent project cannot be made
reliable by improving prompts alone.

| Layer | Responsibility in this project | Primary artifact / boundary |
| --- | --- | --- |
| **Prompt engineering** | Make one agent's immediate task clear: role, objective, constraints, expected output, and acceptance criteria. | Rendered `packet.md`. |
| **Context engineering** | Select the smallest relevant set of facts, decisions, evidence, and unresolved questions for that prompt. | `CONTEXT.md`, ADRs, manifests, and cited upstream run artifacts. |
| **Harness engineering** | Make one task executable and checkable: render its packet, collect its claim, and (for implementation) obtain independent verification. | Task directory, `result.md`, `evidence-claim.json`, and optional `verification.json`. |
| **Loop engineering** | On a human-invoked route, observe the result and choose the next bounded task, gate, or block. | `/route`, exit condition, and final receipt. |
| **Graph engineering** | Record dependencies, human gates, and feedback paths without executing them automatically. | `graph.json` and `gates/`. |

The graph layer is not a static sequence of prompts. In Phase 1 it is only a
human-reviewed record: it can show that research fed design or that review
created a repair edge, but it does not launch, retry, or parallelize workers.

### 2.2 File-backed shared memory, not agent chat

In graph-engineering terminology, agents need a shared state/memory surface.
For this project, that surface is deliberately file-backed and authority-aware:

- **Long-lived shared knowledge:** `CONTEXT.md`, accepted ADRs, specifications,
  and maintenance records, all versioned with the repository.
- **Run-scoped shared knowledge:** request, decisions, graph, task outputs,
  reviews, and receipts in the run directory.
- **Agent-local scratch work:** may exist while an agent runs but is not a
  handoff channel and cannot become authority without being written into a
  declared task artifact.

Agents never send hidden direct messages to one another. The orchestrator reads
declared outputs, compiles the next task packet, and creates the next edge
in the graph. This preserves the benefits of shared memory while retaining an
auditable, replayable protocol.

```text
Graph engineering      task graph, gates, branches, dynamic re-planning
        ▲
Loop engineering       observe → validate → route/retry/escalate
        ▲
Harness engineering    gather → execute → verify one task
        ▲
Context engineering    select decisions, evidence, facts, and unknowns
        ▲
Prompt engineering     render one bounded agent instruction
```

### 2.3 Debate amendment: Phase-1 graph contract

Sol medium and Opus 5 reviewed this design through an Orca-tracked,
file-backed debate. Their combined amendment is:

- Phase 1 has no privileged daemon. The orchestrator is a **human-invoked
  `/route` pass** that writes the next graph revision and immutable task packet;
  it prepares work but does not auto-launch workers. A selected packet ends
  with a manual handoff instruction for the chosen worker profile.
- Authority is enforced by path ownership: workers write only to their own
  `tasks/<task-id>/` directory and all such output is a claim. Only a routing
  pass writes run-level `graph.json`, `decisions.json`, `gates/`, receipts, or
  task packets.
- Split worker execution from acceptance: `execution_state` is
  `pending|succeeded|failed|blocked`, while `acceptance_state` is
  `pending|passed|failed|not_applicable`. Worker exit never proves acceptance.
- Use one canonical external state root,
  `$ORCHESTRATOR_RUN_STATE_DIR/runs/<run-id>/`, with
  `request.md`, `decisions.json`, `graph.json`, `tasks/`, optional `gates/`,
  and `final-receipt.json`. A task receives one never-rewritten `packet.md`;
  its evidence is an `evidence-claim.json`.
- A required human choice is a real artifact: `gates/<gate-id>.md` contains the
  question, consequence, options, non-binding recommendation, and answer.
  `/route` stops at an unanswered gate and records an answered gate as decision
  provenance. No separate gate index is required.
- Mandatory gates cover irreversible data changes, cost commitments, external
  sending/publication, credentials/security-sensitive work, and durable product
  direction. A routing pass marks downstream cited artifacts `stale` when it
  records a superseded decision; stale evidence is retained but cannot satisfy
  current acceptance.
- In Phase 1, `graph.json` is a record, not an executor: one active task, no
  automatic retries, no parallelism, and no graph mutation during dispatch.
  A task is bound to its graph revision. Parallel scheduling, leases,
  cancellation, digest verification, and auto-launch are Phase-2 work.
- Independence is a context property: a verifier receives only specification,
  acceptance criteria, changed files, and evidence claim—not the implementer's
  private reasoning or narrative. Research/design outputs carry authority class
  and need no verifier merely to be consumed.

The first implementation proof is **Slice A0**: ambiguous request → intake →
one human gate → persisted blocked graph, with no worker execution. **Slice A**
then extends A0 through bounded research/design to a persisted graph with
dependencies and a feedback edge. **Slice B** proves implementation →
independent verification → receipt using Slice A's generated spec and ticket.
This keeps graph engineering and human control in the MVP without importing a
heavyweight control plane.

### 2.4 Phase-1 failure boundary

A failed task records the observation, blocker, and exact unblock condition in
its `result.md`. The next execution starts only through a human-invoked
`/route`; a task is not re-routed while its packet and unblock condition are
unchanged. Typed failure taxonomies, retry lineage, run ceilings, watchdogs,
timeouts, transcript retention, and cross-run failure analytics are Phase-2
work.

## 3. System boundary

### 3.1 Repository knowledge vs. execution state

`llm-wiki` is an optional upstream knowledge adapter, not an orchestrator
component or a second control plane. It is included unmodified as the pinned
submodule `third_party/llm-wiki` at upstream
[`nvk/llm-wiki` commit `2a37e8649339e2f1a2936be3aa761e949b79afdc`](https://github.com/nvk/llm-wiki/tree/2a37e8649339e2f1a2936be3aa761e949b79afdc),
with no local patches; updates are explicit gitlink changes. The default
OpenCode instruction is the upstream read-only
`plugins/llm-wiki-opencode/skills/wiki-query/SKILL.md`; use
`wiki-manager/SKILL.md` only for an explicitly requested wiki research or
maintenance task. Upstream is MIT-licensed, but that does not make its license
the license of this repository.

Project knowledge is versioned with the repository:

```text
CONTEXT.md                  Current project facts, goals, constraints
AGENTS.md                   Repository-wide working rules
ADR/                        Durable architecture decisions
docs/architecture/          Architecture explanations and diagrams
docs/workflows/             Workflow and agent contracts
docs/maintenance/           Maintainer guidance and curated debt records
.opencode/                  OpenCode agent, command, skill, and template definitions
```

Per-run mutable state is stored in the absolute external
`ORCHESTRATOR_RUN_STATE_DIR`; it must not be inside the checkout or a
developer-tool directory. `.orchestrator/` is an explicitly ignored local
fallback only. The state root contains only reconstructable execution
artifacts:

```text
$ORCHESTRATOR_RUN_STATE_DIR/runs/<run-id>/
  request.md                  # objective, scope, assumptions, ambiguities
  decisions.json
  graph.json                  # record only; never an executor
  gates/<gate-id>.md          # only when a material choice needs a human
  tasks/<task-id>/
    packet.md                 # never rewritten
    result.md                 # worker's concise result claim and blocker
    evidence-claim.json
    verification.json         # implementation tasks only
  final-receipt.json
```

This separation prevents generated status, receipts, and recovery artifacts
from being confused with source-of-truth product decisions.

### 3.2 Development environment and dogfooding

Developer tooling is a separate, user-owned environment. In particular,
Matt Pocock engineering skills remain under `/Users/hyojung/.codex/skills` and
are never implicitly promoted to product skills, runtime prompt inputs, or
receipt provenance. A future product skill requires an explicit
repository-owned adoption decision.

Dogfooding applies this workflow to its own checkout without erasing this
boundary: a dogfood run has an explicit self-target and stores its packet,
claims, and verification in the external state root. It follows normal scope,
human-gate, evidence, and independent-verification rules; it does not grant
automatic execution, publication, or access to developer-home tooling.

### 3.3 Authority order

When sources disagree, use this order:

1. Explicit current human direction.
2. Accepted decisions and ADRs, unless superseded by (1).
3. Approved specification and acceptance criteria.
4. Verified research facts and implementation evidence.
5. Proposed decisions, agent recommendations, and historical run outputs.

An external knowledge adapter, including `llm-wiki`, can supply cited research
facts only: its output cannot rise above level 4 or become an accepted decision
or approved specification without the normal authority path.

The orchestrator records conflicts instead of resolving material product,
cost, security, or public-release choices on its own.

## 4. Workflow lifecycle

```text
Human request
  │
  ▼
Intake / meta-prompt refinement
  ├── clarification required ───────────────► Human decision
  ▼
Discovery / research
  ├── missing fact ─────────────────────────► Focused research task
  ▼
Design
  ├── competing material choices ───────────► Human decision / ADR acceptance
  ▼
Specification
  ├── non-verifiable contract ──────────────► Design refinement
  ▼
Ticketing and task graph compilation
  ▼
Implementation ──► Verification / review
  │                     │
  │                     ├── finding ────────► New repair task
  │                     └── pass
  ▼
Final receipt / release-ready result
  ▼
Maintenance monitoring ─────────────────────► Discovery, ticketing, or repair
```

No arrow means an agent is allowed to skip a phase. The orchestrator creates
the next task only after evaluating the previous phase's exit criteria.

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

## 6. Orchestrator responsibilities

The orchestrator is the only component allowed to:

1. Read the overall run state and active decisions.
2. Decide which workflow is appropriate next.
3. Compile a new task packet.
4. Construct and update the task graph.
5. In Phase 1, record dependencies and select one active sequential task.
   Parallel scheduling is Phase-2 work.
6. Check phase exit criteria and required artifacts.
7. Create a human-decision request, repair task, or blocked record.
8. Produce the final run receipt.

It is not allowed to treat an agent's recommendation as an accepted product
decision, bypass an approval gate, or claim verification it has not observed.

### 6.1 Routing loop

For each routing pass the orchestrator:

1. Loads current request, accepted decisions, proposed decisions, completed
   artifacts, review findings, and unresolved questions.
2. Validates artifact shape and phase exit conditions.
3. Determines whether the run needs clarification, focused research, design,
   specification, tasking, repair, verification, or completion.
4. Creates the smallest single task that advances the run.
5. Injects relevant historical context and explicit constraints into each task
   packet.
6. Records dependencies and the selected task in `graph.json`; it does not
   launch workers or mutate the graph during dispatch.
7. On a later human-invoked route, evaluates terminal artifacts and selects the
   next task, gate, block, or completion.

### 6.2 Task packet

Every dispatched agent receives a compact, stable packet:

```md
# Task
- Objective:
- Expected deliverables:
- Acceptance criteria:

# Scope
- Allowed paths:
- Forbidden paths:
- Non-goals:

# Accepted decisions
- Decision ID, rationale, affected area:

# Upstream evidence
- Required artifact paths and short summaries:
- Open review findings / known constraints:

# Output contract
- Files to write:
- Required evidence:
- Escalation condition:
```

The packet contains accepted decisions as binding constraints. Proposed
decisions are clearly labeled as inputs to evaluate, never as settled fact.

## 7. File protocol

### 7.1 Run layout

```text
$ORCHESTRATOR_RUN_STATE_DIR/runs/<run-id>/
  request.md
  decisions.json
  graph.json
  gates/<gate-id>.md
  tasks/<task-id>/
    packet.md
    result.md
    evidence-claim.json
    verification.json       # implementation tasks only
  final-receipt.json
```

`result.md` and `evidence-claim.json` are task claims. A routing pass records
execution and acceptance state after checking the applicable contract; an
implementation task needs independent `verification.json` before acceptance.
Schemas stay small and machine-checkable. A missing required artifact prevents
the task from being routed as complete.

The task entry in `graph.json` is the host-owned location for
`execution_state` and `acceptance_state`; workers do not write either field.

### 7.2 Slice A0 route contract

Slice A0 takes a validated, structured intake manifest as input. It does not
infer ambiguity or call a model: an intake adapter is a later Slice-A concern.
The manifest contains the human request, objective, scope, exclusions, safe
assumptions, and one declared ambiguity classification.

For `clarification-required`, `/route` creates `request.md`, an empty
`decisions.json`, a revision-one blocked `graph.json`, and exactly one gate;
then it stops without selecting a task or rendering a packet. Re-running the
unchanged manifest is idempotent: it creates no second gate and does not change
the graph revision.

After a recorded gate answer, `/route` records its decision provenance,
selects at most one `pending` task, and renders that task's immutable packet.
It prints the manual worker handoff but never launches a process. The A0 test
fixtures must cover: blocked ambiguous input, idempotent re-route, answered
gate, executable input, absent required artifact, and the absence of worker
processes or `result.md` files.

## 8. Safety, quality, and recovery features

### 8.1 Scope guards and change budget

Task packets define allowed and forbidden paths, non-goals, and a maximum
intended change size. Verification checks these constraints. Work outside the
contract becomes a separate proposed ticket.

### 8.2 Later reliability work

Decision-conflict automation, typed retry/block policy, rich reproducibility
receipts, drift detection, and maintenance analytics are Phase-2 or Phase-3
work. Phase 1 retains only the failure boundary in §2.4, the human gate, the
bounded packet, and implementation-only independent verification.

## 9. OpenCode organization and commands

Phase 1 needs only one human-invoked `/route` command, a task-packet template,
and two narrow worker profiles: implementer and independent verifier. A route
pass prints the manual handoff required to give a packet to a worker; no
command dispatches it. Intake, research, design, specification, and ticketing
are workflow roles recorded in the packet, not a required command suite.
Future commands such as `/resume`, `/maintain`, and graph execution are
introduced only with their Phase-2/3 evidence.

## 10. Matt Pocock skill composition

Use skills as constrained building blocks rather than creating one huge
all-purpose agent.

| Workflow | Skill composition | Expected boundary |
| --- | --- | --- |
| Intake | Meta-prompting / Ask Matt | Clarify and structure; do not decide product direction. |
| Discovery | Research / docs grilling | Gather cited facts and unknowns. |
| Design | Docs grilling + ADR-oriented design | Compare choices and propose boundaries. |
| Specification | Design output + acceptance authoring | Produce verifiable contract; no code. |
| Ticketing | Planning + task graph compiler | Create small, dependency-aware tasks. |
| Implementation | TDD plus approved ticket | Make only scoped changes with evidence. |
| Verification | Independent review | Validate spec, standards, scope, and regression risk. |
| Maintenance | Inspection + narrow patch/review | Curate and safely address operational debt. |

The selected composition is recorded in the task packet and final receipt so
later maintainers can understand which workflow and constraints produced an
artifact.

## 11. Delivery phases

### Phase 1 — Minimum usable workflow

Implement only one end-to-end, human-invoked path:

- `/route` prepares files and prompts but never auto-launches a worker;
- begin with Slice A0: an ambiguous request produces a blocked graph and one
  gate, then stops with no task execution;
- one sequential task has a bounded packet, scope, result claim, and graph
  record;
- `request.md` keeps ambiguity classification and creates a human gate only for
  material choices;
- implementation tasks alone receive independent verification;
- `llm-wiki` is an optional, pinned knowledge adapter rather than a workflow or
  control-plane subsystem.

This phase should support one sequential project slice end-to-end before any
automatic broad parallelism or sophisticated recovery is added.

### Phase 2 — Reliable orchestration

Add:

- dependency-aware task graph execution;
- safe parallel scheduling based on declared read/write sets;
- bounded retry, typed blocks, and `/resume`;
- reproducible per-run receipts;
- decision conflict detection.

### Phase 3 — Long-term maintenance

Add:

- `/maintain` and curated maintenance backlog;
- documentation/spec/code drift checks;
- repeated-finding analysis;
- operational health and dependency review workflows.

## 12. Decisions resolved for Phase 1

1. `/route` prepares files and prompts only; it does not launch OpenCode agents.
2. Per-run state is `$ORCHESTRATOR_RUN_STATE_DIR/runs/<run-id>/` and is
   generated execution state, not repository knowledge.
3. Material product decisions are never accepted automatically.
4. The first proof is Slice A (ambiguous request through human gate and graph
   record), followed by Slice B (one implementation task and independent
   verification).
5. Irreversible data changes, cost commitments, external publication,
   credential/security-sensitive work, and durable product-direction decisions
   always require a human gate.

## 13. Success criteria for this design

The workflow is successful when it can demonstrate that:

1. An ambiguous human request is either clarified or safely bounded before
   execution.
2. Research, design, specification, ticketing, and implementation do not blur
   into a single unreviewable agent response.
3. A later task receives the relevant accepted decisions and prior evidence
   without requiring hidden conversation context.
4. The orchestrator can route a run back to focused research, a decision gate,
   or a repair task rather than forcing linear progress.
5. Independent verification can reject an unsupported implementation claim.
6. A maintainer can reconstruct what happened from files and receipts.
7. The system remains smaller than a general-purpose lifecycle/control plane.
8. `graph.json` records explicit dependencies, approval gates, and a
   feedback/repair path rather than treating a task as an isolated prompt
   chain.
