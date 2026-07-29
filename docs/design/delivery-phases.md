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
