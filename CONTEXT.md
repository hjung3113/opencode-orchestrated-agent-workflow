# Orchestrated Project Work

This context describes the durable outcomes and authority boundaries of turning
one human request into independently checked project work.

## Language

**Run**:
One orchestration of a human request, continuing across resumable checkpoints
until successful completion or confirmed cancellation.
_Avoid_: Job, conversation, session

**Verified Result**:
A project outcome whose current content has passed independent verification and
whose provenance and limitations are recorded in a receipt.
_Avoid_: Delivered result, applied result, completed change

**Applied Result**:
A Verified Result incorporated into a user-designated working destination such
as a branch, pull request, deployment, or other external target.
_Avoid_: Verified result, promoted result

**Promotion**:
The Kernel's compare-and-swap preservation of an independently verified Output
Snapshot at a harness-owned Result Ref.
_Avoid_: Application, deployment promotion, merge

**Result Ref**:
The exact harness-owned Git ref holding a Verified Result after Promotion.
_Avoid_: User branch, pull request, deployment target

**Application**:
Incorporation of a Verified Result into a human-designated external target,
producing an Applied Result; it is unsupported in v1.
_Avoid_: Promotion, result preservation

**Result**:
A worker-authored proposal artifact containing its claims, evidence, and
claimed Output Snapshot; it is not a verified or applied outcome.
_Avoid_: Final result, completed result, project result

**Output Snapshot**:
The exact isolated project state a Result proposes and a verifier reviews.
_Avoid_: Result, workspace, delivered result

**Task**:
An admitted graph node that schedules one bounded Workflow Instance.
_Avoid_: Packet, attempt, session

**Workflow Definition**:
A reusable named contract for one kind of work, with required inputs, outputs,
and verification expectation.
_Avoid_: Workflow Instance, Task, Packet

**Workflow Instance**:
One application of a Workflow Definition to a bounded Packet, scheduled by a
Task.
_Avoid_: Task, attempt

**Packet**:
The immutable execution contract for a Workflow Instance, including its scope,
inputs, constraints, and authority envelope.
_Avoid_: Task, prompt, manifest

**Bootstrap Planner Envelope**:
The Kernel-owned, file-backed Intake execution contract for the pre-intake
planner Attempt, derived from the raw request and repository policy. It carries
bounded capabilities, a deadline, an idempotency key, and a Runtime
Observation reference, but never claims a Task Packet.
_Avoid_: Packet, Task, planner prompt

**Attempt**:
One actual runtime execution of a Task under its Packet, or of the pre-intake
planner under its Bootstrap Planner Envelope; a retry is a successor Attempt
and a repair is a new Task.
_Avoid_: Task, session, workflow instance

**Attempt Lifecycle State**:
The Kernel's recorded lifecycle position of one Attempt. Its Terminal Attempt
States close that Attempt, not necessarily its Task.
_Avoid_: Task State, Runtime Exit Reason, Run Lifecycle State

**Artifact**:
An immutable, identified record preserved for a Run.
_Avoid_: Chat history, mutable state, temporary file

**Runtime Observation**:
An adapter-authored Artifact recording observed runtime facts; it is not a task
verdict.
_Avoid_: Evidence verdict, Result, session

**Command Execution Record**:
A typed Runtime Observation record for one Kernel-runner request, binding the
admitted argv and repository-relative cwd to its outcome, bounded output
digest, and executed environment-policy identity.
_Avoid_: Permission event, shell transcript, command Evidence

**Evidence**:
Provenance-linked, digest-bound information from an Artifact that supports a
claim or verification judgment.
_Avoid_: Claim, verdict, unreferenced assertion

**Authority**:
The product's umbrella term for a bounded right to decide, execute, or publish.
_Avoid_: Permission prompt, model confidence

**Decision Authority**:
The right to determine admitted request direction or accept a Material
Decision.
_Avoid_: Execution Authority, Publication Authority

**Execution Authority**:
The effective capability envelope within which a Task may execute.
_Avoid_: Decision Authority, Publication Authority

**Capability**:
A named action class included in a Task's Execution Authority.
_Avoid_: Execution Authority, Permission, command admission

**Permission**:
An adapter or runtime enforcement rule, prompt, or observed request; it never
grants Authority.
_Avoid_: Capability, Execution Authority, approval

**Command Admission**:
The Kernel decision that one exact argv and repository-relative working
directory may run through the Kernel-owned runner.
_Avoid_: Permission prompt, command request, shell access

**Publication Authority**:
The Kernel's exclusive right to mutate Run State and publish authoritative
Artifacts.
_Avoid_: Decision Authority, Execution Authority

**Preset**:
A versioned default policy for a class of request, selected before graph
compilation.
_Avoid_: Run Policy, Packet, workflow

**Run Policy**:
The effective policy admitted for one Run from a selected Preset and any
admitted narrowing override.
_Avoid_: Preset, Packet, capability envelope

**Outcome Record**:
A Kernel-published Run checkpoint of one kind: Receipt, Material Decision
Request, or Typed Block.
_Avoid_: Result, status message, worker report

**Receipt**:
The successful Outcome Record that closes a Run and links its request,
decisions, work, Evidence, verification, and known limitations.
_Avoid_: Summary, completion message, worker report

**Material Decision Request**:
An Outcome Record asking the human to exercise unresolved Decision Authority.
_Avoid_: Approval gate, assumption, Typed Block

**Typed Block**:
An Outcome Record stating a structured reason a Run cannot progress
automatically and may later resume.
_Avoid_: Failure message, cancellation, Material Decision Request

**Run State**:
The Kernel-owned, versioned mutable projection of one Run.
_Avoid_: Task State, Runtime Binding State, UI Status

**Run Lifecycle State**:
The current lifecycle position recorded in a Run State.
_Avoid_: Task State, Runtime Exit Reason, Status

**Task State**:
The Kernel-admitted lifecycle position of a graph Task.
_Avoid_: Run Lifecycle State, Runtime Exit Reason, Runtime Binding State

**Terminal Attempt State**:
An Attempt Lifecycle State after which that Attempt cannot continue. A
successor Attempt may still be admitted for its nonterminal Task.
_Avoid_: Terminal Task State, Runtime Exit Reason

**Terminal Task State**:
A Task State after which the Kernel cannot admit another Attempt for that Task.
_Avoid_: Terminal Attempt State, Terminal Run Lifecycle State

**Terminal Run Lifecycle State**:
The final Run Lifecycle State: `completed` after Receipt admission or
`cancelled` after confirmed cancellation.
_Avoid_: Terminal Task State, Runtime Exit Reason

**Terminal Artifact**:
The authoritative Artifact required as the output of a Workflow Definition.
_Avoid_: Runtime exit, worker prose, Task State

**Runtime Exit Reason**:
The adapter-observed reason an Attempt returned; it does not by itself prove a
Task State or completion. The Kernel reconciles `cancelled` to a confirmed
cancellation only after it verifies that the runtime stopped;
`cancel_unconfirmed` leaves the Attempt unresolved.
_Avoid_: Task State, Run Lifecycle State, task state reason

**Runtime Binding State**:
The reconciled current state of an Attempt's runtime binding.
_Avoid_: Run State, Task State, Runtime Exit Reason

**Status**:
A UI-derived display, never an authoritative protocol field.
_Avoid_: Run Lifecycle State, Task State, disposition, outcome kind

**Verification**:
An independent Workflow Instance that evaluates an Output Snapshot against its
relevant contract.
_Avoid_: Review, worker self-check, Result

**Verifier**:
The independent role that performs Verification and proposes a Review.
_Avoid_: Worker, Kernel, reviewer comment

**Review**:
A Verifier-authored Artifact evaluating one Result and Output Snapshot.
_Avoid_: Verification, Verdict, Finding

**Verdict**:
A Review's proposed conclusion: pass, finding, or block.
_Avoid_: Review, Finding, Receipt

**Finding**:
An immutable, identified defect in a Review that may bind one focused Repair.
_Avoid_: Verdict, repair, mutable issue status

**Material Decision**:
A choice not already determined by the admitted request or repository policy
that changes the objective, scope, exclusions, user-observable contract, a
durable cross-cutting structure or operational dependency, or authority for an
irreversible external effect.
_Avoid_: Approval step, routine confirmation

**Assumption**:
A recorded, local, reversible choice that preserves the admitted contract and
allows a Run to continue without human authority.
_Avoid_: Material decision, silent guess, approval

**External Read Target**:
One canonical HTTP(S) URL that an inspect Run may read without credentials and
whose agent-visible content is preserved as immutable runtime evidence.
_Avoid_: Network access, allowed host, source root
