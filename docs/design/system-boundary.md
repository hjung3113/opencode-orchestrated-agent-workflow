## 3. System boundary

### 3.1 Repository knowledge vs. execution state

`llm-wiki` is an optional upstream knowledge adapter, not an orchestrator
component or a second control plane. It is included unmodified as the pinned
submodule `third_party/llm-wiki` at upstream
[`nvk/llm-wiki` commit `2a37e8649339e2f1a2936be3aa761e949b79afdc`](https://github.com/nvk/llm-wiki/tree/2a37e8649339e2f1a2936be3aa761e949b79afdc),
with no local patches; updates are explicit gitlink changes. The default
OpenCode instruction is the upstream read-only
`plugins/llm-wiki-opencode/skills/wiki-query/SKILL.md`; use
`wiki-manager/SKILL.md` only for an explicitly requested wiki research or
maintenance task. Upstream is MIT-licensed, but that does not make its license
the license of this repository.

Project knowledge is versioned with the repository:

```text
CONTEXT.md                  Current project facts, goals, constraints
AGENTS.md                   Repository-wide working rules
ADR/                        Durable architecture decisions
docs/architecture/          Architecture explanations and diagrams
docs/workflows/             Workflow and agent contracts
docs/maintenance/           Maintainer guidance and curated debt records
.opencode/                  OpenCode agent, command, skill, and template definitions
```

Per-run mutable state is stored in the absolute external
`ORCHESTRATOR_RUN_STATE_DIR`; it must not be inside the checkout or a
developer-tool directory. `.orchestrator/` is an explicitly ignored local
fallback only. The state root contains only reconstructable execution
artifacts:

```text
$ORCHESTRATOR_RUN_STATE_DIR/runs/<run-id>/
  request.md                  # objective, scope, assumptions, ambiguities
  decisions.json
  graph.json                  # record only; never an executor
  gates/<gate-id>.md          # only when a material choice needs a human
  tasks/<task-id>/
    packet.md                 # never rewritten
    result.md                 # worker's concise result claim and blocker
    evidence-claim.json
    verification.json         # implementation tasks only
  final-receipt.json
```

This separation prevents generated status, receipts, and recovery artifacts
from being confused with source-of-truth product decisions.

### 3.2 Development environment and product runs

Developer tooling is a separate, user-owned environment. In particular,
Matt Pocock engineering skills remain under `/Users/hyojung/.codex/skills` and
are never implicitly promoted to product skills, runtime prompt inputs, or
receipt provenance. A future product skill requires an explicit
repository-owned adoption decision.

Repository development does not apply this workflow to its own checkout and
does not create self-targeted dogfood runs. It uses the ordinary repository
workflow. A product run has an explicit non-self target and stores its packet,
claims, and verification in the external state root; it does not grant
automatic execution, publication, or access to developer-home tooling.

### 3.3 Authority order

When sources disagree, use this order:

1. Explicit current human direction.
2. Accepted decisions and ADRs, unless superseded by (1).
3. Approved specification and acceptance criteria.
4. Verified research facts and implementation evidence.
5. Proposed decisions, agent recommendations, and historical run outputs.

An external knowledge adapter, including `llm-wiki`, can supply cited research
facts only: its output cannot rise above level 4 or become an accepted decision
or approved specification without the normal authority path.

The orchestrator records conflicts instead of resolving material product,
cost, security, or public-release choices on its own.
