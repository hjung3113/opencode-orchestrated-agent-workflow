## 10. Matt Pocock skill composition

Use skills as constrained building blocks rather than creating one huge
all-purpose agent.

| Workflow | Skill composition | Expected boundary |
| --- | --- | --- |
| Intake | Meta-prompting / Ask Matt | Clarify and structure; do not decide product direction. |
| Discovery | Research / docs grilling | Gather cited facts and unknowns. |
| Design | Docs grilling + ADR-oriented design | Compare choices and propose boundaries. |
| Specification | Design output + acceptance authoring | Produce verifiable contract; no code. |
| Ticketing | Planning + task graph compiler | Create small, dependency-aware tasks. |
| Implementation | TDD plus approved ticket | Make only scoped changes with evidence. |
| Verification | Independent review | Validate spec, standards, scope, and regression risk. |
| Maintenance | Inspection + narrow patch/review | Curate and safely address operational debt. |

The selected composition is recorded in the task packet and final receipt so
later maintainers can understand which workflow and constraints produced an
artifact.
