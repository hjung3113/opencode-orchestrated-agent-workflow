# File protocol

Files are the complete inter-agent protocol. They allow deterministic
admission, resume, review, and replay without private chat history. OpenCode
session history is referenced evidence, never a second source of workflow truth.

## Durable layout

Repository knowledge remains versioned in the checkout:

~~~text
AGENTS.md
docs/design/
decisions/
~~~

Mutable Run State lives at a configured root outside the checkout:

~~~text
runs/<run-id>/
  run.json
  artifacts/
    bootstrap/<attempt-id>.json
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

`run.json` is the only mutable authoritative file. It is the kernel-owned,
atomically replaced Run State containing `state_version`, `lifecycle_state`,
the bootstrap envelope reference, idempotency key, active graph, Task States,
Runtime Binding States, effective Run Policy and budgets, and an ordered
transition log. A newly created Run is `pre_intake`: it has the bootstrap
binding and planner budget but no `request_ref` or `effective_policy`. Request
admission exits `pre_intake` and records those references atomically. Every
other authoritative Artifact is immutable. Prose notes may be referenced, but
authority-bearing fields remain in validated JSON.

The Run-State root is configuration, never a developer-home path embedded in
product logic. The protocol schema is
[`schemas/protocol-v1.schema.json`](schemas/protocol-v1.schema.json).

## Shared envelope and references

Every immutable artifact contains:

- `schema_version`, `kind`, stable artifact id, and run id;
- relevant graph, task, attempt, and parent references;
- producer role and runtime identity where applicable;
- ordered input references with content digests;
- creation metadata.

An Artifact is the immutable storage unit. Evidence is provenance-linked,
digest-bound information from an Artifact that supports a claim or verification
judgment; not every Artifact is evidence. A Runtime Observation is the
adapter-authored Artifact for observed runtime facts, not a task verdict.

Timestamps are audit data, never ordering authority. Ordering comes from the
Run State version, graph revision, and transition sequence. Artifact
references are run-root-relative, cannot traverse outside the run, and resolve
to an exact artifact id and digest. Repository references instead contain a
recorded repository snapshot, repository-relative path, and content digest.

## Artifact contracts

- Request: objective, scope, exclusions, ambiguities, recorded assumptions,
  target snapshot, and structured `preset_selection`.
- Bootstrap Planner Envelope: a Kernel-authored, file-backed Intake execution
  contract derived from the raw human request, repository policy, fixed Intake
  workflow, bounded capabilities, deadline, and idempotency key. It carries a
  Runtime Observation reference and never claims a Task Packet.
- Decision: a Material Decision's `disposition`, rationale, Decision Authority
  source, scope, and any superseded decision record. A disposition change is an immutable
  successor. Only a recorded human event may accept a Material Decision;
  policy-authorized local reversible choices remain request assumptions or
  task rationale and never create routine approval gates. An accepted
  decision's authority reference identifies the corresponding Material
  Decision request or the explicit request contract that already supplied the
  choice.
- Graph: immutable revision, parent and trigger references, bounded nodes,
  `requires` dependencies, and scheduling resource sets. Task State is
  not copied into graph files.
- Packet: role, `workflow_definition`, objective, acceptance criteria, allowed and forbidden
  resources, selected inputs, skills, Execution Authority, deadline, and
  escalation condition for one Task's Workflow Instance. `admitted_commands`
  are exact argv arrays with a repository-relative working directory; shell
  strings are invalid. A pre-intake planner Attempt uses the Bootstrap Planner
  Envelope instead of a Packet. A verification packet has verifier role and
  carries `target_task_ref` and
  `target_snapshot`; the compatibility-named `target_task_ref` resolves to the
  target task's authoritative result artifact, whose task id the kernel checks.
  A repair packet has worker role and carries `finding_ref`, `finding_id`, and
  `target_snapshot`; `finding_ref` resolves to the containing review and
  `finding_id` selects its immutable finding. An `inspect@1` Research packet
  with `network` carries one or more exact `external_read_targets` and no
  `admitted_commands`; no other v1 packet may carry them.
- Runtime Observation: adapter-observed OpenCode identity, events, complete
  workspace diff, canonical Output Snapshot, typed command-execution records,
  External Read observations, and Runtime Exit Reason for one Attempt. Each
  successful External Read preserves the declared target id, requested URL,
  message id, exact agent-visible content, and its digest. Failed or denied
  reads preserve a typed error instead. Command Evidence cites a command
  execution by its exact Runtime Observation reference, command id, and
  output digest; a permission-event string cannot serve as command Evidence.
- Result: worker claims, evidence with provenance, claimed output snapshot,
  changed resources, and its exact runtime-observation reference.
- Review: a Verifier-authored Artifact for one target Task and exact Output
  Snapshot, containing the Verifier identity, Verdict, Evidence, focused
  Findings, and its exact Runtime Observation reference.
- Promotion: the Kernel's compare-and-swap preservation of a verified isolated
  snapshot at a harness-owned Result Ref, with expected and promoted ref object
  ids and the equal promoted tree snapshot. It preserves a Verified Result; it
  is never Application to a user-designated target.
- Outcome Record: a Kernel-published checkpoint of one kind: Receipt, Material
  Decision Request, or Typed Block. A Receipt links the accepted request,
  decisions, graph, Tasks, Runtime Binding States, the schema-valid effective
  Run Policy (including `preset_selection_ref`, defaults, narrowing,
  deviations, and rationale), current Output Snapshot, required Promotion,
  verification, and known limitations. The Receipt repeats that policy object
  so its linkage is resolvable from durable files.
  Resuming appends a new Outcome Record;
  it never overwrites an earlier request or block.

A Receipt moves the Run to `completed`. A Material Decision Request and Typed
Block are resumable checkpoint records corresponding to
`material_decision_required` and `blocked`; neither completes the Run.
Confirmed cancellation is recorded by `run.json` `lifecycle_state` and its transition log
without another Outcome Record kind.

For `local-change@1`, the Receipt must reference a Promotion and repeat its
verified and promoted tree digests. The Kernel admits the Receipt only when the
Review target, Promotion's verified tree, Promotion's promoted tree, and
Receipt snapshots are identical.

At receipt admission, `accepted_snapshot` is the kernel-current canonical
repository snapshot. For `inspect@1`, it equals the input target snapshot and
the independently verified report is linked through artifact references. For
`local-change@1`, `accepted_snapshot`, `verified_snapshot`, and
`promoted_snapshot` are equal.

`promoted_ref_oid` and `promoted_snapshot` identify the object and tree digest
stored at the harness-owned Result Ref. `promoted_resources` identifies paths
materialized in that promoted snapshot. The Receipt exposes the exact location
through `promotion_ref` to `promotion.result_ref`. Product prose and operator
output call the outcome a Verified Result to avoid implying an Applied Result.

## Ownership and publication

| Actor | May author | May exercise Publication Authority |
| --- | --- | --- |
| Human | Request and material-decision response | Through a recorded kernel event |
| Planner | Request, graph, and packet proposals in its unique staging area | No |
| Worker | Result proposal in its unique staging area | No |
| Verifier | Review proposal in its unique staging area | No |
| OpenCode adapter | Runtime observation returned to the kernel | No |
| Kernel | Admission, transition, graph, dispatch, Outcome Record, and validated Artifact records | Yes |

Publication is worker-authored and kernel-published. A model or runtime process
never writes the authoritative store directly. The kernel validates actor
ownership, schema, references, observed diff, current Run State version, output
snapshot, and capability compliance, then prepares immutable records before
atomically replacing `run.json`. The `run.json` replacement is the sole commit
point. Prepared but unreferenced records remain non-authoritative and are
reconciled or discarded on resume.

Malformed, missing, conflicting, stale, out-of-scope, or post-verification
modified Artifacts are validation outcomes, not parallel mutable Run State
machines. They produce a typed rejection, focused successor proposal, or block.
Completed Artifacts are never repaired in place. Finding closure is expressed
by a successor Repair and Review referencing the original Finding; the Finding
inside its original Review never changes.

For external evidence, `evidence.source` uses
`external-read:<target-id>`. The Kernel admits it only when the Result's exact
runtime observation contains a successful matching read, the requested URL
matches the packet target, and the digest recomputed from the preserved content
matches. For command evidence, `evidence.source` uses
`command:<command-id>` and `command_ref` carries the matching Runtime
Observation reference and frozen output digest. The verifier reviews those
immutable observations and does not refetch live sources. The artifact records
a point-in-time observation, not a claim that an external page remains current.

## Replay and resume

Resume performs the following minimum algorithm:

1. Load and validate `run.json` and its Run State version.
2. Resolve the supported protocol version.
3. If a graph has been admitted, follow the active graph and referenced
   immutable artifacts, validating ids and digests.
4. Reconcile active dispatch records with OpenCode runtime observations.
5. Derive completed, stale, blocked, and ready work from the one kernel-owned
   Task State lifecycle.
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
