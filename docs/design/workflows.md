# Workflows

Each workflow has explicit inputs, outputs, and a skill composition. The
orchestrator selects the next workflow from current artifacts and exit
conditions; workflow order is not a fixed user-operated checklist.

The design distinguishes four concepts:

- a **workflow definition** describes a kind of work and its contract;
- a **workflow instance** applies one definition to one bounded packet;
- a **task node** schedules one workflow instance in an accepted graph;
- a **preset** supplies default policy for a class of request before the graph
  is compiled.

A preset never contains graph nodes, edges, or state transitions. The accepted
graph is the only representation of actual work order.

| Workflow | Input | Output | Typical skill role |
| --- | --- | --- | --- |
| Intake | Human request | Request contract, ambiguities, assumptions, routing recommendation | Meta-prompt framing |
| Research | Bounded question and context packet | Cited facts, limitations, unknowns | Research and documentation analysis |
| Design | Request, research, determined direction | Options, recommendation, proposed Material Decisions | Design and ADR analysis |
| Specification | Determined direction | Testable contract and acceptance criteria | Specification authoring |
| Ticketing | Contract and context | Small dependency-aware graph | Planning and graph compilation |
| Implementation | One admitted task packet | Scoped changes, result, evidence | TDD and implementation |
| Verification | Contract, changes, evidence | Pass, findings, or block | Independent review |
| Repair | Verification finding | Narrow correction and new evidence | Diagnosis and implementation |
| Maintenance | Evidence of drift or debt | Bounded candidate or repair task | Inspection and review |

Maintenance is not a bypass: any candidate it produces re-enters the same
intake, task, and independent-verification loop before it can contribute to a
receipt.

## Baseline presets

Version 1 has only two presets with materially different capability and
completion envelopes.

| Preset | Default capability | Completion |
| --- | --- | --- |
| `inspect@1` | Repository read; no local writes or network | Independently verified cited result with limitations; no application claim |
| `local-change@1` | Repository read, isolated declared local writes, admitted commands; no external mutation | Verified Result preserved under harness control and receipted; no application claim |

Bug fixing, feature development, refactoring, CI diagnosis, and documentation
work are routing signals, not separate presets until observed traces require a
materially different policy envelope. Brownfield discovery is intake behavior.
External effects are explicit capability grants. Preset inheritance and
repository-defined preset catalogs are not supported in v1.

Each preset records an id and version, applicability and non-applicability
signals, default capabilities and budgets, evidence and verification
expectations, and completion conditions. The model may propose a preset and a
narrowing override. The kernel admits the effective policy and records the
selection evidence, defaults, deviations, and rationale in the run and
receipt. A preset cannot weaken independent verification, provenance, or the
material-decision rule.

## Selection and dispatch

1. Load the request, accepted and proposed Material Decisions, completed
   artifacts, verifier findings, and unresolved questions.
2. Check whether a Material Decision is genuinely required. If not, choose the
   smallest workflow that reduces the current uncertainty or advances the Run
   toward a receipt.
3. Compile a packet with only the relevant constraints and evidence.
4. Select the workflow's skill composition and record it in the packet.
5. Compile a task or compatible task set. Dependencies and overlapping writes
   determine scheduling.
6. Submit the proposed graph revision and packets to deterministic admission.
7. Dispatch admitted tasks and wait for runtime observations and staged
   terminal artifacts.
8. Admit valid artifacts, verify result-producing work independently, then
   re-enter selection.

## Exit rules

- Intake exits to execution when the request is executable or safely bounded by
  recorded assumptions.
- Research exits when its evidence answers the bounded question or clearly
  states what remains unknown.
- Design exits when direction is determined by the admitted request, policy,
  and evidence, or with a concise Material Decision request.
- Implementation exits only to independent verification.
- A verification finding exits to one focused repair task; a repeated
  same-cause failure exits to a typed block.
- Completion requires a receipt, not an agent declaration. For
  `local-change@1`, the receipt exposes the Verified Result and must not claim
  that it is an Applied Result.

Runtime completion is distinct from workflow completion. An OpenCode session
may become idle while the task remains blocked by missing artifacts, invalid
scope, or required verification.
