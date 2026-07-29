# Keep development tooling outside the product harness

The product harness is repository-owned and its mutable run state lives in an
absolute external `ORCHESTRATOR_RUN_STATE_DIR`; user-owned Matt Pocock skills
remain under `/Users/hyojung/.codex/skills`. Dogfooding is an explicit
self-targeted run in that external state root, so its evidence cannot be
confused with source or developer configuration.
