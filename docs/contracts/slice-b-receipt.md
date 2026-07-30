# Slice B receipt recording contract

On a later human-invoked `/route` pass, an accepted selected task produces one
immutable run-level `final-receipt.json`. The receipt copies only `graph.json`:
run id, graph revision, selected id/execution/acceptance state, its already
recorded evidence and verification paths, and remaining blocked task ids.

Receipt writing changes neither graph nor packet. It neither reads claims or
verification files nor evaluates evidence, creates a repair task, promotes a
task, or adds metadata such as timestamps, hashes, or summaries. Re-routing an
existing receipt is a no-op.
