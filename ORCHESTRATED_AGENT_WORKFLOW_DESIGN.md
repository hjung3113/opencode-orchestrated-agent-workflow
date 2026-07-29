# OpenCode Orchestrated Agent Workflow — Design Proposal

## Status

Brainstorming proposal. This document defines a target architecture and does
not authorize implementation, installation, process spawning, or changes to
external systems.

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
| **Prompt engineering** | Make one agent's immediate task clear: role, objective, constraints, expected output, and acceptance criteria. | `brief.md` and the rendered decision packet. |
| **Context engineering** | Select the smallest relevant set of facts, decisions, evidence, and unresolved questions for that prompt. | `CONTEXT.md`, ADRs, manifests, and cited upstream run artifacts. |
| **Harness engineering** | Make an individual task executable and checkable: gather inputs, invoke a worker, validate outputs, and record evidence. | Task directory, `status.json`, `evidence.json`, schema checks, and verifier contract. |
| **Loop engineering** | Repeatedly observe a task/run, validate its output, retry only bounded transient failures, and route repair or escalation. | Orchestrator routing pass, exit criteria, retry/block policy, and final receipt. |
| **Graph engineering** | Coordinate the whole organization of workers: dependencies, safe parallel branches, approval gates, feedback paths, and dynamic re-planning. | `graph.json`, decision registry, task index, and orchestrator scheduler. |

The graph layer is not a static sequence of prompts. It is a dependency-aware
organization: researchers can feed designers, designers can create decisions
for spec authors, builders can be verified independently, and reviewers can
cause a bounded repair branch. The orchestrator dynamically reconfigures that
graph as new evidence arrives.

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
declared outputs, compiles the next decision packet, and creates the next edge
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

## 3. System boundary

### 2.3 Debate amendment: Phase-1 graph contract

Sol medium and Opus 5 reviewed this design through an Orca-tracked,
file-backed debate. Their combined amendment is:

- Phase 1 has no privileged daemon. The orchestrator is a **human-invoked
  `/route` pass** that writes the next graph revision and immutable task packet;
  it prepares work but does not auto-launch workers.
- Authority is enforced by path ownership: workers append only to their own
  `tasks/<task-id>/` directory and all such output is a claim. Run-level graph,
  decisions, gates, task index, and receipts are routing-pass artifacts.
- Split worker execution from acceptance: `execution_state` is
  `queued|running|succeeded|failed|blocked`, while `acceptance_state` is
  `pending|passed|failed|not_applicable`. Worker exit never proves acceptance.
- Use one canonical state root, `.orchestrator/runs/<run-id>/`, with
  `graph.json`, `decisions.json`, `task-index.json`, `tasks/`, `gates/`, and
  `final-receipt.json`. A task receives one never-rewritten `packet.md`; its
  evidence is an `evidence-claim.json`.
- A required human choice is a real artifact: `gates/<gate-id>.md` contains the
  question, consequence, options, non-binding recommendation, and empty answer
  fields. `/route` stops at an unanswered gate and records an answered gate as
  level-1 decision provenance. `NEEDS-HUMAN.md` indexes outstanding gates.
- Mandatory gates cover irreversible data changes, cost commitments, external
  sending/publication, credentials/security-sensitive work, and durable product
  direction. Superseded decisions mark downstream cited artifacts `stale`;
  stale evidence is retained but cannot satisfy current acceptance.
- In Phase 1, `graph.json` is a record, not an executor: one active task, no
  automatic retries, no parallelism, and no graph mutation during dispatch.
  A task is bound to its graph revision. Parallel scheduling, leases,
  cancellation, digest verification, and auto-launch are Phase-2 work.
- Independence is a context property: a verifier receives only specification,
  acceptance criteria, changed files, and evidence claim—not the implementer's
  private reasoning or narrative. Research/design outputs carry authority class
  and need no verifier merely to be consumed.

The first proof is **Slice A**: ambiguous request → intake → one human gate →
bounded research/design → persisted graph with dependencies and a feedback edge.
**Slice B** then proves implementation → independent verification → receipt
using Slice A's generated spec and ticket. This keeps graph engineering and
human control in the MVP without importing a heavyweight control plane.

### 3.1 Repository knowledge vs. execution state

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

Per-run mutable state is stored outside the checkout where possible, or in an
explicitly ignored location such as `.orchestrator/`. It contains only
reconstructable execution artifacts:

```text
.orchestrator/runs/<run-id>/
  request.md
  decisions.md
  plan.md
  graph.json
  tasks/<task-id>/
  reviews/
  final-receipt.json
```

This separation prevents generated status, receipts, and recovery artifacts
from being confused with source-of-truth product decisions.

### 3.2 Authority order

When sources disagree, use this order:

1. Explicit current human direction.
2. Accepted decisions and ADRs, unless superseded by (1).
3. Approved specification and acceptance criteria.
4. Verified research facts and implementation evidence.
5. Proposed decisions, agent recommendations, and historical run outputs.

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

Required outputs:

- `request.md`: interpreted objective, scope, exclusions, and desired outcome.
- `ambiguities.md`: missing information and ambiguity classification.
- `assumptions.md`: assumptions made, why they are safe, and which require
  confirmation.
- `routing-recommendation.md`: recommended next workflow and rationale.

Ambiguity classification:

- `executable`: enough information exists to proceed.
- `assumption-permitted`: a low-risk default can be recorded and used.
- `clarification-required`: the answer would materially change product
  direction, cost, data handling, public exposure, or irreversible work.

Only the first two may proceed automatically. The third creates a concise
human-decision request.

### 5.2 Discovery / research

**Goal:** Establish facts needed for a later decision, rather than make the
decision itself.

Inputs include the request contract, active decisions, and a bounded research
question. Outputs include:

- `research.md`: findings, sources, and limitations.
- `facts.json`: machine-readable claims with provenance.
- `unknowns.md`: unanswered questions and their impact.
- `research-recommendation.md`: suggested next question or design input.

Research tasks should be small and independently useful. If a provider's cost
or API constraint is unknown, create a provider-constraint task; do not route
directly to design based on an unverified guess.

### 5.3 Design

**Goal:** Compare alternatives, establish boundaries, and propose durable
decisions.

Outputs:

- `options.md`: alternatives, trade-offs, constraints, and rejected paths.
- `decision-proposal.md`: one or more proposed decisions with rationale.
- `adr-draft.md`: only when a decision is durable enough to warrant it.
- `design-risks.md`: open questions, failure modes, and validation needs.

The design workflow may recommend a decision but cannot mark a material
decision accepted unless the authority rules allow it. The orchestrator routes
competing material choices to a human decision gate.

### 5.4 Specification

**Goal:** Turn accepted design decisions into observable, testable contracts.

Outputs:

- `spec.md`: behavior, interfaces, invariants, error cases, and non-goals.
- `acceptance.md`: unambiguous acceptance criteria.
- `verification-plan.md`: how each criterion will be checked.
- `scope.md`: allowed areas, excluded areas, and migration/compatibility needs.

Specification does not implement. It fails its exit gate if a reviewer cannot
state how a criterion could be verified.

### 5.5 Ticketing and task-graph compilation

**Goal:** Convert an approved specification into small, independently
verifiable execution units.

Outputs:

- `tickets.md`: human-readable task list.
- `task-graph.json`: dependencies, inputs, outputs, and routing constraints.
- one `brief.md` per proposed task.

Every task brief contains:

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

The graph declares read/write paths. Tasks with overlapping writes are
serialized. Research, independent testing, and independent review may run in
parallel only when their inputs are ready and their outputs do not conflict.

### 5.6 Implementation

**Goal:** Complete one approved ticket, and nothing broader.

An implementation agent receives a compiled decision packet, not raw broad
history. It writes:

- `result.md`: concise outcome, changes, decisions encountered, limitations.
- `evidence.json`: commands, results, changed files, and acceptance mapping.
- `status.json`: terminal status and any typed blocker.

It must create a `scope-escalation` request rather than making unapproved
architecture changes or broad cleanup.

### 5.7 Verification and review

**Goal:** Independently determine whether the implementation meets its actual
contract.

Review examines the specification, allowed paths, changed content, and
evidence. It does not accept “completed” as proof. Outputs:

- `review.md`: findings with severity, concrete evidence, and scope status.
- `verification.json`: pass/fail per acceptance criterion.
- `repair-recommendation.md`: bounded follow-up work if needed.

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
3. Compile a new task brief and decision packet.
4. Construct and update the task graph.
5. Determine safe sequential or parallel scheduling.
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
4. Creates the smallest task or compatible task set that advances the run.
5. Injects relevant historical context and explicit constraints into each brief.
6. Schedules tasks based on dependencies and declared read/write paths.
7. Waits for terminal artifacts, validates them, then repeats.

### 6.2 Decision packet

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
runs/<run-id>/
  request.md
  decisions.md
  plan.md
  graph.json
  task-index.json
  tasks/<task-id>/
    brief.md
    input-manifest.json
    result.md
    evidence.json
    handoff.md
    status.json
  reviews/<review-id>/
    brief.md
    review.md
    verification.json
  final-receipt.json
```

### 7.2 Required task status shape

```json
{
  "task_id": "example",
  "workflow": "research",
  "state": "queued | running | completed | failed | blocked",
  "updated_at": "ISO-8601 timestamp",
  "blocker_type": "optional typed reason",
  "output_manifest": ["result.md", "evidence.json"]
}
```

### 7.3 Evidence shape

```json
{
  "changed_files": [],
  "commands": [{"command": "", "exit_code": 0, "summary": ""}],
  "acceptance_mapping": [
    {"criterion": "", "evidence": "artifact path or command result"}
  ],
  "known_limitations": []
}
```

The exact schemas may evolve, but they must remain small, versioned, and
machine-checkable. A missing required artifact prevents a task from being
routed as complete.

## 8. Safety, quality, and recovery features

### 8.1 Decision conflict detection

Every decision includes an identifier, status, rationale, evidence, affected
scope, and (where applicable) a superseded decision. When a new task conflicts
with an accepted decision, the orchestrator creates a `decision-conflict`
workflow instead of silently choosing a side.

### 8.2 Scope guards and change budget

Task briefs define allowed and forbidden paths, non-goals, and a maximum
intended change size. Verification checks these constraints. Work outside the
contract becomes a separate proposed ticket.

### 8.3 Failure and retry policy

- A transient execution failure may retry a limited number of times.
- A repeated failure with the same root cause becomes `blocked`.
- Missing facts route to focused Discovery.
- Missing material decisions route to the human decision gate.
- Failed verification creates a fresh, bounded repair task.

The run record must say what failed, what evidence exists, what was attempted,
and precisely what information or authority would unblock it.

### 8.4 Receipts and reproducibility

The final receipt records input artifact versions or hashes, the task graph,
agent/skill identities, decisions applied, commands run, verification results,
final status, and known limitations. It is a reconstruction tool, not merely
a success badge.

### 8.5 Drift detection

A later maintenance workflow compares accepted ADR/spec claims with code,
tests, and documentation. It creates evidence-backed maintenance candidates;
it does not automatically edit the system merely because a mismatch is found.

## 9. OpenCode organization and commands

Suggested repository layout:

```text
.opencode/
  agents/
    intake.md
    researcher.md
    designer.md
    spec-author.md
    ticket-planner.md
    implementer.md
    verifier.md
    maintainer.md
    orchestrator.md
  commands/
    intake.md
    research.md
    design.md
    spec.md
    ticket.md
    implement.md
    verify.md
    maintain.md
    route.md
    status.md
    resume.md
  skills/
    meta-prompt-intake.md
    research-composition.md
    design-composition.md
    implementation-composition.md
  templates/
    task-brief.md
    decision-packet.md
    evidence.json
    status.json
```

Command meanings:

| Command | Intent |
| --- | --- |
| `/intake` | Refine a human request, list ambiguity, and select the next workflow. |
| `/research` | Run a bounded fact-finding task. |
| `/design` | Compare options and prepare decisions/ADR proposals. |
| `/spec` | Convert accepted decisions into a testable contract. |
| `/ticket` | Produce a dependency-aware execution graph. |
| `/implement` | Execute exactly one approved implementation ticket. |
| `/verify` | Independently validate a ticket against spec and evidence. |
| `/maintain` | Identify and curate health/debt/drift work. |
| `/route` | Re-read run artifacts and compile the next appropriate task graph. |
| `/status` | Summarize active tasks, decisions, blockers, and evidence. |
| `/resume` | Reconstruct an interrupted run from durable artifacts. |

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

The composition must remain visible in each task's receipt so later maintainers
can understand which workflow and constraints produced an artifact.

## 11. Delivery phases

### Phase 1 — Minimum usable workflow

Implement only the design-critical path:

- `/intake`, `/research`, `/design`, `/spec`, `/ticket`, `/implement`,
  `/verify`, and `/route`;
- file protocol and minimal schemas;
- accepted/proposed decision tracking;
- scope guards;
- evidence-required completion.

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

## 12. Decisions still needed before implementation

1. Does the orchestrator directly launch OpenCode agents, or only prepare files
   and prompts for human-approved execution?
2. Will per-run state always live outside the checkout, or is an ignored
   `.orchestrator/` directory required for portability?
3. Which decisions may be accepted automatically, if any? The recommended
   initial answer is: only reversible, low-risk implementation details.
4. What is the first narrow vertical slice to prove the system: a research-to-
   ADR flow, a spec-to-ticket flow, or a one-ticket implementation flow?
5. Which approval gates must always require a human: irreversible data changes,
   cost commitments, external publication, security-sensitive changes, and
   durable product-direction decisions are recommended defaults.

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
8. A task can be placed in a graph with explicit dependencies, read/write
   boundaries, approval gates, and feedback/repair paths rather than being
   treated as an isolated prompt chain.
