# System map

## Purpose

This map shows the authoritative surfaces of the product. It complements the
design proposal: it describes where a maintainer finds the current truth, not
how future runtime behavior is implemented.

```text
Versioned repository knowledge                 External mutable run state
──────────────────────────────                 ──────────────────────────
CONTEXT.md, ADRs, contracts, workflows         $ORCHESTRATOR_RUN_STATE_DIR/
design proposal, source, tests                 runs/<run-id>/
        │                                                │
        │ validated manifest + state-root               │ host-owned routing artifacts
        └──────────────► /route ◄───────────────────────┘
                          │
                          ├─ request.md
                          ├─ decisions.json
                          ├─ graph.json and gates/
                          └─ one immutable task packet
                               │
                               └─ manual handoff only; no worker launch
```

## Authority boundaries

| Surface | Contains | Does not contain |
| --- | --- | --- |
| Repository knowledge | Vocabulary, accepted decisions, contracts, workflow definitions, source, tests. | Mutable run facts or developer-home tooling. |
| `/route` public seam | Validates a manifest, writes host-owned run artifacts, and prepares at most one packet. | Product-direction inference, model calls, worker dispatch, or acceptance of worker claims. |
| External run state | One run's request, decisions, graph, gates, task claims, verification, and eventual receipt. | Repository source of truth or an implicit developer workspace. |
| Worker task directory | A worker's result and evidence claims after manual handoff. | Run-level graph, decision, gate, packet, receipt, or acceptance ownership. |

## Current and deferred topology

Slice A0 currently implements only the intake-to-manual-handoff portion of
`/route`. Slice A will add the file contracts that let research, design,
specification, and ticketing feed the record-only graph. Slice B will add the
implementation-claim, independent-verification, repair, and receipt path.
Phase 2 and Phase 3 remain roadmap items; their directory names are not an
authorization to implement schedulers, retries, or maintenance automation.
