# Slice B verification recording contract

An independent verifier may write `tasks/<id>/verification.json` only inside
the selected task directory. On a later human-invoked `/route` pass, the host
reads its structural result: matching `task_id`, `passed` or `failed` verdict,
non-empty verifier label, the already-recorded evidence-claim path, and one or
more criterion results with criterion, result, and evidence strings.

The host records a valid verdict as the selected task's `acceptance_state` and
`verification: { path: "tasks/<id>/verification.json" }` in one graph revision.
`passed` additionally requires a succeeded execution state and all criteria
marked passed. A malformed, inconsistent, or input-missing result fails before
the graph or immutable packet is written. Re-routing a recorded verdict is a
no-op.

`/route` does not judge criteria or evidence, run commands, inspect files,
dispatch a verifier, create a receipt or repair task, promote a task, or change
execution state.
