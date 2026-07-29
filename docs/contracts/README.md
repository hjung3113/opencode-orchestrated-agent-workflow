# Contracts

Contracts describe observable guarantees at a repository seam. They are more
specific than the design proposal and more stable than a task packet. A change
to a contract needs matching public evidence and, when it changes a durable
trade-off, an accepted ADR.

## Document authority

| Document kind | Owns | Does not own |
| --- | --- | --- |
| `CONTEXT.md` | Ubiquitous language. | Behavior, implementation detail, or a to-do list. |
| `docs/adr/` | Accepted, durable architectural decisions. | Temporary task plans. |
| `docs/contracts/` | Current observable interfaces, artifact ownership, and invariants. | Product roadmap rationale. |
| `docs/workflows/` | Role inputs, outputs, handoffs, and stop conditions. | Runtime implementation. |
| `docs/design/` | Whole-system rationale and future roadmap. | A claim that a future phase is implemented. |
| GitHub issues | Scoped, changeable acceptance criteria for one task. | Long-lived architectural authority. |

## Current contracts

- [Phase-1 artifacts and ownership](phase-1-artifacts.md) — the canonical
  writer, consumer, authority, and status of each run artifact.

Future contracts are added only with the phase that makes them observable.
