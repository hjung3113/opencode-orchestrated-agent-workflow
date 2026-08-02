# Product

## Purpose

The product accepts one natural-language human request and turns it into a
verified, maintainable project outcome. Its caller should not need to choose
agents, author task manifests, route phases, or manually carry context between
agents.

The orchestrator is responsible for interpreting the request, constructing
context, choosing workflows and skills, compiling and executing the smallest
useful task graph, and learning from task artifacts before the next pass.

## Observable outcome

A successfully completed run has:

- an interpreted request with objective, scope, exclusions, ambiguities, and
  recorded assumptions;
- file-backed task artifacts that explain what was done and why;
- evidence checked by an independent verifier against the relevant contract;
- a receipt that links the input, decisions, task graph, skills, evidence,
  verification, outcome, and known limitations.

For `local-change@1`, that outcome is a **Verified Result**: the independently
verified project state is preserved under harness control and its exact
location is exposed by the receipt. It is not an **Applied Result**. V1 does
not claim that the outcome has been incorporated into the user's working tree,
branch, pull request, deployment, or other external target.

Prompt, graph, or packet generation alone is preparation, never completion.

While a Run is active, the same compact interface exposes derived Status,
whether material input is required, cancellation, and file-backed resume.
These operations address run ids, not OpenCode conversation history.

## Authority

The human holds Decision Authority over intent and material product direction.
The orchestrator makes routing and execution decisions that follow accepted
intent and evidence. An agent may propose a Material Decision but cannot
silently accept it.

The system proceeds with executable requests and recorded low-risk
assumptions. It asks the human only when the unresolved question materially
changes user intent, durable product direction, or requires Decision Authority
for an irreversible external effect. Readiness, formatting, and routine
workflow transitions are not human gates.

A choice is material only when it is not already determined by the admitted
request or repository policy and would change the objective, scope,
exclusions, user-observable contract, a durable cross-cutting structure or
operational dependency, or Decision Authority for an irreversible external
effect.
Local reversible choices that preserve those contracts proceed as recorded
assumptions or task rationale. Model confidence is not a materiality test.

Models propose interpretations, plans, task packets, and verification
judgments. A deterministic orchestration kernel alone admits proposals,
grants Execution Authority, mutates Run State, and exercises Publication
Authority. Determinism governs admission and state mutation; it does not turn
model judgment about design or correctness into mathematical proof.

A Task's Execution Authority is the intersection of mandatory product
guarantees, explicit human authorization, repository policy, the accepted Run
policy, the Task Packet, and capabilities the runtime can actually enforce. A
lower layer may narrow Execution Authority or request an explicit expansion,
never silently widen it.

## Non-goals

- A generic lifecycle or project-management platform.
- A caller-authored task graph or manual handoff product.
- Hidden conversational memory as workflow truth.
- Unbounded retries, blanket approval gates, or speculative safety/control
  layers.
- Treating a worker's self-report as verification.
- Treating model output, OpenCode session history, or schema conformance alone as
  Execution or Publication Authority.
