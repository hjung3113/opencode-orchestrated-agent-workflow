# Product

## Purpose

The product accepts one natural-language human request and turns it into a
verified, maintainable project result. Its caller should not need to choose
agents, author task manifests, route phases, or manually carry context between
agents.

The orchestrator is responsible for interpreting the request, constructing
context, choosing workflows and skills, compiling and executing the smallest
useful task graph, and learning from task artifacts before the next pass.

## Observable outcome

A completed run has:

- an interpreted request with objective, scope, exclusions, ambiguities, and
  recorded assumptions;
- file-backed task artifacts that explain what was done and why;
- evidence checked by an independent verifier against the relevant contract;
- a receipt that links the input, decisions, task graph, skills, evidence,
  verification, outcome, and known limitations.

Prompt, graph, or packet generation alone is preparation, never completion.

## Authority

The human owns intent and material product direction. The orchestrator owns
routing and execution decisions that follow accepted intent and evidence. An
agent may propose a decision but cannot silently accept it.

The system proceeds with executable requests and recorded low-risk
assumptions. It asks the human only when the unresolved question materially
changes user intent, durable product direction, or an irreversible external
effect. Readiness, formatting, and routine workflow transitions are not human
gates.

## Non-goals

- A generic lifecycle or project-management platform.
- A caller-authored task graph or manual handoff product.
- Hidden conversational memory as workflow state.
- Unbounded retries, blanket approval gates, or speculative safety/control
  layers.
- Treating a worker's self-report as verification.
