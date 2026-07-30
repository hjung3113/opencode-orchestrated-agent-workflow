# Phase-1 artifacts and ownership

## Ownership rule

Only a human-invoked routing pass owns run-level state. A worker owns claims
inside its selected task directory. The routing pass creates a gate; the human
may fill only its declared answer slot. A verifier owns only its independent
verification result. No claim is accepted merely because it exists.

| Artifact | Writer | Primary consumer | Authority | Slice status |
| --- | --- | --- | --- | --- |
| Intake manifest | Human or future intake adapter | `/route` | Declared request; never inferred by `/route`. | A0 current |
| `request.md` | `/route` | Later workflow roles | Faithful routed request and ambiguity classification. | A0 current |
| `decisions.json` | `/route` | Later routing passes and packets | Accepted human gate provenance. | A0 current |
| `graph.json` | `/route` | Maintainer and later routing pass | Host-owned declared-task record, dependencies, selection, and execution/acceptance record. | Slice A current: an explicit bounded sequence, one selected task |
| `gates/<id>.md` | `/route` creates; human fills answer slot | `/route` | Material decision question and answer provenance. | A0 current |
| `tasks/<id>/packet.md` | `/route` | One manually chosen worker | Immutable bounded instruction tied to graph revision. | Slice A current: selected task only |
| `tasks/<id>/result.md` | Worker | Later routing pass | Worker outcome claim; an explicit complete succeeded/failed claim may be recorded as execution state only. | Slice A current |
| `tasks/<id>/evidence-claim.json` | Worker | Independent verifier | Structurally valid worker claim; `/route` records its path only, never its truth or acceptance. | Slice A current |
| `tasks/<id>/verification.json` | Independent verifier | Later routing pass | Independent pass/fail evidence for implementation criteria. | Slice B planned |
| `final-receipt.json` | `/route` | Maintainer | Evidence-backed final outcome for a completed run. | Slice B planned |

## Invariants

- Run state root is absolute and external to this checkout and developer-tool
  directories.
- A material ambiguity creates a gate; `/route` does not invent its answer.
- A packet is created for at most one pending task and is never rewritten.
- Later declared tasks remain blocked records without packets until a separately
  specified routing slice defines promotion behavior.
- `/route` never calls a model, launches a worker, or writes worker claims.
- Worker completion is not acceptance. Only the applicable acceptance rule,
  including independent verification for implementation, may establish it.
