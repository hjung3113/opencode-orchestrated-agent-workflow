# Repository rules

## Product purpose

Build an orchestrated agent system that turns one human request into a
verified, maintainable project result.

The orchestrator interprets the request with meta-prompting and repository
knowledge, compiles context, selects and composes workflows and skills,
decomposes work into a dependency-aware graph, dispatches agents, and replans
from their artifacts. Research, design, specification, ticketing,
implementation, verification, repair, and maintenance are distinct workflows,
not one long prompt.

Preparation of prompts, packets, manifests, or graphs without executing the
selected workflow is not completed orchestration. Success is independently
verified completion through one compact human interface, with a control plane
smaller than a general-purpose workflow platform.

## Product operating model

1. Intake turns the human request into a faithful request contract: objective,
   scope, exclusions, ambiguity, and safe assumptions.
2. The orchestrator compiles the smallest sufficient context packet from
   accepted decisions, evidence, open questions, and relevant failure history.
3. It selects a workflow and its explicit skill composition, creates the
   smallest useful graph, dispatches compatible tasks, and serializes
   overlapping writes.
4. An independent verifier evaluates evidence against the relevant contract.
5. Results and findings re-enter the loop as focused research, bounded repair,
   a material decision request, or completion.

## Core rules

- Treat a user's proposal as an input to evaluate against repository evidence,
  stated product direction, constraints, and alternatives. Do not agree by
  default; identify a material conflict or risk plainly and recommend the
  evidence-supported course.
- The normal input is a human request, never a caller-authored graph, manifest,
  or manual handoff sequence.
- The orchestrator owns intake, context compilation, workflow and skill
  selection, task decomposition, graph planning, dispatch, scheduling,
  replanning, repair routing, and completion.
- Files are the authoritative inter-agent protocol. Requests, decisions,
  packets, graph edges, results, evidence, reviews, repairs, and receipts are
  inspectable and replayable; private chat is never workflow state.
- llm-wiki is the repository knowledge and context-retrieval layer. It
  retrieves relevant decisions, evidence, questions, and failure history for a
  packet, and every retrieved claim cites its authoritative file artifact.
- Skills are explicit, composable workflow building blocks. The selected
  workflow, skills, constraints, and versions are visible in the packet or
  receipt. Product behaviour must not depend on undeclared developer-home
  paths.
- The orchestrator routes from accepted decisions and evidence; it must not
  silently invent material product direction or claim verification it did not
  observe.
- Continue automatically through reversible work. Ask a human only when
  missing authority or ambiguity would materially change user intent, durable
  product direction, or an irreversible external effect.
- A worker result is a claim. Only evidence and independent verification close
  implementation work. Failure becomes focused research, bounded repair, or a
  concise material decision request, never an endless retry or informal manual
  loop.
- Treat review findings as proposals, not repair authority. Before dispatching
  a repair, map the finding to an exact acceptance criterion, the changed
  surface, and an observed normal-flow failure; otherwise defer it rather than
  expanding the current issue.
- The named issue's acceptance criteria are the implementation ceiling. Broad
  terms such as deterministic, malformed, stale, or secure do not authorize
  exhaustive cross-run, concurrency, recovery, or adversarial hardening unless
  the issue names it or current evidence shows it blocks the required outcome.
- Keep test evidence minimal: retain one observable public-boundary test per
  distinct acceptance behavior, and remove lower-level or fixture-permutation
  tests fully covered by it. Run the narrowest affected gate once; do not repeat
  unchanged slow suites merely to accumulate evidence.
- Versioned repository knowledge and mutable run state stay separate. Keep
  packets relevant, graphs no larger than the current work requires, and add
  artifacts, gates, schemas, or control-plane machinery only after a
  demonstrated end-to-end need.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain layout. See `docs/agents/domain.md`.
