---
description: Resume one durable orchestration Run.
agent: orchestrator
subtask: false
---

Call `orchestrator_operator` exactly once with the exact Run id and optional
decision fields from `$ARGUMENTS`: `{"action":"resume","run_id":<run_id>,"decision":<decision-or-omitted>}`.
