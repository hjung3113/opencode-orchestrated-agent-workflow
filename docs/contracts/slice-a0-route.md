# Slice A0 route contract

The current public seam is `bin/route.js`: a validated manifest plus absolute
external `ORCHESTRATOR_RUN_STATE_DIR` produces host-owned artifacts. A
`clarification-required` request creates one blocked revision-one graph and
gate; an executable or answered-gate request creates at most one pending
manual packet. Re-routing an unchanged run is idempotent.

`/route` creates the gate and ingests its answer. The human may record only
the declared `status:` and `answer:` slot. It never calls a model, launches a
worker, writes task claims, retries, or implements a lifecycle control plane.
`assumption-permitted` is structurally valid input but is not yet routable by
the current A0 implementation; it is planned work, not an automatic path.
