# Phase 2 v2 transition baseline

## Status and boundary

This is accepted direction for later v2 lifecycle behavior and remains
unimplemented. The shipped v2 `/route` preparation contract covers only
prepared-run artifacts; it does not make the behavior below current. Phase 2
becomes observable only when a later matching contract, implementation, and
public evidence co-land in one bounded slice; see
[delivery and readiness](phase-2-delivery.md).

This record versions accepted normal-path transitions. It changes no current
Phase 1 behavior and defines no runtime interface, payload, or implementation.

## States and operation responsibility

A v2 run begins `prepared`. Its task execution states are exactly `blocked`,
`queued`, `dispatched`, `succeeded`, and `failed`. Acceptance is a separate
host-recorded fact; no operation creates `cancelled` or `operator-paused`.

- `/route` compiles declared work and atomically creates each initially
  admissible task's immutable `tasks/<id>/attempts/1/packet.md`, bound to the
  run declaration and graph revision. It launches no worker. A later contract
  may define initial admissibility but may not move first-packet creation to
  `/start`.
- `/start` may dispatch only an existing first-attempt packet.
- `/resume` may create later attempts.

## Accepted normal-path transitions

| Recorded change | Preconditions | Atomic host artifact effect | Stop condition |
| --- | --- | --- | --- |
| `/route`: absent to `prepared`; task absent to `blocked` | Accepted v2 declaration and decision references | Write `run.json`, initial `graph.json`, first event, and initially admissible first-attempt packets under the run lock | Material ambiguity records a gate; no worker launches |
| Later record-only `/route`: `blocked` to `succeeded` or `failed` | Complete structurally valid manual result for the immutable packet | Record `result-observed` and graph summary | No worker launch, dispatch, retry, or later attempt |
| Later record-only `/route`: selected blocked declared or repair node remains `blocked` | Terminal dependency condition, current required decisions, no active block, and no existing attempt-one packet | Record selection and create its immutable attempt-one packet under the run lock | A false prerequisite records its typed block; selection stops |
| `/start`: `blocked` to `queued` | v2 declaration, current required decisions, declared dependency condition, no active block, supplied adapter capability, approved policy | Record admission event and graph summary | A false prerequisite records its typed block; admission stops |
| `/start`: `queued` to `dispatched` | One approved free slot and an existing immutable first-attempt packet | Record dispatch event and graph summary | Returns after dispatch; does not poll workers |
| Future adapter reconciliation: `dispatched` to `succeeded` or `failed` | Complete valid result for the current attempt | Record result-observed event and graph summary | Claim truth and acceptance remain unjudged |

Every recorded change uses one run-local host lock and atomic temporary-file
replacement. There is never a second writer and state is never silently
reconstructed. Filesystem failure and refusal semantics remain deferred.

## Reconciliation

For the record-only lifecycle selected in Issue #18, a later human-invoked
`/route` is the sole reconciler and the sole creator of a later task's
attempt-one packet. `/start` and `/resume` remain deferred; they do not own
reconciliation in this lifecycle. Recording a claim observes its structural
shape and provenance; it does not judge its truth or run a worker or verifier.

| Observed attempt | Human operation | Atomic host effect | Stop condition |
| --- | --- | --- | --- |
| Complete structurally valid manual result | Later `/route` | Record `result-observed`; task becomes `succeeded` or `failed` while its acceptance stays separate | No worker launch, redispatch, retry, or later attempt |
| Complete structurally valid implementation verifier result | Later `/route` | Record `acceptance-recorded` after the terminal result; preserve packet and execution history | A failed verdict may create only its finding-bound blocked repair node; it creates no repair packet automatically |
| Complete structurally valid non-implementation claim | Later `/route` | Record `not_applicable` acceptance after the terminal result; preserve packet and execution history | No verifier, dispatch, retry, or automatic downstream packet |
| Missing or incomplete manual claim | Later `/route` | Leave the existing task and packet unchanged | Silence and abandonment are not inferred |

After this reconciliation boundary, only a later human-invoked `/route` may
select one dependency-ready declared or finding-bound repair node and create
its immutable attempt-one packet. That selection remains manual, single-slot,
and record-only; it does not authorize `/start`, `/resume`, adapter execution,
or retry behavior.

## Retry baseline

The retry baseline below remains accepted broader Phase 2 direction, but it is
not selected by the record-only lifecycle. A finding-bound repair node is not a
retry: it preserves failed history and consumes no retry budget.

A retryable declared failure records `worker-failed-retryable` and has
execution state **`blocked`** while awaiting a later `/resume`; its typed block
is a separate fact. A later explicit human `/resume` requires a reconciled
prior attempt and remaining declared per-task budget. In one atomic host
transition it consumes one retry-budget unit, records `retry-admitted` with
prior attempt number, new attempt number, `budget_before`, and `budget_after`,
and creates `attempts/<n+1>/packet.md` before dispatch. That packet references
the prior failed attempt and its failure/block context.

An exhausted budget or terminal failure remains `blocked` with no new packet.
There is no background, automatic, or unbounded retry.

```text
blocked -- /resume with reconciled retryable failure and budget --> queued --> dispatched
```

## Version and concurrency restrictions

Version-1 runs remain readable as historical Phase 1 layout. `/start` and
`/resume` refuse them without mutation and name the
`schema-version-unsupported` block. There is no in-place migration.

`max_concurrency: 1` is the baseline restriction. `/start` and `/resume` admit
or dispatch at most one task at a time; a greater declared value is refused
before an admission event or attempt packet. This is a temporary restriction,
not a scheduling policy. Any increase belongs to the resource-admission slice.

## Provenance and deferrals

The accepted sources are ADR-0003 and external claims
`runs/3a63c3442de67bdd/tasks/phase2-v2-state-spec/result.md` and
`runs/c51df7d251bc80e7/tasks/phase2-v2-state-spec-repair/result.md`.

This record resolves ADR-0003 obligations 5 and 9 for the normal path,
completes the transition portion of obligation 2, advances obligation 6 without
field formats, advances obligation 4 without gate semantics, and names the
v1 effect of obligation 1 without a block catalog. Shared vocabulary
(obligation 8) is recorded separately. Dependency acceptance (3), gate
rendering (7), typed-block payloads, retry-packet fields, CLI shapes, resource
admission, verifier, receipt, adapter, attestation authority, and filesystem
recovery remain later slices.

This record contains no block catalog or error payload, retry-packet field
format, CLI request or response shape, resource declaration or overlap
predicate, dependency-acceptance predicate, gate presentation, verifier,
receipt, adapter, or code beyond the plain state sequence above.
