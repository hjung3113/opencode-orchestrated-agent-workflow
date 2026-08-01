# Design baseline

These documents define the restart baseline. They are derived from the
earliest proposal at commit 75b0673 and from the explicit decision that the
product dispatches selected agents rather than only preparing prompts for a
human.

Read in this order:

1. [product.md](product.md) — outcome, authority, and non-goals.
2. [architecture.md](architecture.md) — the one-request-to-receipt system.
3. [workflows.md](workflows.md) — workflow selection, dispatch, and replan.
4. [file-protocol.md](file-protocol.md) — durable, replayable handoffs.
5. [delivery-plan.md](delivery-plan.md) — the smallest proof sequence.

AGENTS.md is the concise repository-wide rule set. These files hold the design
detail; no other design, contract, workflow, or ADR document exists until a
demonstrated need requires one.
