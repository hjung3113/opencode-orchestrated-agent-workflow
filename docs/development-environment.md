# Development environment

This repository uses a deliberately visible boundary rather than a separate
machine or container.

| Concern | Canonical location | Ownership |
| --- | --- | --- |
| Product harness contracts and source | this checkout | repository |
| Matt Pocock engineering skills | `/Users/hyojung/.codex/skills` | user development environment |
| Mutable product runs | `$ORCHESTRATOR_RUN_STATE_DIR` outside this checkout | host/runtime |
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

## Development and product-run contract

Do not apply the product workflow to this checkout and do not create a
self-targeted dogfood run. Repository development uses the ordinary repository
workflow and its versioned source, tests, and review evidence. Use
`$ORCHESTRATOR_RUN_STATE_DIR/runs/` only for product validation against an
explicit non-self target. A completed worker claim is not acceptance; when a
product run uses external state, its record preserves the applicable verifier
result.
