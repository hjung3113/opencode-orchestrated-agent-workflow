# Slice A result-claim recording contract

A worker may write `tasks/<id>/result.md` only in its own selected task
directory. On a later human-invoked `/route` pass, the host reads this explicit
slot:

```md
## Outcome

status: complete
outcome: succeeded
```

No `result.md`, an absent status, or a status other than `complete` leaves the
selected task pending and does not rewrite the graph or packet. A complete
claim records only `execution_state: succeeded` or `execution_state: failed`;
it bumps the graph revision while keeping `acceptance_state: pending`, the
selected task, later blocked tasks, and every packet unchanged. Re-routing a
recorded terminal task is a no-op.

`status: complete` requires `outcome: succeeded` or `outcome: failed`; any
other complete claim is a structural error before `/route` writes an artifact.
This is claim recording only: it does not promote a task, accept a claim,
verify work, create a receipt, or launch a worker.
