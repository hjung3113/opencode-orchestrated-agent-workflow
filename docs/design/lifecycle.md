## 4. Workflow lifecycle

```text
Human request
  │
  ▼
Intake / meta-prompt refinement
  ├── clarification required ───────────────► Human decision
  ▼
Discovery / research
  ├── missing fact ─────────────────────────► Focused research task
  ▼
Design
  ├── competing material choices ───────────► Human decision / ADR acceptance
  ▼
Specification
  ├── non-verifiable contract ──────────────► Design refinement
  ▼
Ticketing and task graph compilation
  ▼
Implementation ──► Verification / review
  │                     │
  │                     ├── finding ────────► New repair task
  │                     └── pass
  ▼
Final receipt / release-ready result
  ▼
Maintenance monitoring ─────────────────────► Discovery, ticketing, or repair
```

No arrow means an agent is allowed to skip a phase. The orchestrator creates
the next task only after evaluating the previous phase's exit criteria.
