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
