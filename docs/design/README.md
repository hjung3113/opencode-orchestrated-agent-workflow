# Design proposal index

This directory is the canonical location for the original design proposal,
partitioned mechanically by its former top-level sections. The partition
preserves the complete proposal; these files are rationale and roadmap unless
an ADR or contract explicitly says otherwise. Current observable behavior is
owned by `docs/contracts/` and public tests.

For Phase 2, [delivery and readiness](phase-2-delivery.md) summarizes how the
accepted v2 design records are turned into product slices. The
`phase-2-v2-*.md` records are inputs to that process; they are not a
whole-phase completion signal or an implementation authorization.
The [readiness ledger](phase-2-readiness-ledger.md) records the
candidate-specific, development-time result that routes the next Phase 2
design or delivery task.

[Original design completion roadmap](completion-roadmap.md) records the
dependency-ordered, evidence-gated path from v2 record-only lifecycle dogfood
through optional execution, retry, parallel admission, and Phase 3 maintenance.
The [v2 record-only lifecycle decision](phase-2-v2-record-only-lifecycle.md)
records the accepted ownership and terminal-boundary input for Issue #18; it
does not implement that lifecycle.

| Former section | Canonical document |
| --- | --- |
| Status | [status](status.md) |
| 1. Purpose | [purpose](purpose.md) |
| 2. Core principles | [core principles](core-principles.md) |
| 3. System boundary | [system boundary](system-boundary.md) |
| 4. Workflow lifecycle | [lifecycle](lifecycle.md) |
| 5. Workflows | [workflows](workflows.md) |
| 6. Orchestrator responsibilities | [routing](routing.md) |
| 7. File protocol | [file protocol](file-protocol.md) |
| 8. Safety and recovery | [safety and recovery](safety-and-recovery.md) |
| 9–10. OpenCode and skill composition | [organization](opencode-organization.md), [composition](skill-composition.md) |
| 11–13. Phases, decisions, success | [phases](delivery-phases.md), [decisions](phase-1-decisions.md), [success](success-criteria.md) |

## Reading router

All product work reads `CONTEXT.md`, the named issue or specification, and
relevant accepted ADRs. Then use the task-specific rows in `AGENTS.md`.
The focused contract or workflow document is authoritative over this rationale
directory; an ADR wins over a conflicting contract.

## Migration ledger

The former 634-line root proposal was split on all thirteen top-level section
headings. The canonical-destination coverage check is
`test/design-migration.test.js`; this index adds only navigation text.
