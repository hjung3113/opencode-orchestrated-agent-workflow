# Task graph

The graph is a small scheduling projection over accepted work. It is not a
copy of Packets, runtime sessions, Reviews, or the complete Run State.

## Scope and revisions

One run owns an immutable sequence of graph revisions. A revision has a stable
number, an optional parent revision, and the artifact that triggered the
change. Replanning publishes a new revision; it never edits an accepted one.
Completed valid tasks are carried forward by reference. A correction creates
a successor task and records why the predecessor was retained, superseded, or
made stale.

Revision 1 has no parent. Every later revision increments by exactly one and
must reference the currently active predecessor; branches or skipped revision
numbers are rejected.

One Task is one graph node that schedules one bounded Workflow Instance. A
Packet is that instance's execution contract; an Attempt is one runtime
execution of the Task. A Task's scheduling fields are:

- kernel-assigned `task_id`;
- `workflow_definition`;
- immutable `packet_ref`;
- `requires` task ids;
- declared `read_resources` and `write_resources`.

Skill composition, acceptance criteria, capabilities, and expected outputs
belong to the packet. Runtime identities belong to run dispatch records.
Result artifacts and findings belong to their task artifacts.

External Read Targets are packet capability constraints, not scheduling
resources. They do not create graph edges or participate in repository
read/write overlap checks.

## Dependency semantics

`requires` is the only v1 edge. A node is ready when every required task has
published its authoritative workflow artifact. The consuming packet references
the exact artifact and digest it needs. Acceptance of a Result is a
separate review relation, not an implicit requirement-edge condition. Fan-out
and fan-in require no additional edge type.

Other relationships remain artifact references:

- a verification packet identifies the authoritative Result artifact for its
  target task and the exact output snapshot;
- a repair packet identifies the containing review, the immutable finding
  within it, and the output snapshot on which the finding was made;
- a consuming packet identifies its input artifacts;
- a Replan Request identifies the source Task and Attempt, recommended
  Workflow Definition, Evidence, and required capability; a successor revision
  may cite it as `trigger_ref` only after Kernel admission;
- a revision record identifies artifacts invalidated by new evidence.

This keeps scheduling separate from provenance.

## Validation and scheduling

Before a graph revision is admitted, the kernel rejects:

- cycles, missing task or packet references, and duplicate task ids;
- resource declarations outside the packet envelope;
- unordered tasks with overlapping write resources;
- a verifier whose target or output snapshot is absent;
- removal or replacement of completed work without a trigger and rationale.

V1 resources are normalized repository-relative exact file paths. Directory,
glob, absolute, traversal, and symlink-resolved-outside-root declarations are
rejected. Two resources overlap only when their normalized exact paths are
equal. Richer logical or directory resources are deferred.

The kernel can validate those structural claims. Usefulness, semantic conflict,
and whether acceptance criteria are persuasive remain bounded model judgments
unless the repository supplies a machine-decidable rule.

The baseline sets `max_concurrency` to `1`. Ready nodes are dispatched in
kernel-assigned stable order. Failure blocks descendants whose requirements
are unsatisfied, not unrelated work. Parallel dispatch, resource locks,
fairness, priorities, and inferred semantic resources require a demonstrated
trace before admission to the product.

## Attempt lifecycle

The Kernel records one role-neutral Attempt Lifecycle State lifecycle:

~~~text
dispatched -> running -> artifacts_published
           -> runtime_failed | blocked | confirmed_cancelled | superseded
~~~

`artifacts_published`, `runtime_failed`, `blocked`, `confirmed_cancelled`, and
`superseded` are Terminal Attempt States. `cancel_unconfirmed` is only a
Runtime Exit Reason: the Attempt remains unresolved until reconciliation.
The Kernel evaluates `idle` with the staged artifacts and may derive either
`artifacts_published` or `runtime_failed`; no Runtime Exit Reason maps directly
to a Task State.
`runtime_failed` never directly produces a Terminal Task State; the Kernel either
admits a policy-bounded successor Attempt or closes the Task as `blocked`.

The Task State lifecycle is:

~~~text
planned -> active -> artifacts_published | blocked | cancelled | superseded
~~~

`artifacts_published`, `cancelled`, and `superseded` are Terminal Task States.
`blocked` is a Terminal Task State only when the Kernel closes the Task against
further Attempts. Readiness is derived, not persisted. Result-artifact
acceptance and the need for Repair are derived evaluations of admitted Review
Artifacts, not states recursively applied to Verifier nodes. A Verifier that
publishes a Finding completed its Verification Workflow Instance while
preventing Receipt creation.

A Repair is a new worker-role Task with Workflow Definition `repair` and normally a new
graph revision. It links to one immutable Finding and produces a new Output
Snapshot. Run completion requires
an admitted Verifier pass over the current unchanged Output Snapshot and every
receipt-required exit condition.

## LLM proposal admission

The baseline uses three model proposal kinds:

1. request contract proposal;
2. graph revision proposal, including proposed packets;
3. Review proposal.

The first Request proposal is produced by a pre-intake planner Attempt under a
Kernel-owned Bootstrap Planner Envelope, before any graph Task or Task Packet
exists. Later planner Attempts propose graph revisions and Packets; those
planner Attempts are still not Task Attempts.

The kernel assigns durable ids and admits proposals only after schema,
reference, graph, capability, budget, and proposer-role validation. A Repair
is another graph revision proposal triggered by an admitted Finding. Agent
assignment is runtime policy, not model authority.

Graph databases, hierarchical subgraphs, edge taxonomies, automatic
transitive invalidation, in-place retry, arbitrary fork, and concurrent
scheduler policy are explicitly deferred.
