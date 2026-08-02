# File protocol

Files are the complete inter-agent protocol. They allow deterministic
admission, resume, review, and replay without private chat history. OpenCode
session state is referenced evidence, never a second source of workflow truth.

## Durable layout

Repository knowledge remains versioned in the checkout:

~~~text
AGENTS.md
docs/design/
decisions/
~~~

Mutable run state lives at a configured root outside the checkout:

~~~text
runs/<run-id>/
  run.json
  artifacts/
    request.json
    decisions/<decision-id>/<sequence>.json
    graphs/0001.json
    runtime/<attempt-id>.json
    tasks/<task-id>/attempts/1/
      packet.json
      result.json
      review.json
    promotions/<promotion-id>.json
    outcomes/<sequence>.json
  staging/<actor-id>/
~~~

`run.json` is the only mutable authoritative file. It is a kernel-owned,
atomically replaced projection containing the state version, active graph,
task states, runtime bindings, effective preset and budgets, and an ordered
transition log. Every other authoritative artifact is immutable. Prose notes
may be referenced, but authority-bearing fields remain in validated JSON.

The state root is configuration, never a developer-home path embedded in
product logic. The protocol schema is
[`schemas/protocol-v1.schema.json`](schemas/protocol-v1.schema.json).

## Shared envelope and references

Every immutable artifact contains:

- `schema_version`, `kind`, stable artifact id, and run id;
- relevant graph, task, attempt, and parent references;
- producer role and runtime identity where applicable;
- ordered input references with content digests;
- creation metadata.

Timestamps are audit data, never ordering authority. Ordering comes from the
kernel state version, graph revision, and transition sequence. Artifact
references are run-root-relative, cannot traverse outside the run, and resolve
to an exact artifact id and digest. Repository references instead contain a
recorded repository snapshot, repository-relative path, and content digest.

## Artifact contracts

- Request: objective, scope, exclusions, ambiguities, recorded assumptions,
  target snapshot, and proposed preset.
- Decision: a Material Decision's status, rationale, authority source, scope,
  and any superseded decision record. A status change is an immutable
  successor. Only a recorded human event may accept a Material Decision;
  policy-authorized local reversible choices remain request assumptions or
  task rationale and never create routine approval gates. An accepted
  decision's authority reference identifies the corresponding Material
  Decision request or the explicit request contract that already supplied the
  choice.
- Graph: immutable revision, parent and trigger references, bounded nodes,
  `requires` dependencies, and scheduling resource sets. Execution state is
  not copied into graph files.
- Packet: role, workflow, objective, acceptance criteria, allowed and forbidden
  resources, selected inputs, skills, capability envelope, deadline, and
  escalation condition. Commands are exact argv arrays with a
  repository-relative working directory; shell strings are invalid. A
  verification packet has verifier role and carries `target_task_ref` and
  `target_snapshot`; the compatibility-named `target_task_ref` resolves to the
  target task's authoritative result artifact, whose task id the kernel checks.
  A repair packet has worker role and carries `finding_ref`, `finding_id`, and
  `target_snapshot`; `finding_ref` resolves to the containing review and
  `finding_id` selects its immutable finding. An `inspect@1` Research packet
  with `network` carries one or more exact `external_read_targets`; no other v1
  packet may carry them.
- Runtime observation: adapter-observed OpenCode identity, events, complete
  workspace diff, canonical output snapshot, External Read observations, and
  exit reason for one attempt. Each successful External Read preserves the
  declared target id, requested URL, message id, exact agent-visible content,
  and its digest. Failed or denied reads preserve a typed error instead.
- Result: worker claims, evidence with provenance, claimed output snapshot,
  changed resources, and its exact runtime-observation reference.
- Review: target task and exact output snapshot, verifier identity, verdict,
  evidence, focused findings, and its exact runtime-observation reference.
- Promotion: verified isolated snapshot, harness-owned Git result ref, expected
  and promoted ref object ids, and the equal promoted tree snapshot. It
  preserves a Verified Result; it does not represent application to a
  user-designated target.
- Outcome record: exactly one of receipt, Material Decision request, or typed block.
  A receipt links the accepted request, decisions, graph, tasks, runtime
  bindings, effective policy, current output snapshot, required promotion,
  verification, and known limitations. Resuming appends a new outcome record;
  it never overwrites an earlier request or block.

A receipt moves the run to `completed`. A Material Decision request and typed
block are resumable checkpoint records corresponding to
`material_decision_required` and `blocked`; they are not terminal outcomes.
Confirmed cancellation is recorded by the `run.json` status and transition log
without another outcome-artifact kind.

For `local-change@1`, the receipt must reference a promotion and repeat its
verified and delivered tree digests. The kernel admits the receipt only when
the review target, promotion's verified tree, promotion's delivered tree, and
receipt snapshots are identical.

At receipt admission, `accepted_snapshot` is the kernel-current canonical
repository snapshot. For `inspect@1`, it equals the input target snapshot and
the independently verified report is linked through artifact references. For
`local-change@1`, `accepted_snapshot`, `verified_snapshot`, and
`delivered_snapshot` are equal.

The compatibility fields `delivered_ref_oid` and `delivered_snapshot` identify
the object and tree digest stored at the harness-owned result ref.
`applied_resources` identifies paths materialized in that result snapshot, not
paths applied to a user-designated target. The receipt exposes the exact
location through `promotion_ref` to `promotion.result_ref`. Product prose and
operator output call the outcome a Verified Result to avoid implying an
Applied Result.

## Ownership and publication

| Actor | May author | May publish authoritatively |
| --- | --- | --- |
| Human | Request and material-decision response | Through a recorded kernel event |
| Planner | Request, graph, and packet proposals in its unique staging area | No |
| Worker | Result proposal in its unique staging area | No |
| Verifier | Review proposal in its unique staging area | No |
| OpenCode adapter | Runtime observation returned to the kernel | No |
| Kernel | Admission, transition, graph, dispatch, outcome, and validated artifact records | Yes |

Publication is worker-authored and kernel-published. A model or runtime process
never writes the authoritative store directly. The kernel validates actor
ownership, schema, references, observed diff, current state version, output
snapshot, and capability compliance, then prepares immutable records before
atomically replacing `run.json`. The `run.json` replacement is the sole commit
point. Prepared but unreferenced records remain non-authoritative and are
reconciled or discarded on resume.

Malformed, missing, conflicting, stale, out-of-scope, or post-verification
modified artifacts are validation outcomes, not parallel mutable state
machines. They produce a typed rejection, focused successor proposal, or block.
Completed artifacts are never repaired in place. Finding closure is expressed
by a successor repair and review referencing the original finding; the finding
inside its original review never changes status.

For external evidence, `evidence.source` uses
`external-read:<target-id>`. The Kernel admits it only when the Result's exact
runtime observation contains a successful matching read, the requested URL
matches the packet target, and the digest recomputed from the preserved content
matches. The verifier reviews that immutable content and does not refetch the
live URL. The artifact records a point-in-time observation, not a claim that the
external page remains current.

## Replay and resume

Resume performs the following minimum algorithm:

1. Load and validate `run.json` and its state version.
2. Resolve the supported protocol version.
3. If a graph has been admitted, follow the active graph and referenced
   immutable artifacts, validating ids and digests.
4. Reconcile active dispatch records with OpenCode runtime observations.
5. Derive completed, stale, blocked, and ready work from the one kernel-owned
   task lifecycle.
6. Rebuild only the context required for the next admitted action.
7. Preserve every prior artifact when creating a successor attempt, repair, or
   graph revision.

If `run.json` is absent or invalid, the run is not reconstructed by guessing
from model conversation. Unsupported schema versions fail closed. Migration is
deferred until a second protocol version exists.

## Brownfield baseline

Intake records the target Git revision, repository instructions, effective
OpenCode configuration identity, existing dirty and untracked paths, available
knowledge sources, and contradictions or uncertainty. Existing changes are
protected by default. A local-change task may include one only when the request
and packet make that inclusion explicit; unrelated changes remain outside its
write resources and are checked against the post-attempt snapshot.

The baseline does not silently initialize dependencies, rewrite configuration,
discard local changes, or treat discovered documentation as accepted product
direction.
