# Slice A evidence-claim recording contract

A worker may write `tasks/<id>/evidence-claim.json` only in its selected task
directory. A complete `result.md` claim allows a later human-invoked `/route`
pass to read its structural shape: matching `task_id`, non-empty `commands`,
repository-relative `changed_files` without `..`, and non-empty
`acceptance_mapping` entries with `criterion` and `evidence` strings.

On that same pass, `/route` records `evidence_claim: { path:
"tasks/<id>/evidence-claim.json" }` on the selected task, or `null` if no
claim exists. It records this provenance alongside the terminal execution state
in one graph revision while leaving `acceptance_state: pending`, the selected
task, later blocked tasks, and every packet unchanged. A malformed claim fails
before graph write; re-routing a recorded terminal task is a no-op.

The routing pass does not run claimed commands, inspect claimed files, judge
evidence, accept work, verify it, create a receipt, promote a task, or launch a
worker or verifier.
