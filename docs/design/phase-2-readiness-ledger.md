# Phase 2 readiness ledger

## Status and ownership

This is a durable, development-time design record. It is not a product runtime
artifact and does not change the current Phase 1 `/route` behavior. The Phase 2
delivery coordinator or maintainer is its sole writer. An independent read-only
reviewer issues the readiness verdict; the coordinator transcribes that verdict
with its provenance into this ledger. A human remains the acceptance authority
for any material product decision identified by the review. The delivery
coordinator consumes the recorded result to select the next design or delivery
packet.

Each candidate entry cites its independent verdict and records exactly
`implementation-ready` or
`specification-required: <named blocking items>`, as defined by
[Phase 2 delivery and readiness](phase-2-delivery.md). A readiness result
admits only the named candidate to a bounded delivery slice; it is neither a
Phase 2 completion claim nor product acceptance.

## Candidate: v2 `/route` preparation

**Operator-observable behavior:** a human-invoked `/route` receives one v2 run
declaration and records a prepared v2 run with its initial graph and immutable
attempt-one packet. It does not dispatch a worker, reconcile a result, retry,
verify, create a receipt, or admit parallel work.

**Independent verdict provenance:** Sol high read-only review
`/root/sol_phase2_design_review`, 2026-07-31; transcribed by the delivery
coordinator.

| ADR-0003 category | Classification | Basis or explicit guard |
| --- | --- | --- |
| Observable interface | `blocking` | The v2 declaration and `/route` public output/refusal contract are not yet specified. |
| State transitions | `blocking` | The v2 route's initial-admissibility predicate for creating attempt one is deferred. |
| Resource declarations | `not applicable` | This candidate does not dispatch and its contract must retain `max_concurrency: 1`. |
| Verifier-node behavior | `not applicable` | This candidate creates no result eligible for verification. |
| Block types | `blocking` | The v2 `/route` supported-versus-unsupported schema refusal boundary is not yet specified. |
| Receipt reconstruction | `not applicable` | This candidate explicitly excludes terminal task acceptance and any receipt trigger. |
| Migration/refusal behavior | `blocking` | Version-1 runs remain readable and are never migrated in place, but the candidate's unsupported-schema refusal boundary is unresolved. |

**Recorded result:** `specification-required: v2 /route declaration and public
output/refusal contract; v2 /route initial-admissibility predicate; v2 /route
schema-refusal boundary`.

**Next packet:** create only a `docs/design/` specification input for that
candidate: its v2 `/route` declaration, public output/refusal boundary,
initial-admissibility predicate, and public-evidence seam. It must not create a
`docs/contracts/` product contract, implement source, select `/start`, add
dispatch, or change the `max_concurrency: 1` guard. The public product
contract waits to co-land with implementation and public evidence after a new
independent readiness result determines that the candidate is ready.
