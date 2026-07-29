# OpenCode Orchestrated Agent Workflow

A small, human-invoked workflow harness for taking one bounded product task
from request to evidence-backed acceptance without turning agent chat into an
unbounded control plane.

## Start here

| Need | Authority |
| --- | --- |
| Shared domain terms | [CONTEXT.md](CONTEXT.md) |
| Product direction and delivery roadmap | [design proposal](docs/design/README.md) |
| Accepted durable decisions | [ADRs](docs/adr/) |
| Current system topology | [system map](docs/architecture/system-map.md) |
| Current artifact guarantees and ownership | [contracts](docs/contracts/) |
| Role handoffs and their files | [workflows](docs/workflows/) |
| Current runtime source layout | [src](src/README.md) |
| Session continuation | `HANDOFF.md` (local, intentionally untracked) |

## Delivery roadmap

| Milestone | Intent | Status |
| --- | --- | --- |
| Phase 1 — Slice A0: Intake and Route | Manifest, human gate, and manual packet through `/route`. | Complete |
| Phase 1 — Slice A: Research to Task Graph | File-backed research, design, specification, and ticketing inputs to a record-only graph. | Next |
| Phase 1 — Slice B: Implement, Verify, Receipt | One implementation claim through independent verification and receipt. | Planned |
| Phase 2: Reliable Orchestration | Safe execution, bounded retry, resume, receipts, and conflict handling. | Deferred |
| Phase 3: Long-Term Maintenance | Curated maintenance, drift checks, and operational health. | Deferred |

Milestone state is managed in GitHub. Runtime state is always external under
an absolute `ORCHESTRATOR_RUN_STATE_DIR`; it is not a source directory.
