# Phase 2 v2 `/route` preparation contract

## Boundary

This is the human-invoked v2 `/route` preparation operation. An input without
`schema_version` remains on the unchanged Phase-1 path; a present version must
be integer `2`. This operation never dispatches, launches workers, records or
accepts claims, retries, verifies, creates receipts, starts/resumes work,
migrates v1, or admits parallel work.

## Declaration and initial state

The declaration requires a safe `run_id`, `max_concurrency: 1`, and non-empty
ordered tasks. A task has a unique safe id; non-empty objective, scope, allowed
paths, acceptance criteria, and evidence requirements; string-array forbidden
paths/non-goals; unique earlier-only dependencies; empty required decision
references; and a non-negative integer retry budget. Only dependency-free
tasks are initially admissible. All tasks enter `blocked`/`pending`; each and
only initially admissible task receives immutable attempt one.

## Host artifacts and repeatability

The host is the sole writer under the validated external state root of
`runs/<run_id>/run.json`, revision-one `graph.json`, `events/1.json`, and
`tasks/<id>/attempts/1/packet.md` for initially admissible tasks. Packets bind
declared facts, run id, attempt 1, empty decision references, retry budget,
canonical declaration, and graph revision 1.

One run-local lock covers same-run inspection, canonical comparison, and first
writes; each host artifact is atomically replaced. No stale-lock recovery,
timeout, or retry policy is defined. Canonical equality recursively sorts
object keys, preserves every array's declaration order, and ignores JSON
whitespace. An equal rerun returns existing artifacts unchanged; an unsupported
schema or invalid declaration writes no v2 artifact, and a different declaration
for an existing run id leaves its recorded artifacts unchanged.

## CLI channel

Success writes exactly one stdout JSON object with `status` (`prepared` or
`reused`), `run_id`, `run_dir`, `graph_revision`, `run_state: "prepared"`,
`prepared_task_ids`, and `attempt_one_packet_paths`, then exits zero. Refusal
writes no stdout, writes exactly `{"refusal":"<family>"}` to stderr, and
exits nonzero. Families: `schema-version-unsupported`,
`v2-declaration-invalid`, and `v2-run-declaration-conflict`. The existing
state-root guard applies before v2 artifacts exist.
