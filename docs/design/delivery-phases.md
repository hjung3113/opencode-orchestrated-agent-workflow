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

Deliver reliable orchestration through bounded, operator-observable behavior
slices. Before an implementation slice is selected, an independent scope gate
classifies each ADR-0003 direction category for that candidate as resolved,
guarded not-applicable, or blocking. It records either
`implementation-ready` for that candidate or `specification-required` with the
named gaps.

A Phase 2 behavior joins the product only when its matching contract,
implementation, and public evidence co-land in the same slice. Completing a
design record, contract, or implementation alone does not advance the product.
The next task removes a named blocker; a smaller documentation cleanup cannot
outrank it.

Dependency-aware execution, bounded retry and `/resume`, receipts, decision
conflict detection, and later safe parallel admission are possible behavior
slices, not a required all-at-once specification gate. Resource admission is
not applicable only for a slice whose contract keeps `max_concurrency: 1`.
See [Phase 2 delivery and readiness](phase-2-delivery.md).

### Phase 3 — Long-term maintenance

Add:

- `/maintain` and curated maintenance backlog;
- documentation/spec/code drift checks;
- repeated-finding analysis;
- operational health and dependency review workflows.
