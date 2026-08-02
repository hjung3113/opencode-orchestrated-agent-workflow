# Orchestrated Project Work

This context describes the durable outcomes and authority boundaries of turning
one human request into independently checked project work.

## Language

**Run**:
One orchestration of a human request, continuing across resumable checkpoints
until successful completion or confirmed cancellation.
_Avoid_: Job, conversation, session

**Verified Result**:
A project result whose current content has passed independent verification and
whose provenance and limitations are recorded in a receipt.
_Avoid_: Delivered result, applied result, completed change

**Applied Result**:
A Verified Result incorporated into a user-designated working destination such
as a branch, pull request, deployment, or other external target.
_Avoid_: Verified result, promoted result

**Receipt**:
The authoritative record linking a Run's request, decisions, work, evidence,
verification, outcome, and known limitations.
_Avoid_: Summary, completion message, worker report

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
