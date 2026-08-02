# Workflows

Each Workflow Definition has explicit inputs, outputs, and a skill composition.
The orchestrator selects the next Workflow Definition from current Artifacts
and exit conditions; selection order is not a fixed user-operated checklist.

The design distinguishes four concepts. A Task is the accepted graph node that
schedules a Workflow Instance; its Packet is the immutable execution contract,
and an Attempt is one actual runtime execution of that Task.

- a **Workflow Definition** describes a kind of work and its contract;
- a **Workflow Instance** applies one definition to one bounded Packet;
- a **Task** schedules one Workflow Instance in an accepted graph;
- a **Preset** supplies default policy for a class of request before the graph
  is compiled.

A Preset never contains graph nodes, edges, or Run State transitions. The accepted
graph is the only representation of actual work order.

Once admitted, a selected Preset and any admitted narrowing override form that
Run's Run Policy. Every Packet is a Task-specific contract constrained by that
Run Policy and may narrow it further, never widen it.

| Workflow Definition | Input | Output | Typical skill role |
| --- | --- | --- | --- |
| Intake | Human request | Request contract, ambiguities, assumptions, routing recommendation | Meta-prompt framing |
| Research | Bounded question and context packet | Cited facts, limitations, unknowns | Research and documentation analysis |
| Design | Request, research, determined direction | Options, recommendation, proposed Material Decisions | Design and ADR analysis |
| Specification | Determined direction | Testable contract and acceptance criteria | Specification authoring |
| Ticketing | Contract and context | Small dependency-aware graph | Planning and graph compilation |
| Implementation | One admitted task packet | Scoped changes, Result, evidence | TDD and implementation |
| Verification | Contract, changes, Evidence | Verdict: pass, finding, or block | Independent review |
| Repair | Verification Finding | Narrow correction and new Evidence | Diagnosis and implementation |
| Maintenance | Evidence of drift or debt | Bounded candidate or repair task | Inspection and review |

Maintenance is not a bypass: any candidate it produces re-enters the same
intake, task, and independent-verification loop before it can contribute to a
receipt.

## Baseline presets

Version 1 has only two presets with materially different capability and
completion envelopes.

| Preset | Default capability | Completion |
| --- | --- | --- |
| `inspect@1` | Repository read and optional declared exact external reads; no local writes | Independently verified cited report with limitations; no application claim |
| `local-change@1` | Repository read, isolated declared local writes, admitted commands; no network or external mutation | Verified Result preserved under harness control and receipted; no application claim |

Bug fixing, feature development, refactoring, CI diagnosis, and documentation
work are routing signals, not separate presets until observed traces require a
materially different policy envelope. Brownfield discovery is intake behavior.
External effects are explicit capability grants. Preset inheritance and
repository-defined preset catalogs are not supported in v1.

Each Preset records an id and version, applicability and non-applicability
signals, default capabilities and budgets, evidence and verification
expectations, and completion conditions. The model may propose a preset and a
narrowing override. The Kernel admits the effective Run Policy and records the
selection evidence, defaults, deviations, and rationale in the Run and Receipt.
A Preset cannot weaken independent verification, provenance, or the
Material Decision rule.

An `inspect@1` Research packet may request `network` only with one or more
exact External Read Targets. No other v1 Workflow Definition or Preset admits
`network`. Target selection is planner judgment recorded in the Packet; target admission,
runtime use, and evidence provenance are deterministic Kernel checks.

## Selection and dispatch

1. Load the request, accepted and proposed Material Decisions, completed
   artifacts, verifier findings, and unresolved questions.
2. Check whether a Material Decision is genuinely required. If not, choose the
   smallest Workflow Definition that reduces the current uncertainty or
   advances the Run toward a receipt.
3. Compile a Packet with only the relevant constraints and Evidence.
4. Select the Workflow Definition's skill composition and record it in the
   Packet.
5. Compile a Task or compatible Task set. Dependencies and overlapping writes
   determine scheduling.
6. Submit the proposed graph revision and packets to deterministic admission.
7. Dispatch admitted tasks and wait for runtime observations and staged
   Terminal Artifacts.
8. Admit valid artifacts, independently verify work that produces an Output
   Snapshot, then
   re-enter selection.

## Exit rules

- Intake exits to execution when the request is executable or safely bounded by
  recorded assumptions.
- Research exits when its evidence answers the bounded question or clearly
  states what remains unknown.
- Design exits when direction is determined by the admitted request, policy,
  and Evidence, or with a concise Material Decision Request.
- Implementation exits only to independent verification.
- A Verification Finding exits to one focused Repair Task; a repeated
  same-cause failure exits to a Typed Block.
- Completion requires a Receipt, not an agent declaration. For
  `local-change@1`, the Receipt exposes the Verified Result and must not claim
  that it is an Applied Result.

Runtime completion is distinct from Workflow Instance completion. An OpenCode
session may become idle while the Task remains blocked by missing Artifacts, invalid
scope, or required verification.
