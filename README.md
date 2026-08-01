# OpenCode Orchestrated Agent Workflow

This repository designs an orchestrator that turns one human request into an
independently verified project result. It builds context, composes workflows
and skills, dispatches a task graph, and replans from file-backed evidence.

The design baseline is in [docs/design](docs/design/README.md). The earliest
proposal remains available in Git at commit 75b0673; the current design resolves
its former dispatch question in favour of real agent dispatch.

There is intentionally no implementation yet. The first implementation must
prove one natural-language request through dispatch and independent
verification; manual packet preparation is not a product slice.
