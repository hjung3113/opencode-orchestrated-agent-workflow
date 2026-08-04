# Handoff

## Current handoff — 2026-08-05

### Status

- M1 and M2 are complete locally through the public CLI and file-backed
  artifacts. The final review repairs cover repository-policy intake, one
  natural-language public execution input, Result Ref vocabulary, native
  network denial, pre-dispatch material Decision gating, publication
  reconciliation, cancellation reconciliation, worker-authored Result
  proposals, fail-closed inspect, complete command Evidence validation, and
  honest M0 cancellation capability reporting.
- `cancel` records intent before abort, confirms a stopped runtime or writes
  an immutable Runtime Observation plus `cancel_unconfirmed` Typed Block, and
  never dispatches a successor. A later public `resume` uses the durable
  binding and bounded adapter reconciliation; no-binding cancellation also
  fails closed with a durable observation and block.
- Result/Review publication has deterministic prepared-artifact recovery.
  Promotion preparation precedes CAS and `resume` reconciles expected,
  already-promoted, and conflicting refs. A crash after Result publication
  leaves a typed `runtime_reconciliation_required` checkpoint that is
  resumable; a crash after Review publication completes. Repeated public
  resume and publication are idempotent.
- Runtime event subscriptions are observational only; attempt execution no
  longer waits indefinitely for SSE readiness, so the admitted Attempt
  deadline remains the execution bound.
- Material ambiguity is admitted only from explicit durable protocol data.
  Neutral request wording and model confidence cannot create a material gate.
  The gate is before workflow selection, worker dispatch, or Promotion
  preparation. An explicit rejected human Decision never promotes; exactly one
  accepted human-authored successor is admitted, its Decision ref is included
  in the Receipt, and the Run resumes.
- Paired low-risk ambiguity records one durable Assumption and continues.
  Cumulative Run limit exhaustion produces a typed Block.
- Current branch is `agent/executable-opencode-harness-design` after local
  repair commits through `09cb345`; this handoff update is the next local
  commit. Nothing has been pushed and no PR exists.
- Current evidence: protocol 4/4, M0 16/16, full M1 11/11 including a fresh
  successful real OpenCode trace, M2 17/17, kernel 1/1, JavaScript syntax
  checks, and `git diff --check` all pass.

### Next task

M2 is complete locally. The next milestone is M3's one finding-bound repair;
that work is intentionally not included here. Do not add a generic recovery
engine, arbitrary retry/fork surface, concurrency, or Application.

### PR gate

The user authorized local commits for this continuation. No push or PR was
performed. Before any future publication:

- every retained review finding is tied to an explicit M0-M2 contract and
  focused public/file-backed regression test;
- protocol, M0, M1, M2, kernel, syntax, and whitespace checks pass;
- the successful real trace satisfies the M1 exit evidence;
- the claimed milestone boundary matches the actual M2 state and tests;
- the handoff's exact evidence is refreshed against the live checkout.

## M2 recovery ledger (2026-08-05)

### Acceptance evidence

- Operator cancellation: `cancel_requested` is durably appended before the
  runtime abort. A confirmed stop appends `cancel_confirmed` and closes the
  Run as `cancelled`; an unconfirmed stop writes an immutable Runtime
  Observation, a `cancel_unconfirmed` Typed Block, and no successor dispatch.
  Public `cancel` after simulated process death exercises the same durable
  fallback.
- Prepared Promotion: `artifacts/promotions/promotion-1.json` is written
  before Result Ref CAS and contains the expected ref, promoted ref, and
  snapshot. `resume` handles the current ref at expected, already-promoted,
  or conflicting OID; only the first two proceed, while drift becomes a
  typed block. Repeated resume is idempotent.
- Cumulative Run limits: planner, execution, revision, and repair admissions
  consume the same durable Run counters; exhaustion produces a Typed Block
  rather than another attempt.
- Material Decision: `material_decision_request` survives restart with only
  the durable Request reference; no workflow, worker, or Promotion is
  prepared before the human gate. `resume --decision ...
  --decision-disposition accepted|rejected` admits human Decision artifacts;
  rejection stays resumable and never promotes, while exactly one accepted
  successor may supersede it and resume. Its durable ref is included in the
  final Receipt input and artifact refs. Repeated responses do not create
  another accepted successor.
- Materiality: the Kernel uses only the admitted Request's explicit
  `material:`/`decision:` ambiguity marker; it does not inspect raw caller
  wording. Neutral real OpenCode requests continue without a gate unless the
  durable Request explicitly records that marker.
- Paired low-risk ambiguity: exactly two non-material ambiguity strings create
  one durable Assumption before proposal continuation. Materiality is not
  inferred from model confidence.
- Cancelling resume: public `resume` after a crash before/after runtime abort
  records `cancel_unconfirmed` and blocks; the injectable adapter seam can
  confirm `cancelled`. A Run with no active binding also writes a fallback
  Runtime Observation and block rather than remaining `cancelling`.
- Crash boundaries: deterministic hooks cover before/after Promotion
  preparation, before/after Result Ref CAS, after Result publication, after
  Review publication, before/after `receipt_admitted` Run-state replacement,
  before/after runtime abort, and repeated public CLI resume at each boundary.

### Verification

- `npm run test:protocol` — 4/4 passed.
- `npm run test:m0` — 16/16 passed.
- `npm run test:m1` — 11/11 passed, including the real OpenCode trace.
- `npm run test:m2` — 17/17 passed after the final runtime-bound repair.
- `node --test test/m1-kernel.test.mjs` — 1/1 passed.
- `node --check scripts/local-change.mjs` and
  `node --check scripts/probe-opencode.mjs` — passed.
- `git diff --check` — passed before this handoff edit; it is rerun after the
  edit and commit.

### Remaining limitations

- The M0 operator probe intentionally reports
  `operator.cancel_unconfirmed_reconcile` as capability-unverified rather
  than relabeling a deadline abort. M2 proves the durable later-observation
  path with its file-backed adapter seam; no M0 cross-process server-death
  capability is claimed.
- A public resume after process death cannot reconnect to an external
  OpenCode server that no longer exists in the process; it fails closed as
  `cancel_unconfirmed`. The bounded adapter seam can confirm abort/status when
  the durable binding is reachable.
- Material gating is deliberately fail-closed to explicit durable Request
  ambiguity markers; caller-text keywords and model confidence alone cannot
  create a human gate.
- Repository-policy intake cites the target workspace's `AGENTS.md` when it is
  present and records an explicit empty-policy statement otherwise; the
  planner receives that Kernel-derived content and cannot read files.
- Recovery covers the current single-task prepared Promotion and Decision
  checkpoints only. Generic recovery, concurrency, arbitrary retry/fork,
  M3 repair, and Application remain out of scope.

## Historical objective

**M0 is complete; continue with the M1 protocol representability correction
only. Do not run another plan-wide Sol/Opus/readiness review and do not wait
for an `ACCEPT` verdict.** Add the bootstrap planner envelope, pre-intake Run
State, typed command/evidence linkage, and schema-valid preset policy fields;
do not start the M1 walking skeleton or a generic kernel in this slice.

## Live state

Verified on 2026-08-05 (Asia/Seoul):

- checkout: `/Users/hyojung/orca/opencode-orchestrated-agent-workflow`
- branch: `agent/executable-opencode-harness-design`
- HEAD: repair tip `09cb345`; this handoff update is the next local commit
- upstream: `origin/agent/executable-opencode-harness-design`
- Issue #30 is open: <https://github.com/hjung3113/opencode-orchestrated-agent-workflow/issues/30>
- no protected uncommitted work was present before this handoff edit
- local implementation commits were authorized; no push, PR, or issue mutation
  has been performed

Recheck all mutable state before continuing.

## Completed

- Read the live product authority and Issues #25 through #30.
- Wrote `docs/implementation-plan.md` as delivery sequencing, not product
  authority.
- Critically revised Issue #30's proposed order into this dependency path:

~~~text
M0 capability matrix
  -> M1 local-change walking skeleton
    -> M2 recovery, cancellation, and material-decision round trip
      -> M3 one finding-bound repair
        -> M4a repository inspect -> M4b exact external read
                                 \-> M4c llm-wiki
        -> M5 sequential multi-node graph
~~~

  M4a and M5 are independent after M3 and both gate v1. M4a gates M4b and
  M4c; M4b and M4c are independent of each other. Concurrency, additional
  presets, and external Application remain independent post-v1 candidates.
- Requested a fresh independent `gpt-5.6-sol` high-reasoning review. Its
  initial verdict was `REJECT` with one blocker, two high, four medium, and one
  low finding. All findings were incorporated into the current plan.
- Requested a fresh independent Opus high adversarial review and two fresh
  follow-ups. All three returned `REVISE`; each exposed additional executable
  contract gaps. The current plan incorporates their valid findings by adding
  M1 command/skill/revision work, explicit milestone budget tuples, a
  pre-intake Run State with a Kernel-owned bootstrap planner envelope, typed
  command observations, deadline stop evidence, an M2-specific capability
  gate, explicit inspect Promotion denial, and schema representability gates.
- A fourth fresh Opus final-gate call could not run because the Claude CLI
  reported `You've hit your session limit · resets 4:30am (Asia/Seoul)`.
  That missing `ACCEPT` is not an implementation gate and must not be retried
  before M0.
- A later independent Sol-high read-only gate returned `REVISE` with two M5/M4c
  findings and two runtime/protocol findings. Only runtime-usage observation is
  relevant to M0 and must be folded into the probe. M5 budgeting, M4c retrieval
  provenance, and the pre-intake Material Decision representation are deferred
  to their owning milestones and must not block M0 implementation.
- Passed `git diff --check` and the no-index whitespace check for the untracked
  plan.
- Started M0 with the agreed public CLI seam:
  `node scripts/probe-opencode.mjs --workspace <disposable-fixture>`.
- Added `package.json`, `scripts/probe-opencode.mjs`, and
  `test/m0-probe.test.mjs`. The probe currently emits machine-readable rows for
  the live OpenCode version, resolved-configuration digest and undeclared
  configuration rejection, headless-server health, and fresh planner, worker,
  and verifier session ids.
- The probe uses fixture-local XDG config/data/state/cache directories so its
  OpenCode server and sessions do not share mutable runtime storage with the
  user's normal OpenCode process. It disables Claude Code integration, default
  plugins, and model fetching for the current non-model slices.
- The effective-configuration test injects an undeclared instruction and proves
  fail-closed `runtime_configuration_conflict` behavior. The server test invokes
  the real OpenCode `1.18.5` binary and confirms health/version and process stop.
- Current focused evidence is `npm run test:m0`: 4 tests passed. A fresh
  `git diff --check` also passed. No probe-owned process remained afterward.
- Superseding implementation evidence on 2026-08-04: the complete M1 matrix is
  12/12 pass in one disposable Git fixture, and `npm run test:m0` passes 15/15.
  The probe now covers resolved role/model identities, real message/events,
  usage availability, typed runtime failure, timer-driven abort with observed
  idle, canonical symlink-safe Output Snapshot capture, narrowed capabilities,
  actual exact-command rejection with credential/network isolation, runtime
  skill resolution, undeclared-agent rejection, and fatal setup matrices.
- A final `gpt-5.6-sol` high-reasoning diff-only review found false-positive
  evidence and fail-closed boundary defects. Those findings were repaired; no
  repository-wide or plan-wide review was run.

## Authority and boundaries

Read these before changing the plan or implementing it:

- `AGENTS.md` and `CONTEXT.md`
- accepted ADRs under `docs/adr/`
- `docs/design/`, including `docs/design/schemas/protocol-v1.schema.json`
- Issues #25 through #29 for contract input
- Issue #30 for sequencing input only

If `docs/implementation-plan.md` conflicts with those sources, correct the
plan. Do not turn sequencing choices into product invariants. Archived delivery
plans are historical context, not authority.

V1 remains deliberately narrow: `max_concurrency: 1`, exactly `inspect@1` and
`local-change@1`, independent verification, Promotion only to a harness-owned
Result Ref, and no Application to a user branch or external target.

## Current routing after M0 completion

M0's M1 prerequisite group is now GREEN through the existing CLI seam. The
probe emits 12 machine-readable rows and the disposable end-to-end fixture
passes every row against OpenCode `1.18.5`. `npm run test:m0` passes 15/15.
The implementation also received the requested Sol-high purpose-and-diff-only
review; its concrete findings were repaired with focused regression tests.

The implemented RED -> GREEN slices are:

1. Add a public-seam test that requires the matrix to bind each planner,
   worker, and verifier session to its actual resolved OpenCode agent and model.
2. Require worker and verifier `agent_identity` values to be derived from their
   resolved role-specific configuration and to differ. A session id alone is
   not an identity and does not satisfy this row.
3. Drive one minimal real message through the headless server, observe its
   message id and relevant event stream, and record the resulting idle or typed
   runtime failure. Do not label session creation as message/event evidence.
4. Record runtime usage if the returned message/session data exposes it;
   otherwise emit an explicit partial/unavailable compatibility result.
5. Keep the fixture disposable and fixture-local. Confirm the server is stopped
   even when message execution fails or reaches its test deadline.

The remaining M1 rows were then completed in this order:

1. terminal and runtime-failure observations;
2. deadline abort plus independently confirmed runtime stop;
3. complete workspace diff and canonical Output Snapshot;
4. capability narrowing and denial of Task delegation, general model-session
   shell, network, and external mutation;
5. exact admitted-command mediation;
6. declared skill id/version/source/digest and unavailable-skill rejection.

The probe must run against the live installed OpenCode version (currently
observed as `1.18.5`; recheck it) and prove or reject:

- fresh planner, worker, and verifier sessions with distinct worker/verifier
  identities;
- role/model identity, resolved-configuration digest, and rejection of
  undeclared configuration;
- session, message, terminal, idle, failure, deadline, and runtime-stop
  observations;
- available runtime usage, with an explicit unavailable/partial result when the
  runtime does not expose it;
- complete workspace diff and canonical Output Snapshot capture;
- capability narrowing that denies Task delegation, general model-session
  shell, network access, and external mutation;
- exact admitted-command mediation;
- declared skill identity and unavailable-skill rejection.

The implementation must emit a machine-readable matrix row for every item with
the observed evidence or a typed incompatibility. Unsupported required rows are
valid probe results but do not pass the M1 gate. The automated smoke must create
and remove its own disposable fixture, invoke the real runtime, validate the
matrix shape, and fail closed when a required observation or enforcement is
missing.

This M0 session completed all of the following:

1. Every named M1 matrix row above has observed evidence or a typed
   incompatibility; placeholder, untested, or inferred success rows are absent.
2. The focused automated smoke creates/removes its own disposable fixture,
   invokes the real runtime, validates the complete matrix shape, and fails
   closed when a required observation or enforcement is missing.
3. The real command, OpenCode version, matrix output, and pass/typed-
   incompatibility results are reported.
4. `git diff --check` and `npm run test:m0` have been run.
5. The exact next dependency is M1: implement the first real
   `local-change@1` walking skeleton from the observable scenario in
   `docs/implementation-plan.md`. Do not extend the M0 probe unless a concrete
   M1 integration failure falsifies one of its rows.

Do not stop after discovering the CLI/API, drafting probe pseudocode, writing a
schema without an executable, or generating a prompt. Those are preparation,
not completion.

Runtime abort and confirmed stop on deadline gate M1; operator cancellation and
reconnect/reconciliation rows gate M2. The M4b exact-URL/webfetch probe is a
separate prerequisite and must not block M1 through M3.

Do not prebuild the full kernel, concurrency, speculative adapter abstractions,
additional presets, llm-wiki integration, or external Application while doing
this probe.

## Hard stop on the review loop

- Do not request another whole-plan Sol or Opus review before implementing M0.
- Do not edit `docs/implementation-plan.md` merely to incorporate findings for
  M1, M4c, or M5 before M0 evidence exists.
- Do not treat `/tmp` reports, reviewer `REVISE`, or missing reviewer `ACCEPT`
  as a reason to postpone the probe.
- If implementation exposes an M0-specific contradiction, fix only that
  contradiction and continue the probe. Defer unrelated roadmap defects.
- A future independent review, if requested, must be a single narrow review of
  the implemented M0 diff and evidence after the focused smoke passes; it is
  not a prerequisite for starting implementation.

## Review evidence and tooling limitation

The Sol review was read-only and wrote its report to
`/tmp/opencode-implementation-plan-sol-high-20260803.md`. `/tmp` is ephemeral;
the incorporated plan is the durable repository-local result.

The latest Sol-high report is
`/tmp/opencode-implementation-plan-sol-high-final-20260804.md`. Its `REVISE`
verdict is historical routing input, not a pre-M0 approval gate.

Orca Task/Dispatch creation failed with `legacy_read_only`, so the Opus reviews
were run as direct fresh read-only Claude Opus CLI sessions and are not Orca
Task/Dispatch lifecycle evidence. Three empty diagnostic Runs,
`run_623ddebe5f9a`, `run_9a795df33bd1`, and `run_99aebe19ad55`, contain no task
result and are not workflow authority. Do not resume them as implementation
work.

## M1 protocol correction ledger (2026-08-04)

### Decisions

- The first planner Attempt is Kernel-owned Intake work: `bootstrap_envelope`
  is a file-backed artifact with `runtime_ref`, bounded capabilities, deadline,
  and idempotency key; it is not a Task Packet.
- A new Run starts in `pre_intake`. Its `run.json` records `bootstrap_ref`,
  `idempotency_key`, planner budget, and runtime bindings before Request and
  effective-policy admission; `request_ref` and `effective_policy` are absent
  until the Run exits `pre_intake`.
- `$defs.skill.digest` is required. Runtime Observations carry typed
  `command_executions`; command Evidence uses `source: command:<id>` plus a
  matching Runtime Observation reference and output digest.
- Request `preset_selection` and the effective policy now carry typed
  selection evidence, preset defaults, proposed/admitted narrowing,
  deviations, rationale, and a selection reference that is repeated on a
  Receipt.

### Mistakes and failed assumptions

- The prior runtime wording made every Attempt appear Packet-bound, which
  incorrectly gave the pre-intake planner a Task contract that does not exist.
- `effective_policy.deviations` as free-form strings and `request.proposed_preset`
  as an enum could not represent the workflow contract's selection evidence or
  policy precedence. Permission-event strings also cannot prove command output.
- M1 is not the walking skeleton yet; do not implement dispatch, kernel state
  transitions, runtime adapter changes, or a generic preset registry here.

### Evidence

- Live M0 evidence remains the 12-row disposable fixture matrix and
  `npm run test:m0` 15/15 pass; no M0 files were changed by this correction.
- `npm run test:protocol` passes 4/4, including runnable pre-admission and
  admitted-Run instance validation. The protocol schema parses and compiles
  with Ajv draft 2020-12 in non-strict format mode.
- Current authority is `CONTEXT.md`, `docs/design/`, and
  `docs/design/schemas/protocol-v1.schema.json`; `docs/implementation-plan.md`
  remains sequencing input only.

### Rules for the next task

- Reuse `bootstrap_ref`/`runtime_ref`, `pre_intake`, `preset_selection`,
  `effective_policy.preset_selection_ref`, `command_executions`, and
  `command_ref` exactly; do not reintroduce `proposed_preset`, Packet-bound
  bootstrap planner attempts, or untyped command Evidence.
- Validate every artifact against the corrected schema and preserve the
  planner envelope/runtime observation provenance before implementing the
  walking skeleton. Keep M2 recovery, M4 external reads, concurrency, extra
  presets, and Application out of scope.

### Slice 1 focused repair (2026-08-04)

- Correction: `run.admission_state` now distinguishes `pre_intake` from
  `admitted`. A pre-admission Run may validly be `pre_intake`, `cancelled`, or
  `blocked` without inventing `request_ref` or `effective_policy`; an admitted
  Run requires both and cannot remain `pre_intake`.
- Validation: the focused protocol test now compiles the real draft-2020 schema
  with the repository's minimal Ajv dev dependency and validates a pre-intake
  instance, pre-admission cancelled/blocked instances, and rejection of an
  admitted active instance missing Request/Policy artifacts.
- Recurrence rule: never gate Request/Run Policy presence on lifecycle label
  alone; validate admission provenance first, then require both artifacts for
  every admitted Run and test each pre-admission terminal path from an actual
  schema instance.

## M1 Slice 2 walking skeleton ledger (2026-08-04)

### Decisions

- `scripts/local-change.mjs` is the narrow executable seam for one bounded
  `local-change@1` request. It clones a disposable task workspace with
  `git clone --no-hardlinks`, copies the protected dirty/untracked inputs, and
  never writes the user branch or worktree.
- The run emits the required kernel-owned bootstrap, three fresh planner
  sessions (Request, graph revision 1, graph revision 2), one worker session,
  and one fresh verifier session. The worker Result and verifier Review retain
  canonical Output Snapshot equality through CAS Promotion to the bare,
  harness-owned `refs/orchestrator/results/<run_id>` Result Ref and Receipt.
- The effective policy is the exact v1 budget (`max_concurrency: 1`, execution
  2, planner 3, revisions 2, repairs 0). Packets live under task attempt
  paths, and every emitted Run/artifact is validated against protocol-v1 before
  it is written.
- The worker may use only OpenCode read/edit/write tools; the kernel executes
  the one exact typed `verify-change` command and binds its output digest into
  Result evidence. Verifier output is accepted only after the kernel confirms
  unchanged snapshot; no M2 recovery, repairs, concurrency, extra preset,
  inspect@1, llm-wiki, or Application path was added.

### Mistakes and failed assumptions

- A long graph prompt caused the real planner to attempt a skill-file read and
  return a read marker instead of JSON. The planner prompts now explicitly say
  that the kernel supplied all facts and that no tool/read is needed; the
  kernel still validates and normalizes the returned plan.
- The first worker snapshot was captured before its isolated Result commit,
  while verification observed the post-commit Git base; entries were equal but
  snapshot digests differed. Commit the isolated workspace first, then capture
  the canonical worker snapshot used by Result, Review, Promotion, and Receipt.
- OpenCode's `external_directory: deny` treats the isolated task workspace as
  external and blocks the worker's legitimate file tools. Do not add that rule
  to this fixture; tool capabilities and the kernel's allowed-resource diff
  check provide the bounded seam.
- OpenCode may report an empty status map even after `session.idle`; runtime
  observations treat an observed `session.idle` event (or absent status after a
  completed message) as idle. A verifier response without a structured object
  is kernel-normalized only after snapshot equality, with the fresh verifier
  runtime observation retained; an explicit structured verdict remains binding.

### Evidence

- `npm run test:m1` passes the real OpenCode `1.18.5` walking skeleton in a
  disposable Git fixture with a protected dirty file; it validates the full
  trace, schema-valid artifacts, typed command/evidence digest linkage,
  independent verifier identity, CAS Result Ref, Receipt, inspect seam, and
  unchanged user status/HEAD.
- `node --test test/m1-kernel.test.mjs` passes the minimal deterministic
  compare-and-swap/idempotency transition check. `npm run test:protocol` passes
  4/4, and `npm run test:m0` passes 15/15 after the Slice 2 changes.
- A manual successful run produced `state_version: 9`, transitions for Request
  admission, graph revisions 1/2, worker Result, verifier Review, and Receipt;
  its Result/Review/Promotion/Receipt snapshot was identical and its promoted
  ref was a 40-hex commit in the harness-owned bare repository.

### Rules for the next task

- Preserve the trace order and exact artifact/reference types. Do not move
  Result/Review packets out of task attempt paths, replace command execution
  records with permission-event strings, or compare snapshots without their
  post-commit Git base.
- Keep the user worktree baseline (HEAD plus Git-visible entries/status) as a
  fail-closed invariant. Promotion must use `git update-ref <ref> <new> ""`
  so an existing Result Ref cannot be silently overwritten.
- Treat real OpenCode model text as an input to a schema-normalizing kernel,
  not as authority for scope, commands, skills, or promotion. Reuse the live
  M0 profile (`opencode/big-pickle`, fixture-local XDG stores, undeclared-source
  rejection) and keep all runtime state outside the source checkout.
- Before any next slice, rerun the focused protocol/kernel/M1 checks and the
  M0 regression; do not broaden this skeleton into M2 recovery or Application.

## Resume checks

~~~sh
git status --short --branch
git log -1 --oneline
gh issue view 30 --json number,state,title,url,updatedAt
git diff --check
opencode --version
npm run test:m0
git diff --no-index --check -- /dev/null docs/implementation-plan.md
git diff --no-index --check -- /dev/null HANDOFF.md
~~~

The no-index commands normally return exit code 1 because the files differ
from `/dev/null`; their output should contain no whitespace errors. Preserve
both untracked files unless the user explicitly authorizes publication or
deletion.

## M1 Slice 2 focused repair ledger (2026-08-04)

### Decisions

- The verifier is a fresh actor with read-only access to the exact target path
  and the frozen Result/Output Snapshot facts. Malformed or missing structured
  verifier output blocks the Run; the kernel never fabricates a pass.
- Every admitted Attempt uses its Packet deadline. The OpenCode adapter aborts
  the session on deadline, confirms stop through the abort response/status or
  idle event, and only then may the kernel observe or publish a Result,
  Review, or other Attempt artifact. Unconfirmed stop is a typed block.
- `runtimeFactory` is the smallest injectable seam for deterministic M1
  adversarial tests while the default remains the real M0-proven OpenCode
  adapter/profile. Kernel admission is centralized in `admitArtifact`: actor
  ownership, staged immutable write, reference path/id/digest resolution, and
  no-overwrite are checked in one place.
- Promotion resolves the harness-owned Result Ref after compare-and-swap,
  derives the promoted tree snapshot from that Ref, and rejects Ref drift or
  tree digest mismatch before Promotion/Receipt. Planner, execution, and graph
  revision counters are enforced at shared admission points.
- `run.workspace_baseline` durably records branch, HEAD, Git status digest,
  intake snapshot digest, and protected dirty/untracked paths; the clone keeps
  those protected inputs in the disposable task workspace.

### Mistakes and failed assumptions

- The earlier verifier had no read capability and a fallback that synthesized a
  pass when model output was malformed; this made independent verification a
  kernel claim. The fallback is removed and malformed output is fail-closed.
- The earlier adapter treated a fixed HTTP timeout as an Attempt deadline and
  could publish after an unconfirmed stop. Deadline abort/confirmation is now a
  gate before snapshot or artifact publication, including fake confirmed and
  unconfirmed failure paths.
- Direct artifact renames and workspace-derived Promotion snapshots were not
  sufficient provenance. All actor artifacts now pass staged admission, and
  Promotion derives from the resolved Result Ref rather than the task folder.
- Dirty paths were copied transiently and never recorded in Run State; the
  baseline is now schema-valid authoritative provenance. Planner command text
  remains input only; the kernel still supplies the one admitted command.

### Evidence

- `node --test --test-name-pattern='injectable runtime seam|immutable producer|shared admissions|undeclared planner' test/m1-local-change.test.mjs` passes the deterministic malformed verifier, identity collision, post-review mutation, idle-without-Result, undeclared-path, confirmed/unconfirmed deadline, immutable/digest, cumulative budget, undeclared-command, and Result Ref drift cases.
- The real OpenCode walking skeleton passes with a verifier read and all prior
  trace/schema/unchanged-worktree assertions; its Promotion snapshot comes
  from the resolved bare Result Ref. Protocol schema tests pass after adding
  the workspace baseline field.
- Later live reruns intermittently stalled inside the external
  `opencode/big-pickle` stream before a planner response; those attempts
  fail-closed with no Result/Promotion/Receipt, while the earlier successful
  real trace and the deterministic seam remain intact. `npm run test:m0` and
  `npm run test:protocol` remain green after the repair.

### Recurrence rules

- Never let verifier output be replaced by a kernel default; require a
  schema-valid, independently attributed Review tied to the frozen Result
  reference and refreshed filesystem snapshot.
- Never observe or publish after a deadline until stop is confirmed; preserve a
  typed unconfirmed-stop block and test both confirmation outcomes through the
  injectable seam.
- Route every authoritative artifact through immutable producer-owned admission
  and resolve every artifact reference before accepting the containing record.
  After CAS, resolve the Result Ref again and derive the promoted tree from that
  Ref before writing Promotion or Receipt.
- Count cumulative budgets at the shared Attempt/revision admission points and
  preserve the schema-valid user baseline (HEAD/status/snapshot/protected
  paths) in every Run.

## M1 Slice 2 live deadline ordering correction ledger (2026-08-04)

### Decision

- Keep the production admitted Attempt deadline at 300 seconds. The real
  adapter test now injects a one-second admitted deadline through the existing
  runtime seam, and the real local-change test has an outer timeout with
  abort/status/server-cleanup margin.

### Mistake and evidence

- An outer test timeout equal to the production deadline could terminate the
  process before adapter abort confirmation, failure recording, and task
  workspace cleanup. The real adapter deadline test now reaches the timer,
  confirms stop, and asserts a schema-valid blocked Run with typed
  `deadline_exceeded` evidence, no Result/Review/Promotion/Receipt, a stopped
  OpenCode server, and no retained task workspace; focused M1, protocol, and
  M0 checks pass.

### Recurrence rule

- Every live deadline test must set its outer timeout strictly beyond the
  admitted deadline plus bounded abort/status/runtime-cleanup time, and must
  prove the terminal blocked artifact and cleanup state rather than relying on
  absence of later artifacts. Keep production fail-closed deadline behavior
  unchanged when adding a test-only deadline seam.

## Review repair scope gate

- A review finding is a candidate, not an automatic repair instruction.
- Repair only when the finding is reproducible, required by the current
  objective or acceptance criteria, and inside the original allowed scope.
- Reject or defer speculative hardening, future-proofing, and adjacent defects.
  A broader repair needs an explicit user-approved scope change.
