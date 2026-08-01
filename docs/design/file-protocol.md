# File protocol

Files are the complete inter-agent protocol. They provide the durable evidence
needed to resume, review, and replan without private chat history.

## Ownership

Repository knowledge is versioned:

~~~text
AGENTS.md
docs/design/
decisions/
~~~

Run state is mutable and lives outside the checkout:

~~~text
runs/<run-id>/
  request.md
  decisions.md
  graph.json
  tasks/<task-id>/
    packet.md
    result.md
    evidence.json
    review.md
  receipt.md
~~~

The exact state root is configuration, never a developer-home path embedded in
product logic.

## Minimum artifacts

- Request: objective, scope, exclusions, ambiguity classification, and
  recorded assumptions.
- Decision: id, status, rationale, scope, and authoritative source.
- Packet: objective, allowed/forbidden paths, acceptance criteria, accepted
  decisions, selected evidence, skill composition, deliverables, and
  escalation condition.
- Graph: task ids, dependencies, read/write paths, workflow, and terminal
  state.
- Result and evidence: changed outputs, commands or observations, and
  provenance for each claim.
- Review: verifier verdict, contract evaluated, supporting evidence, and
  focused findings.
- Receipt: input and artifact references, decisions used, graph, agent and
  skill identities, verification outcome, final status, and limitations.

## Provenance and replay

Every artifact references the task and inputs that produced it. llm-wiki
retrieval results reference these artifacts; they cannot become a second source
of truth. The orchestrator can reconstruct a run by reading the receipt,
following graph edges, and loading referenced files.

Artifacts are intentionally small. A new schema field is justified only when
an end-to-end failure shows that the existing packet cannot select, execute, or
verify the next task correctly.
