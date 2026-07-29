# Source layout

`src/` is organized around deep modules: callers should learn a small public
interface while implementation details stay local to the owning module.

## Current Slice A0 modules

| Module | Interface / responsibility |
| --- | --- |
| `route.js` | The public routing implementation behind `bin/route.js`: validate, write host-owned artifacts, and prepare at most one manual packet. |
| `manifest.js` | Intake-manifest structural validation. |
| `state-root.js` | External mutable-state-root validation. |
| `gate.js` | Gate rendering and answer parsing. |

`bin/route.js` is the human-invoked CLI seam. Public tests cross that seam;
internal helper arrangement is not a contract.

## Reserved module locations

The directories below establish ownership locations for later, separately
ticketed modules. Their presence does not imply implemented behavior. Existing
Slice A0 files remain in place until a behavior-preserving move has its own
accepted task.

- `intake/` — future intake adapters and request normalization.
- `routing/` — future routing composition that preserves `/route` as the
  external seam.
- `tasks/` — future task-claim and packet-facing helpers.
- `verification/` — future independent-verification contract helpers.
