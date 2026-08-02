# Task graph

The graph is a small scheduling projection over accepted work. It is not a
copy of packets, runtime sessions, reviews, or the complete run state.

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

One node is one bounded workflow instance. Its scheduling fields are:

- kernel-assigned `task_id`;
- `workflow`;
- immutable `packet_ref`;
- `requires` task ids;
- declared `read_resources` and `write_resources`.

Skill composition, acceptance criteria, capabilities, and expected outputs
belong to the packet. Runtime identities belong to run dispatch records.
Results and findings belong to their task artifacts.

## Dependency semantics

`requires` is the only v1 edge. A node is ready when every required task has
published its authoritative workflow artifact. The consuming packet references
the exact artifact and digest it needs. Acceptance of a result is a
separate review relation, not an implicit requirement-edge condition. Fan-out
and fan-in require no additional edge type.

Other relationships remain artifact references:

- a verification packet identifies the authoritative result artifact for its
  target task and the exact output snapshot;
- a repair packet identifies the containing review, the immutable finding
  within it, and the output snapshot on which the finding was made;
- a consuming packet identifies its input artifacts;
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

## Task lifecycle

The kernel owns one role-neutral execution lifecycle:

~~~text
planned -> dispatched -> running -> artifacts_published
        -> runtime_failed | blocked | cancelled | superseded
~~~

`artifacts_published` and every state on the second line are terminal for that
execution. Readiness is derived, not persisted. Result acceptance and the
need for repair are derived evaluations of admitted review artifacts, not
states recursively applied to verifier nodes. A verifier that publishes a
finding completed its verification workflow while preventing receipt creation.

A repair is a new worker-role task with workflow `repair` and normally a new
graph revision. It links to one immutable finding and produces a new output
snapshot. Run completion requires
an admitted verifier pass over the current unchanged output snapshot and every
receipt-required exit condition.

## LLM proposal admission

The baseline uses three model proposal kinds:

1. request contract proposal;
2. graph revision proposal, including proposed packets;
3. review proposal.

The kernel assigns durable ids and admits proposals only after schema,
reference, graph, capability, budget, and proposer-role validation. A repair
is another graph revision proposal triggered by an admitted finding. Agent
assignment is runtime policy, not model authority.

Graph databases, hierarchical subgraphs, edge taxonomies, automatic
transitive invalidation, in-place retry, arbitrary fork, and concurrent
scheduler policy are explicitly deferred.
