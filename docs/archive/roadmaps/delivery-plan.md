# Archived delivery plan

> Historical implementation roadmap. This document is retained for context,
> not as product-design authority or a required implementation sequence.

## Original document

Build only vertical slices that prove the user-visible product loop. Do not
first build a generic state machine, lifecycle service, gate system, or
parallel scheduler.

## Slice 1 — one request to verified receipt

Implement one natural-language request through:

~~~text
intake -> context compilation -> workflow/skill selection -> one task ->
real agent dispatch -> file-backed result -> independent verification -> receipt
~~~

Acceptance criteria:

- The caller provides only a request.
- Intake records intent, ambiguity, and any safe assumption.
- The orchestrator, not the caller, creates the packet and graph.
- The packet names its selected workflow, skills, decisions, evidence, and
  acceptance criteria.
- A real agent is dispatched and produces result and evidence files.
- A separate verifier can reject an unsupported result.
- The receipt lets a later process reconstruct the outcome from files.

## Slice 2 — evidence-driven replan

Add one verification finding that creates and dispatches one bounded repair
task. Demonstrate that the repair packet receives the finding and relevant
prior context through files and llm-wiki retrieval.

## Slice 3 — repository knowledge retrieval

Demonstrate that a relevant accepted decision or prior failure is retrieved from
authoritative files, cited in a later packet, and changes the selected work or
constraint. Do not expand llm-wiki beyond this observed use.

## Slice 4 — compatible parallelism

Add parallel dispatch only after sequential replanning works. Prove that
declared dependencies and overlapping write paths prevent conflicting tasks
from running together.

## Slice 5 — maintenance

Add maintenance only after delivery and repair work. It may create a bounded
candidate; it must route back through the same intake and verification loop.

Each slice gets a small acceptance document only when implementation begins.
Issues and milestones are created from accepted slices, not used as substitute
design artifacts.
