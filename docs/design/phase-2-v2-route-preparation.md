# Phase 2 v2 `/route` preparation specification input

## Status and boundary

This record was the bounded specification input selected by the v2 `/route`
preparation readiness result. The resulting behavior is now current through
the [v2 `/route` preparation contract](../contracts/phase-2-v2-route-preparation.md)
and `test/v2-route.test.js`. It changes neither the schema-less Phase 1 path
nor any later v2 lifecycle behavior.

The public discriminator is the presence of `schema_version`: an input with
no such field follows the existing Phase-1 manifest and `/route` path
unchanged. An input that supplies the field selects this v2 path; it must be
the integer `2` or is refused as `schema-version-unsupported`.

The candidate receives one v2 declaration and records a prepared v2 run, its
initial graph, one preparation event, and immutable attempt-one packets for
every initially admissible task. It does not dispatch, reconcile a claim,
retry, verify, create a receipt, or admit parallel work.

## Declaration and initial admissibility

The v2 declaration is one JSON object with:

| Field | Requirement |
| --- | --- |
| `schema_version` | Integer `2`. |
| `run_id` | Identifier matching `^[A-Za-z0-9][A-Za-z0-9_-]*$`. |
| `max_concurrency` | Integer `1`; any other value is refused. |
| `tasks` | Non-empty ordered array of declared tasks. |
| `tasks[].id` | Unique identifier matching the `run_id` grammar. |
| `tasks[].objective` | Non-empty string. |
| `tasks[].scope`, `allowed_paths`, `acceptance_criteria`, `evidence_required` | Non-empty arrays of non-empty strings. |
| `tasks[].forbidden_paths`, `non_goals` | Arrays of strings; empty is valid. |
| `tasks[].dependencies` | Array of unique earlier declared task ids only. |
| `tasks[].required_decision_references` | Empty array in this slice; a nonempty value is `v2-declaration-invalid` because decision-reference identity and currency remain deferred. |
| `tasks[].retry_budget` | Non-negative integer; `/route` records it but never consumes it. |

Each declared task is initially admissible only when its dependencies array is
empty; every valid task has an empty required-decision-reference array by this
slice's declaration rule. A task with one or more dependencies starts
`blocked` and receives no packet. An initially admissible task also begins
`blocked` but receives one attempt-one packet. This is a preparation rule,
not a concurrency rule: `max_concurrency: 1` constrains only later dispatch.
`/route` never promotes a blocked task.

For an accepted declaration, the host applies the accepted v2 single run-local
lock and atomic-replacement invariant to write `run.json`, `graph.json`, and
`events/1.json`, plus `tasks/<id>/attempts/1/packet.md` for each initially
admissible task. The graph marks the run `prepared`, every task `blocked`,
and every acceptance state `pending`. Every immutable packet is bound to the
declaration and initial graph revision and renders the task's declared bounded
facts, decision references, retry budget, run id, and attempt number. No
current operation moves a prepared task from `blocked`. The later record-only
lifecycle assigns reconciliation and later first-packet creation to `/route`;
`/start` remains deferred.

Declaration equality is byte-independent canonical JSON equality: recursively
sort object keys, retain array order, serialize without insignificant
whitespace, and compare the resulting values. Re-running the same accepted
declaration returns the recorded prepared artifacts without a new event,
revision, or packet. A different canonical declaration for an existing run id
is refused without changing the recorded run.

## Public output and refusal boundary

On success the public CLI writes exactly one JSON object to stdout with
`status` (`prepared` or `reused`), `run_id`, external `run_dir`,
`graph_revision`, `run_state: "prepared"`, `prepared_task_ids`, and
`attempt_one_packet_paths`. The two arrays contain the initially admissible
task ids and their paths in declaration order. It exits zero. It must never
imply dispatch, worker execution, claim acceptance, retry, receipt, or
concurrency admission.

On refusal stdout is empty; stderr writes exactly one JSON object with
`refusal` equal to the stable family below, and the CLI exits non-zero. Exact
numeric exit codes and operator-facing prose remain contract work.

| Refusal family | Condition | Mutation boundary |
| --- | --- | --- |
| `schema-version-unsupported` | Present schema version is non-integer or not `2`. | No v2 artifact changes; a missing version follows Phase 1, which stays readable and is never migrated. |
| `v2-declaration-invalid` | Required field, task relation, safe identifier, or one-concurrency guard is invalid. | No v2 artifact changes. |
| `v2-run-declaration-conflict` | The run id names a different declaration. | Existing run remains unchanged. |

The later product contract owns exact numeric exit codes and operator-facing
text. Its public tests must observe each refusal family, JSON channel,
non-zero outcome, and mutation boundary at the CLI seam.

## Delivered co-landing record

After the independent readiness review returned `implementation-ready`, one
bounded delivery slice co-landed:

1. A v2 `/route` contract freezing this declaration, prepared artifacts,
   repeatability rule, output, and refusal families.
2. Isolated v2 routing source and CLI integration that preserves Phase-1
   manifest and route behavior.
3. Public CLI tests under an absolute external state root for creation,
   idempotent reuse, each refusal family, attempt-one packets only for
   initially admissible tasks, and absence of dispatch, claims, retries,
   verification, receipts, and later-attempt packets.

The co-landing fixture retains `max_concurrency: 1` and does not use parallel
admission as evidence. The delivered slice contains only its v2 contract,
source/CLI integration, focused fixtures and tests, and minimal supporting
documentation.

## Explicit deferrals

At its original design-input point, this record added no contract, source,
test, runtime state, or Phase-1 behavior. Its bounded `/route` behavior is now
delivered; it still does not define `/start` or `/resume`, decision currency,
adapter execution, typed-block payloads, gates, retry-packet deltas,
verification, receipt reconstruction, resource admission above one,
filesystem recovery, or version-1 migration.
