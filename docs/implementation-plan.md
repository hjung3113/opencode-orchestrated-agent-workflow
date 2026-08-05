# Implementation plan

## Status and authority

This is the active delivery sequence for the first executable product. It is
not product-design authority. If this plan conflicts with `AGENTS.md`, an
accepted ADR, `docs/design/`, or the protocol schema, those sources win and the
plan must be corrected.

The plan uses GitHub Issue #30 as a sequencing proposal and Issues #25 through
#29 as contract inputs. It intentionally changes parts of Issue #30's order
where the accepted design exposes an earlier risk or a narrower v1 boundary.

## Delivery objective

Deliver one compact interface that turns a human request into a file-backed,
independently verified result using real OpenCode execution. The first v1
release must prove both baseline policies:

- `local-change@1`: preserve an independently verified output snapshot at a
  harness-owned Git Result Ref without changing the user's branch or working
  tree;
- `inspect@1`: produce an independently verified cited report, optionally from
  declared exact external reads, without local writes or a Promotion.

Preparation artifacts, fixture-only execution, or an agent's completion claim
are not product completion.

## Changes from the issue sequence

Issue #30 provides the right overall direction—top-down invariants with
bottom-up vertical slices—but its phases are adjusted as follows.

1. Do not complete a generic deterministic kernel before touching OpenCode.
   Run a bounded runtime-risk probe first, then build only the kernel behaviour
   required by the first real request-to-receipt path. Fixture tests and the
   real adapter advance together inside one slice.
2. Move replay, resume, cancellation, and interrupted-publication recovery
   ahead of general multi-node graph work and concurrency. File-backed truth
   is a baseline product claim, so recovery cannot wait until a late phase.
3. Implement the two accepted v1 presets, not the larger candidate catalog in
   Issue #27 or Issue #30. Additional presets require observed policy
   differences from completed traces.
4. Keep `max_concurrency: 1` through v1. Sequential graph meaning and restart
   safety must be reproducible before parallel scheduling or resource locks are
   admitted.
5. Treat controlled concurrency and Application to a user branch, PR,
   deployment, or other external target as post-v1 work. V1 Promotion to a
   harness-owned Result Ref is not Application.
6. Land llm-wiki at M4c as one cited retrieval bound to the admitted Packet's
   `input_refs`. It is a v1 gate, but it must not become a second source of
   truth, a prerequisite framework, or a mandatory dependency for a Run whose
   bounded direct file context is sufficient.

## Dependency order

~~~text
M0 fail-closed runtime capability matrix
  -> M1 local-change walking skeleton
    -> M2 hostile recovery and operator controls
      -> M3 one finding-bound repair
        -> M4a repository-only inspect -> M4b exact external read
                                      \-> M4c bounded llm-wiki retrieval
        -> M5 sequential multi-node graph

M4a-M4c and M5 are independent branches after M3. Both branches gate v1.
M4a is the shared prerequisite for M4b and M4c; M4b and M4c are independent
of each other after M4a.

Post-v1 independent candidates: M6 controlled concurrency, M7 additional
presets, and M8 external Application.
~~~

M1 through M5 are product slices or extensions of an already executable slice.
M0 is a time-bounded risk-retirement activity with per-slice prerequisites. It
must not be reported as a product result, and an unsupported required capability
blocks its dependent slice rather than counting as a successful probe.

## Common completion contract

M0 has the capability-matrix gate defined in its own section. Every executable
product milestone from M1 onward must expose a black-box Given/When/Then
scenario through the operator interface available at that point and preserve
durable evidence under a temporary, configured run-state root outside the
source checkout. The narrowest useful test pyramid is:

1. schema, canonicalization, policy, state-transition, and idempotency tests;
2. fake-adapter integration tests for deterministic fault injection;
3. real OpenCode integration tests for every runtime behaviour claimed by the
   milestone;
4. black-box `run`, `inspect`, `cancel`, and `resume` tests once those commands
   are in scope.

An executable product milestone is not complete without:

- one successful end-to-end case;
- malformed or missing artifact rejection;
- invalid transition and stale-version rejection;
- relevant authority or capability violation coverage;
- crash-safe commit or rejection at every authoritative boundary introduced by
  that milestone;
- idempotent replay of repeated events at those boundaries;
- an independently produced verification result where an output is accepted;
- a receipt or typed checkpoint whose references and digests validate from
  files alone.

M2 and every later milestone additionally require process-death reconstruction,
runtime reconciliation, and repeated-`resume` idempotency. M1 does not claim
those M2 behaviours; it proves atomicity and duplicate-event handling only at
the boundaries it implements.

No test may repair authoritative run artifacts manually to make a scenario
pass. Real-runtime evidence is required before an adapter interface or policy
surface is generalized.

Each milestone must state a schema-valid budget for its normative successful
trace: worker/verifier Attempts, planner Attempts, graph revisions, and repairs
per finding. Failure, successor-Attempt, and recovery cases may use separate
Runs but must remain inside the same v1 limits. A milestone that cannot fit
within four worker/verifier Attempts, five planner Attempts, four graph
revisions, and one repair per finding must narrow its trace or name the
required protocol change; it must not silently exceed the schema.

## M0 — retire OpenCode runtime uncertainty

### Outcome

Produce a fail-closed compatibility matrix against the supported OpenCode
version. Each matrix row names the product slice it gates, the observation or
enforcement that must succeed, and the typed incompatibility when it does not.

### Work

- Build the smallest executable probe around the runtime seam in Issue #25.
- Record the OpenCode version, resolved-configuration digest, session/message
  ids, agent identity, runtime events, and exit reason.
- Demonstrate fresh planner, worker, and verifier profiles and distinct worker
  and verifier identities.
- Demonstrate that one declared repository skill is resolved with its id,
  version, source, and digest while an undeclared or unavailable skill fails
  preflight.
- Exercise idle, runtime failure, deadline with confirmed runtime stop,
  confirmed cancellation, and one unsupported-enforcement path.
- Capture unsupported or unobservable behaviour as a typed compatibility
  result instead of hiding it behind mocks.

The matrix has two prerequisite groups:

| Gates | Required successful observations and enforcement |
| --- | --- |
| M1 | Fresh planner, worker, and verifier sessions; role and model identity; resolved-configuration digest and undeclared-configuration rejection; declared skill identity and unavailable-skill rejection; session/message/terminal events; idle and runtime-failure observations; runtime abort and confirmed stop on deadline; complete workspace diff and canonical Output Snapshot; capability narrowing; denied Task delegation, general model-session shell, network, and external mutation; exact admitted-command mediation. |
| M2 | Operator-requested confirmed cancellation and `cancel_unconfirmed` reconciliation; reconnect-or-observe behaviour needed by `resume`. |
| M4b | Exact canonical URL restriction for `webfetch`; correlation of target, message, and exact bounded agent-visible content; denial of undeclared URLs, search, browser, MCP, plugin, shell, credentials, and other network paths. |

### Exit evidence

- An automated real-runtime test can repeat the probe in a disposable fixture
  repository.
- Every M1 matrix row passes before M1 implementation begins.
- Every M2 matrix row passes before M2 implementation begins; it does not
  block M1.
- Every M4b matrix row passes before M4b implementation begins; it need not
  block M1 through M3.
- An unsupported required row blocks the dependent slice and produces a typed
  compatibility result and focused design correction. M0 is not a Run and
  does not emit a product Typed Block. Recording the incompatibility is
  evidence, not successful completion of that prerequisite.

### Contract mapping

Issues #25, #28, and #29: runtime observation, actor identity, capability
preflight, deterministic failure, and file-backed evidence.

## M1 — first real `local-change@1` walking skeleton

### Observable scenario

Given one bounded natural-language local-change request and a repository with a
protected unrelated dirty file, when the harness runs, then a fresh real
OpenCode planner proposes the smallest request contract, Run Policy, graph, and
packet; the kernel admits them; a real OpenCode worker publishes a validated
Result and Output Snapshot; a fresh independent verifier reviews it; and the
kernel promotes the unchanged verified snapshot to a harness-owned Result Ref
and emits a Receipt without modifying the user's branch or working tree.

### Work

- Implement only the proposal types needed by this path: request contract,
  graph revisions with packets, and Review. A first planner Attempt proposes
  the Request. Only after the Kernel admits that Request and assigns its stable
  reference does a second fresh planner Attempt propose revision 1 and its
  implementation Packet, using the admitted Request as `trigger_ref`. After
  the implementation Result is admitted, a third fresh planner Attempt
  proposes revision 2 with `parent_revision_ref`, the Result as `trigger_ref`,
  the completed implementation Task carried forward by reference, and one
  verifier Task targeting that Result and Output Snapshot. This ordering is
  proposal/admission sequencing, not model-output determinism.
- Correct the runtime seam before dispatching the first planner. A planner
  Attempt that precedes every graph and Task runs under a Kernel-owned,
  file-backed bootstrap execution envelope derived from the raw human request,
  repository policy, fixed Intake workflow, and bounded capabilities; it does
  not claim a Task Packet. Add the protocol representation and Runtime
  Observation reference for that envelope. Add a pre-intake Run Lifecycle State
  in which `request_ref` and `effective_policy` are not yet present, so
  `run.json` can atomically record the bootstrap runtime binding, idempotency,
  and planner budget before dispatch; admitting the Request and Run Policy
  exits that state. Correct `opencode-runtime.md`'s unconditional
  Packet-reference wording. Worker and verifier Attempts remain Packet-bound.
- Publish each planner proposal only with its own planner Runtime Observation;
  fake planner proposals remain test fixtures only.
- Implement the kernel's event admission, expected-state-version check,
  idempotency key, typed policy result, and atomic `run.json` commit point.
- Validate the existing v1 schema and exact artifact references; publish
  immutable artifacts through actor-specific staging areas.
- Resolve every Packet-declared skill from repository-visible authority,
  verify its id, version, source, and digest, reject undeclared developer-home
  dependencies, and emit `dependency_unavailable` when a selected skill cannot
  load. As part of the M1 protocol correction, make the skill digest required
  in `$defs.skill`; a schema-valid Packet may not omit it.
- Implement exact `admitted_commands` admission and a Kernel-owned runner that
  executes only the admitted argv and relative cwd in the isolated Task
  workspace with credentials removed and outbound network denied. General
  model-session shell remains unavailable.
- Add a typed command-execution record to the Runtime Observation for every
  runner request, including command id, admitted argv and cwd, outcome or exit
  code, bounded output digest, and the executed environment-policy identity.
  Define the matching digest-bound Evidence source rule so Results and Reviews
  can cite frozen command output; untyped permission-event strings are not
  command Evidence.
- Before the first Run is admitted, close the protocol representability gap
  for preset-selection evidence, preset defaults, proposed and admitted
  narrowing overrides, deviations, and rationale required by `workflows.md`.
  Make their structured Run/Receipt linkage schema-valid or correct the
  upstream contract; do not hide rationale in an untyped summary or claim a
  field that the schema rejects.
- Support one implementation task followed by one verification task with
  `max_concurrency: 1` and no repair.
- Translate the admitted packet into the runtime profile proven in M0.
- Abort an Attempt at its Packet or bootstrap-envelope deadline, confirm the
  runtime stopped before observing or publishing its workspace state, and
  record a typed failure when the stop cannot be confirmed.
- Compare the complete observed diff with exact declared resources and protect
  pre-existing unrelated changes.
- Implement independent review admission, post-review snapshot equality,
  compare-and-swap Promotion, and Receipt admission.
- Expose `run` and `inspect` with derived status; keep internal component
  boundaries as small as this path permits.

### Adversarial cases

- worker becomes idle without a Result;
- malformed Result or digest/reference mismatch;
- undeclared path change or command request;
- worker and verifier identity collision;
- output changes after a passing Review;
- Result Ref drifts before Promotion;
- duplicate event delivery and stale Run State version;
- deadline expiry with confirmed and unconfirmed runtime stop.

### Exit evidence

- One real OpenCode request-to-Receipt trace validates from an empty run-state
  directory and includes planner, worker, and verifier Runtime Observations.
- A later process reconstructs the outcome and exact Result Ref from files
  without OpenCode conversation history.
- The Receipt provenance walk resolves the planner identity and every admitted
  Request, Graph, and Packet runtime reference.
- The successful trace uses three planner Attempts and two planner-produced
  graph revisions and fits a declared schema-valid budget with no retry; retry
  and runtime-failure cases run separately inside the same limits.
- The Receipt provenance walk resolves the Kernel-owned bootstrap envelope and
  every typed command execution and output digest used as Evidence.
- Preset selection evidence, preset defaults, proposed and admitted narrowing
  overrides, deviations, and rationale resolve from the Run and Receipt files
  alone against the corrected schema.
- Deadline expiry cannot publish a snapshot until runtime stop is confirmed.
- The normative successful trace declares `{execution: 2, planner: 3,
  revisions: 2, repairs_per_finding: 0}`.
- Fake-adapter tests cover every adversarial case above, and real-runtime tests
  cover the behaviours that depend on OpenCode.

### Contract mapping

- #25: fresh sessions, preflight, runtime observation, operator state, and
  Promotion.
- #28: schemas, ownership, staging, atomic publication, immutable artifacts,
  and provenance.
- #29: proposal/admission separation, policy precedence, capabilities,
  budgets, and fail-closed transitions.
- #26: the minimum sequential graph revision and `requires` semantics.
- #27: admitted `local-change@1` Run Policy, not a broad preset registry.

## M2 — make the single-task path restart-safe

### Observable scenario

Given a run interrupted at any publication or runtime boundary, when `resume`
is invoked, then the harness validates durable state, reconciles the active
runtime binding and prepared records, performs at most one idempotent next
action, or returns a typed resumable checkpoint. `cancel` reports success only
after the runtime is confirmed stopped. Given a genuinely material ambiguity,
the same interface persists a Material Decision Request, records the human
response as an immutable accepted Decision successor, and resumes from it.

### Work

- Implement the normative replay algorithm from `file-protocol.md`.
- Reconcile prepared-but-unreferenced artifacts and the three Promotion CAS
  cases without guessing from chat or timestamps.
- Add `resume` and `cancel` to the operator interface.
- Preserve unresolved Attempts after `cancel_unconfirmed`; do not dispatch a
  successor into the same workspace.
- Enforce the accepted cumulative Run limits for execution Attempts, planner
  Attempts, graph revisions, and repairs, plus operator cancellation; budget
  exhaustion yields a Typed Block. Per-Attempt deadline abort and stop
  confirmation already belong to M1.
- Implement the bounded Material Decision round trip without treating model
  confidence as materiality. A local reversible ambiguity must instead become
  a recorded Assumption and continue automatically.

### Exit evidence

- Deterministic crash tests stop the process before and after artifact
  preparation, `run.json` replacement, runtime abort, and Result Ref update.
- Repeating `resume` produces no duplicate Artifact, transition, runtime
  dispatch, or Promotion.
- Invalid or unsupported `run.json` fails closed.
- A Material Decision Request survives process restart; exactly one recorded
  human response admits an immutable Decision successor and resumes the Run.
- A paired low-risk ambiguity trace proves that routine local choices do not
  become human gates.
- The normative successful recovery trace declares `{execution: 2, planner: 3,
  revisions: 2, repairs_per_finding: 0}`. Cancellation and other fault cases
  use separate bounded Runs.

### Contract mapping

Issues #25, #28, and #29: operator controls, runtime reconciliation, replay,
atomicity, idempotency, budgets, and typed blocks.

## M3 — one finding-bound repair and re-verification

### Observable scenario

Given a verifier Finding against the first worker snapshot, when the run
continues, then a new graph revision adds one focused Repair Task linked to the
immutable Finding, a fresh worker session produces a successor snapshot, and a
fresh verifier either passes that exact snapshot or the run ends in a Typed
Block after the bounded repair budget.

### Work

- Admit a Review with one stable Finding identity and fingerprint.
- Propose and validate a successor graph revision containing one Repair Task;
  never mutate the original Result, Review, or Finding.
- Reuse M1's general successor-revision and carry-forward mechanism; M3 adds
  only the repair-specific Finding linkage, fingerprint bound, and
  re-verification sequence.
- Carry forward still-valid completed work by reference. Set `trigger_ref` to
  the admitted Review containing the Finding; the parent/current graph delta
  and referenced Finding are the machine-validatable explanation, with no
  unrepresented free-form rationale field.
- Distinguish a successor Attempt from a new Repair Task in state and receipt
  provenance.
- Stop after one repair for the same finding fingerprint.

### Exit evidence

- The normative local-change trace in `docs/design/examples.md` passes with
  four or fewer worker/verifier execution Attempts and four or fewer graph
  revisions.
- Same-cause recurrence yields a Typed Block, not an implicit loop.
- The final Receipt links every revision, Result, Review, Finding, Repair,
  runtime identity, Promotion, and accepted snapshot.
- The normative repair trace declares `{execution: 4, planner: 5, revisions:
  4, repairs_per_finding: 1}` and therefore has no retry headroom. A rejected
  planner proposal or other fault is exercised in a separate bounded Run and
  cannot be hidden as an in-trace retry.

### Contract mapping

Issues #26, #28, and #29: auditable graph revision, immutable repair lineage,
independent re-verification, bounded replanning, and deterministic acceptance.

## M4a — repository-only `inspect@1`

### Observable scenario

Given an `inspect@1` request answerable from repository evidence, when the
harness runs, then it admits a read-only policy, dispatches real planner,
research, and verifier Attempts, and emits a Receipt for a cited report without
network access, local changes, Promotion, or Application claims.

### Work

- Implement `inspect@1` as the second and final v1 preset.
- Admit repository read only; reject network, writes, commands, commit, and
  external mutation.
- Reject Promotion admission, Result Ref mutation, and `promotion_ref` on an
  `inspect@1` outcome.
- Record the selected preset, evidence, narrowing overrides, and rationale
  through the schema-valid structured linkage established in M1; do not rely
  on an unrepresented free-form field.

### Exit evidence

- A repository-only inspect trace passes through real OpenCode and independent
  verification.
- The same request cannot silently widen from `inspect@1` into local change.
- A fabricated Promotion or `promotion_ref` under `inspect@1` is rejected.
- The normative repository-only trace declares `{execution: 2, planner: 3,
  revisions: 2, repairs_per_finding: 0}`.

### Contract mapping

- #25: effective runtime preflight and enforceable read-only capabilities.
- #27: two materially different admitted Run Policies and visible selection
  rationale.
- #28: cited repository provenance.
- #29: deterministic policy admission and denial of authority widening.

## M4b — declared exact external read

### Observable scenario

Given an `inspect@1` Research packet with one declared exact external URL, when
the agent requests that target, then the adapter exposes only that URL, records
the exact bounded content shown to the agent, and the independent verifier
reviews the frozen observation without a live refetch.

### Work

- Start only after every M4b row in the M0 capability matrix passes.
- Add External Read Target admission and Runtime Observation correlation for
  target id, canonical requested URL, message id, outcome, exact content, and
  digest.
- Reject query-bearing or undeclared URLs, search, browser/MCP/plugin/shell
  network paths, credentials, writes, commands, and external mutation.
- Admit Result Evidence only when its source resolves to the successful matching
  external-read observation and recomputed digest.

### Exit evidence

- One real exact-external-read trace reaches an independently verified Receipt.
- Denied and mismatched target/provenance cases fail closed.
- The verifier consumes preserved content and performs no live refetch.
- The normative external-read trace declares `{execution: 2, planner: 3,
  revisions: 2, repairs_per_finding: 0}`.

### Contract mapping

Issues #25, #27, #28, and #29: exact external reads, policy narrowing, frozen
provenance, and deterministic denial.

## M4c — bounded llm-wiki retrieval

### Observable scenario

Given repository knowledge relevant to the next action, when context is
compiled, then one llm-wiki result cites its authoritative file artifact and
is included in the admitted Packet's file-backed context without becoming
workflow truth itself. V1 must implement and prove this path because llm-wiki
is the declared repository-knowledge layer; use of retrieval remains optional
for an individual Run whose bounded direct file context is sufficient.

### Work and exit evidence

- Add only the retrieval/indexing surface required by this mandatory v1 trace.
- Require source artifact path and digest on every admitted retrieval claim.
- Require the admitted Packet's `input_refs` to bind the retrieved repository
  knowledge to the repository snapshot, source path, and digest. Reject an
  uncited, snapshot-mismatched, or digest-stale retrieval claim. Whether a live
  model would have produced different text without retrieval is a recorded
  observation, not a release gate.
- Prove a Run with sufficient direct bounded file context can omit retrieval
  without weakening provenance or verification.
- The normative retrieval trace declares `{execution: 2, planner: 3,
  revisions: 2, repairs_per_finding: 0}`.

### Contract mapping

Issues #28 and #29: authoritative-source linkage, bounded context compilation,
and deterministic admission of retrieved claims.

## M5 — sequential multi-node graph

### Observable scenario

Given a request that requires multiple bounded tasks, when the planner proposes
a graph, then the kernel validates exact resources and `requires` edges,
dispatches ready nodes in stable sequential order, supports fan-out and fan-in,
preserves unrelated branches after failure, and records an auditable successor
revision when new evidence changes the plan.

### Work

- Generalize from the proven single-chain graph only as needed for a real
  multi-node trace.
- Validate cycles, missing references, duplicate ids, unordered exact-file
  write overlap, invalid verifier targets, and unjustified removal of completed
  work.
- Derive readiness rather than persisting it; keep provenance relations in
  Artifact references instead of inventing edge types.
- Keep stable serial dispatch and `max_concurrency: 1`.
- Demonstrate one fan-out/fan-in trace and one failure that blocks only its
  descendants.
- Fit the normative success trace within the v1 execution budget: two fan-out
  Research Tasks feed one fan-in Implementation Task that produces the sole
  changed Output Snapshot requiring verification, followed by one independent
  Verification Task. Any graph whose additional changed Output Snapshots
  require more verification Attempts is a separate bounded Run or a post-v1
  budget/schema proposal, not evidence for this gate.

### Exit evidence

- Replaying the same canonical snapshot, policy version, and admitted event or
  Artifact sequence produces identical kernel decisions, readiness,
  transitions, and Outcome Record. Separate live model runs need only preserve
  compatible contract outcomes and invariants.
- A derived parent/current graph delta identifies every added, retained,
  removed, or superseded node, and `trigger_ref` resolves to the immutable
  evidence that caused the revision. No unrepresented rationale field is
  required.
- No scheduler, lock service, graph database, or inferred semantic-resource
  system is introduced.
- The normative fan-out/fan-in trace declares `{execution: 4, planner: 3,
  revisions: 2, repairs_per_finding: 0}`.

### Contract mapping

Issues #26, #28, and #29: graph semantics, exact-file conflicts, graph
publication, deterministic scheduling, failure propagation, and provenance.

## V1 release gate

V1 is ready only when the relevant M0 matrix rows and M1 through M3, M4a through
M4c, and M5 are complete, and a clean machine can run the following without
hidden developer-home dependencies:

1. a successful `local-change@1` request with real planner, worker, and verifier
   Attempts, independent verification, and Promotion;
2. the same path with one verifier Finding, one Repair, and re-verification;
3. interruption and resume at each authoritative commit boundary;
4. confirmed and unconfirmed cancellation;
5. a material ambiguity that persists a Material Decision Request, accepts one
   human response, records a Decision successor, and resumes;
6. a low-risk ambiguity that continues as an Assumption without a human gate;
7. an `inspect@1` repository-only report;
8. an `inspect@1` report using one declared exact external read;
9. a bounded llm-wiki retrieval whose admitted Packet input binds the
   repository snapshot, source path, and digest;
10. a sequential multi-node fan-out/fan-in request;
11. the hostile outcomes listed in `docs/design/examples.md`.

The release evidence must include protocol validation, real OpenCode version
and configuration identity, exact commands and outcomes, immutable run
artifacts, and reconstruction of every Receipt from files alone.

## Post-v1 evidence gates

These are independent candidates, not committed v1 scope. Their order is
chosen only after evidence demonstrates a dependency.

### M6 — controlled concurrency

Proceed only after a real sequential trace demonstrates that parallelism is
material. Add bounded parallel dispatch, resource locks, obsolete-task
cancellation, fairness, and timeout handling. Require equivalent sequential
and concurrent runs to produce compatible accepted outcomes before raising
`max_concurrency` above one.

### M7 — additional presets

Add a preset only when at least two completed traces demonstrate a policy
difference that cannot be represented by `inspect@1`, `local-change@1`, or a
narrowing override. Bug-fix, feature, refactor, CI, and documentation labels
remain routing signals until then. This does not depend on controlled
concurrency.

### M8 — external Application

Design Application separately from Promotion. Local branch updates, commits to
user-designated refs, pushes, PR/issue mutation, deployment, migration, and
deletion each require explicit authority, deterministic capability
enforcement, idempotency, recovery, and independently verified preconditions.
None may be inferred from a v1 Receipt or Result Ref, and this work does not
depend on an expanded preset catalog.

## Ticket-writing rule

Create implementation tickets from the observable milestones above. Each
ticket must name its Given/When/Then outcome, affected contract sections,
adversarial cases, real-runtime evidence, and explicit exclusions. Prefer
behaviour such as “dispatch a real worker from an admitted packet and reject an
undeclared diff” over component tickets such as “implement policy engine” or
“implement artifact manager.”

The first dependency-ready ticket is the M1 prerequisite group in M0. M1 begins
only after every named M1 matrix row passes; it does not wait for the M4b
external-read rows or future adapter abstractions. After M3, M4a-M4c and M5 may
advance independently. M4b begins only after its own M0 matrix rows pass.
