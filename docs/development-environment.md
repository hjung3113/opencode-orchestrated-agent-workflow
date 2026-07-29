# Development environment

This repository uses a deliberately visible boundary rather than a separate
machine or container.

| Concern | Canonical location | Ownership |
| --- | --- | --- |
| Product harness contracts and source | this checkout | repository |
| Matt Pocock engineering skills | `/Users/hyojung/.codex/skills` | user development environment |
| Mutable harness and dogfood runs | `$ORCHESTRATOR_RUN_STATE_DIR` outside this checkout | host/runtime |
| Local fallback state | `.orchestrator/` (ignored) | local only; not canonical |

## Bootstrap

Use the already-created external root for this checkout:

```zsh
export ORCHESTRATOR_RUN_STATE_DIR=/Users/hyojung/.local/state/opencode-orchestrated-agent-workflow
```

The state root must be absolute and must not be inside the checkout,
`/Users/hyojung/.codex`, or `/Users/hyojung/.agents`.

Matt Pocock engineering skills are development aids only. They may guide work
on this repository, but are not copied into packets, runtime prompts, receipts,
or distributable product assets.

## Dogfooding contract

Before applying the workflow to itself, create a named directory under
`$ORCHESTRATOR_RUN_STATE_DIR/runs/` with `request.md`, `decisions.json`,
`graph.json`, task evidence, and independent verification where applicable.
Set the target to this checkout explicitly. A completed worker claim is not
acceptance; the external run record must preserve the verifier's result.
