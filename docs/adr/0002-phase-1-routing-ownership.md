# Make routing the sole owner of run-level state in Phase 1

Phase 1 uses a human-invoked routing pass to write `decisions.json`,
`graph.json`, gates, receipts, and immutable task packets; workers write only
claims in their own task directories. Dispatch is a documented manual handoff,
not a lifecycle state or an automatic action, so execution states are limited
to `pending`, `succeeded`, `failed`, and `blocked`.
