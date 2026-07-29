## 12. Decisions resolved for Phase 1

1. `/route` prepares files and prompts only; it does not launch OpenCode agents.
2. Per-run state is `$ORCHESTRATOR_RUN_STATE_DIR/runs/<run-id>/` and is
   generated execution state, not repository knowledge.
3. Material product decisions are never accepted automatically.
4. The first proof is Slice A (ambiguous request through human gate and graph
   record), followed by Slice B (one implementation task and independent
   verification).
5. Irreversible data changes, cost commitments, external publication,
   credential/security-sensitive work, and durable product-direction decisions
   always require a human gate.
