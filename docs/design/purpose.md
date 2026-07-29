## 1. Purpose

Build an OpenCode-oriented agent system that can take a project from an
initial human request through research, design, specification, ticketing,
implementation, verification, and ongoing maintenance.

The system must not treat that path as one long agent prompt. Each phase is a
separate workflow with explicit inputs, outputs, gates, and ownership. A
central **orchestrator** continuously reads the results of completed work,
combines the active decisions and remaining uncertainty, and compiles the next
smallest useful task graph. It may schedule compatible tasks sequentially or
in parallel.

The system borrows the useful principles of a conductor-style workflow:

- acceptance criteria and scope before execution;
- durable, host-owned execution state;
- evidence rather than self-reported completion;
- independent review;
- explicit stop conditions when a failure repeats.

It deliberately does **not** copy a heavyweight lifecycle/control plane,
provider/model-routing machinery, or worktree/terminal-specific mechanisms.
The intended result is a small, comprehensible project workflow that can grow
only when a demonstrated need appears.
