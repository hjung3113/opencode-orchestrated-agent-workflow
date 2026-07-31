# Keep development tooling outside the product harness

The product harness is repository-owned and its mutable run state lives in an
absolute external `ORCHESTRATOR_RUN_STATE_DIR`; user-owned Matt Pocock skills
remain under `/Users/hyojung/.codex/skills`.

## Amendment — suspend self-targeted dogfooding

Direct human direction on 2026-07-31 supersedes the prior self-targeted
dogfooding practice. Do not apply the product workflow to develop this
repository or create runs whose product target is this checkout. Repository
development uses the ordinary repository workflow; external run state remains
for product validation against explicitly declared non-self targets. This
preserves the development-environment/product-harness boundary without making
development progress depend on the product harness.
