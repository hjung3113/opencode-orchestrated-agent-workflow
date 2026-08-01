# Workflows

Each workflow has explicit inputs, outputs, and a skill composition. The
orchestrator selects the next workflow from current artifacts and exit
conditions; workflow order is not a fixed user-operated checklist.

| Workflow | Input | Output | Typical skill role |
| --- | --- | --- | --- |
| Intake | Human request | Request contract, ambiguities, assumptions, routing recommendation | Meta-prompt framing |
| Research | Bounded question and context packet | Cited facts, limitations, unknowns | Research and documentation analysis |
| Design | Request, research, accepted decisions | Options, recommendation, proposed decisions | Design and ADR analysis |
| Specification | Accepted direction | Testable contract and acceptance criteria | Specification authoring |
| Ticketing | Contract and context | Small dependency-aware graph | Planning and graph compilation |
| Implementation | One approved task packet | Scoped changes, result, evidence | TDD and implementation |
| Verification | Contract, changes, evidence | Pass, findings, or block | Independent review |
| Repair | Verification finding | Narrow correction and new evidence | Diagnosis and implementation |
| Maintenance | Evidence of drift or debt | Bounded candidate or repair task | Inspection and review |

## Selection and dispatch

1. Load the request, accepted and proposed decisions, completed artifacts,
   verifier findings, and unresolved questions.
2. Check whether a material decision is genuinely required. If not, choose the
   smallest workflow that reduces the current uncertainty or advances delivery.
3. Compile a packet with only the relevant constraints and evidence.
4. Select the workflow's skill composition and record it in the packet.
5. Compile a task or compatible task set. Dependencies and overlapping writes
   determine scheduling.
6. Dispatch agents and wait for terminal file artifacts.
7. Verify delivery work independently, then re-enter selection.

## Exit rules

- Intake exits to execution when the request is executable or safely bounded by
  recorded assumptions.
- Research exits when its evidence answers the bounded question or clearly
  states what remains unknown.
- Design exits only with an accepted direction or a concise material decision
  request.
- Implementation exits only to independent verification.
- A verification finding exits to one focused repair task; a repeated
  same-cause failure exits to a typed block.
- Completion requires a receipt, not an agent declaration.
