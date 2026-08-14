---
description: Start one orchestration Run from the human request.
agent: orchestrator
subtask: false
---

Call `orchestrator_operator` exactly once with `{"action":"run","request":$ARGUMENTS}`.
