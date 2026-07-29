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
The manifest contains the human request, objective, scope, allowed paths,
forbidden paths, non-goals, exclusions, safe assumptions, and one declared
ambiguity classification.

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
