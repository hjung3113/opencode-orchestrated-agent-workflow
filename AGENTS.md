# Repository rules

## Development environment and product harness boundary

- **Product assets** are the versioned workflow contracts, source, tests, and
  repository-owned skills under this checkout. Do not treat a developer tool as
  a product asset or make product behaviour depend on a developer-home path.
- **Development environment** is user-owned tooling outside this checkout,
  including `/Users/hyojung/.codex/skills` and `/Users/hyojung/.agents`.
  Matt Pocock skills belong there. Do not copy, vendor, hash, emit, or install
  them as runtime inputs unless a future product requirement explicitly adopts
  one as a repository-owned product skill.
- **Harness runtime state** is mutable run data, not repository knowledge. It
  must use an absolute `ORCHESTRATOR_RUN_STATE_DIR` outside this checkout;
  relative paths, paths inside the checkout, and developer-tool directories
  are invalid runtime-state roots. `.orchestrator/` is ignored only as a
  documented local fallback, never as the canonical shared location.
- **Dogfooding** uses the product workflow to develop this repository, but
  records each self-run in the external state root with an explicit self-target
  and follows the same scope, decision-gate, evidence, and independent
  verification rules. A dogfood run does not authorize automatic spawning,
  publishing, credential use, or edits outside its declared task.

## Working rules

- Read `CONTEXT.md`, accepted ADRs, and the relevant design or specification
  before changing product behaviour.
- Treat the named issue's acceptance criteria as the implementation ceiling.
  Do not add tamper resistance, recovery, validation, or lifecycle hardening
  for malformed or externally modified run state unless that behaviour is
  explicitly required by the issue or an accepted design decision. In review,
  distinguish a normal-flow acceptance gap from optional hardening; defer the
  latter rather than expanding the slice.
- Preserve unrelated changes and third-party submodules. Do not modify
  `third_party/llm-wiki` without an explicit gitlink update decision.
- Keep the Phase-1 boundary: `/route` prepares artifacts and prompts; it does
  not automatically launch workers or grow a lifecycle/control plane.

## Agent skills

### Issue tracker

Issues live in this repository's GitHub Issues. See
`docs/agents/issue-tracker.md`.

### Triage labels

Use the five default canonical labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository: use root `CONTEXT.md` and `docs/adr/`.
See `docs/agents/domain.md`.
