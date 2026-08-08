# Workflows

Each Workflow Definition has explicit inputs, outputs, and a skill composition.
The orchestrator selects the next Workflow Definition from current Artifacts
and exit conditions; selection order is not a fixed user-operated checklist.

## Canonical skill composition

The initial compositions use the original Matt Pocock skills as immutable
building blocks. The product does not copy their instructions into commands,
agent prompts, or product-owned replacement skills. A source manifest pins each
approved original by repository, revision, path, and digest and classifies it:

- `workflow_recipe`: coordinates multiple agents, checkpoints, or external
  effects. The orchestrator compiles its compatible steps into admitted Tasks;
  the recipe is not loaded wholesale into one Attempt.
- `attempt_skill`: can execute inside one Packet and is loaded unchanged after
  its capability requirements are admitted.
- `vocabulary`: shared design or review language included as bounded context;
  it does not create a workflow step by itself.

An adapter binds the original's inputs and outputs to declared Artifacts. When
an original recipe asks for a child agent, checkpoint, issue publication,
commit, or another external effect, the adapter represents that as a separate
Task, Material Decision Request, or deferred Application proposal. It never
pretends the forbidden step ran. An incompatible or unavailable original fails
as `dependency_unavailable`. Updating an original revision requires an explicit
manifest change and adapter compatibility verification, never an
in-repository fork.

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

| Workflow Definition | Input | Output | Ordered recipe |
| --- | --- | --- | --- |
| Intake | Human request | Request contract, ambiguities, assumptions, routing recommendation | Kernel candidate filter → optional `ask-matt` advisory proposal when multiple routes remain → Intake output gate |
| Research | Bounded question and context packet | Cited facts, limitations, unknowns | Compile `research` into admitted worker Tasks → cited-evidence gate; `grill-with-docs` becomes a Material Decision interaction only when evidence shows material ambiguity |
| Design | Request, research, determined direction | Options, recommendation, proposed Material Decisions | `domain-modeling` vocabulary → `codebase-design` attempt skill → optional `prototype` as a separate disposable Design Task → decision/output gate |
| Specification | Determined direction | Testable contract and acceptance criteria | Compile `to-spec` → file-backed Specification gate; tracker publication remains a separate authorized effect |
| Ticketing | Contract and context | Small dependency-aware graph | Compile `to-tickets` → graph-and-Packet proposal → Kernel graph admission; no direct issue publication |
| Implementation | One admitted task packet | Scoped changes, Result, evidence | Compile `implement`; for bug tasks, `diagnosing-bugs` precedes `tdd`; for feature tasks, `tdd` is conditional on the acceptance contract → Result gate → separate Verification Task; commit is excluded from v1 |
| Verification | Contract, changes, Evidence | Verdict: pass, finding, or block | Compile `code-review` into independent Standards and Spec verifier work when the graph/budget admits it, then one Review gate; never run it inside the producing worker |
| Repair | Verification Finding | Narrow correction and new Evidence | `diagnosing-bugs` → conditional `tdd` → bounded `implement` → Result gate → separate re-verification |
| Maintenance | Evidence of drift or debt | Bounded candidate or repair task | Compile `triage` or `improve-codebase-architecture` → candidate gate; any change re-enters Intake and Verification |

Maintenance is not a bypass: any candidate it produces re-enters the same
intake, task, and independent-verification loop before it can contribute to a
receipt.

Every compiled step declares its pinned skill, precondition, expected Artifact,
allowed capabilities, and output gate. Runtime Observation records which
admitted skills were actually loaded and invoked and in what order; a Receipt
does not claim a composition that was merely listed in a Packet.

## Workflow route contract

Each versioned Workflow Definition declares:

- required and forbidden input Artifact kinds;
- allowed authority roles, Presets, and capability classes;
- direct trigger rules and terminal output kinds;
- required, optional, and forbidden skill classes;
- ordered recipe steps, their preconditions, and exit conditions;
- task-kind and keyword hints that may narrow candidates but never grant
  authority or decide intent alone.

The Kernel applies structural rules before model judgment. An unresolved
material choice yields a Material Decision Request; an admitted Finding permits
Repair; an unverified changed Output Snapshot requires Verification; a
Packet-bound `replan_requested` Artifact permits only compatible successor
workflows; and an admitted ready Task runs its recorded Workflow Definition. A
planner ranks the remaining eligible definitions and explains its choice. The
admitted Packet and Receipt record the matched route-rule ids and any hints used
as Evidence.

An Attempt that discovers necessary work outside its Workflow Definition calls
the Packet-bound `request_route` tool. The tool stages a `replan_requested`
Artifact containing the source Task and Attempt, recommended Workflow
Definition, reason, Evidence references, and required capability. It ends the
Attempt without launching an OpenCode child agent or widening authority. The
Kernel validates the request and may admit a successor graph revision; the
original agent does not choose or start its delegate.

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
rules, default capabilities and budgets, evidence and verification
expectations, and completion conditions. The Kernel computes the eligible
Preset set from those rules. The model proposes a structured
`preset_selection` from that set containing selection Evidence, any proposed
narrowing override, rationale, and matched rule ids. The Kernel admits the
effective Run Policy and records `preset_selection_ref` plus the typed defaults,
proposed and admitted narrowing overrides, deviations, rationale, and matched
rules in the Run and Receipt. These fields are protocol objects, not prose
folded into a summary; the admitted override may only narrow the Preset defaults.
A Preset cannot weaken independent verification, provenance, or the
Material Decision rule.

An `inspect@1` Research packet may request `network` only with one or more
exact External Read Targets. No other v1 Workflow Definition or Preset admits
`network`. Target selection is planner judgment recorded in the Packet; target admission,
runtime use, and evidence provenance are deterministic Kernel checks.

## Selection and dispatch

1. Load the request, accepted and proposed Material Decisions, completed
   artifacts, verifier findings, and unresolved questions.
2. Apply the deterministic route registry and direct-trigger rules to compute
   the eligible Workflow Definition set. If a Material Decision is required,
   emit that request instead of an execution candidate.
3. Ask the planner to rank only the eligible set and record matched rule ids,
   hints, and rationale; reject a proposal outside the set.
4. Compile a Packet with only the relevant constraints and Evidence.
5. Select the Workflow Definition's compatible original-skill composition,
   resolve every pinned identity through its adapter, and record the ordered
   composition in the Packet.
6. Compile a Task or compatible Task set. Dependencies and overlapping writes
   determine scheduling.
7. Submit the proposed graph revision and packets to deterministic admission.
8. Dispatch admitted tasks and wait for runtime observations and staged
   Terminal Artifacts.
9. Admit valid artifacts, independently verify work that produces an Output
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
