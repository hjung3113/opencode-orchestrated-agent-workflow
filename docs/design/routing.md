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
4. Creates the smallest dependency-ready task that advances the run; for a
   Phase 2 behavior candidate, this means removing a named readiness blocker
   or co-landing its ready contract, implementation, and public evidence.
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

### 6.3 Future Phase 2 delivery readiness gate

This is future Phase 2 delivery design, not a current runtime operation. Before
selecting a Phase 2 implementation task, an independent read-only scope gate
classifies each ADR-0003 direction category for the candidate as
`resolved`, `not applicable` with an explicit guard, or `blocking`. It records
either `implementation-ready` or `specification-required: <named blocking
items>`. The former applies only to that candidate and is not a Phase 2
completion claim. A design record, a contract, or an implementation by itself
does not make the behavior observable; all three must co-land with public
evidence in one bounded slice. Its design-time ownership and first candidate
are recorded in [Phase 2 delivery and readiness](phase-2-delivery.md) and the
[readiness ledger](phase-2-readiness-ledger.md).
