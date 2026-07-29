## 13. Success criteria for this design

The workflow is successful when it can demonstrate that:

1. An ambiguous human request is either clarified or safely bounded before
   execution.
2. Research, design, specification, ticketing, and implementation do not blur
   into a single unreviewable agent response.
3. A later task receives the relevant accepted decisions and prior evidence
   without requiring hidden conversation context.
4. The orchestrator can route a run back to focused research, a decision gate,
   or a repair task rather than forcing linear progress.
5. Independent verification can reject an unsupported implementation claim.
6. A maintainer can reconstruct what happened from files and receipts.
7. The system remains smaller than a general-purpose lifecycle/control plane.
8. `graph.json` records explicit dependencies, approval gates, and a
   feedback/repair path rather than treating a task as an isolated prompt
   chain.
