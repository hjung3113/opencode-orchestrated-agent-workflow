# Architecture

## External interface

The product has one deep interface:

~~~text
human request -> verified receipt | focused material-decision request | typed block
~~~

The caller supplies intent. All phase routing, graph construction, agent
selection, context assembly, and artifact management remain inside the
orchestrator.

## Runtime loop

~~~text
request
  -> bounded model proposal
  -> deterministic kernel <-> file store <-> llm-wiki retrieval
  -> admitted graph revision and task packet
  -> OpenCode runtime adapter
  -> runtime observation + staged worker artifacts
  -> deterministic admission
  -> independent verifier proposal
  -> replan | receipt | focused decision request | typed block
~~~

## Deterministic kernel module

The kernel is the single authority for run-state mutation. Its deep interface
is:

~~~text
advance(canonical snapshot, validated event)
  -> committed(next state, records, runtime commands)
   | rejected(reason)
   | material decision required(question)
   | blocked(reason)
~~~

Events include a model proposal, a runtime observation, a recorded human
decision, and a cancellation request. Every event carries an idempotency key
and the expected state version. A repeated event has no additional effect; a
stale state version is rejected without mutation. The same snapshot, policy
version, and event produce the same decision.

Models may propose request contracts, graph revisions with packets, and review
verdicts. They cannot publish an accepted graph, grant a capability, change a
state, accept a decision, mark their own output verified, or overwrite a
terminal artifact. Syntactic normalization is allowed during admission;
semantic repair requires a new proposal.

The kernel deterministically enforces schema and reference validity, state
transitions, graph readiness, budgets, actor separation, capability
intersection, artifact publication, and output-snapshot consistency. Whether
a design is good or evidence is persuasive remains a bounded planner or
verifier judgment recorded with its evidence.

For local-change runs, preserving the Verified Result has a second
deterministic seam:

~~~text
promote(verified snapshot, expected result ref)
  -> atomically updated result ref | target drift block
~~~

Promotion writes the verified tree to a harness-owned Git result ref after a
compare-and-swap check against that ref's recorded value. Git ref update is the
single atomic preservation point; the promoted tree digest must equal the
verified snapshot. The user's existing branch and dirty working tree remain
untouched. Promotion creates a Verified Result, not an Applied Result;
automatic application to a user-designated target is not part of v1.

### Intake and context compiler

Intake converts the human message into a request contract without inventing
intent. The context compiler selects only the accepted decisions, evidence,
open questions, relevant repository facts, and failure history needed by the
next task.

### Workflow registry and skill adapters

A workflow specifies the kind of work, required inputs and outputs, and
verification expectation. Skill adapters name the concrete skills used for
that workflow. They are explicit packet inputs, not implicit developer-tool
state.

### Graph compiler and executor

The compiler creates small tasks with dependencies and declared read/write
paths. The executor dispatches compatible tasks, serializes overlapping writes,
collects their terminal artifacts, and requests the next routing pass. The
graph is rebuilt from evidence; it is not a caller-authored static manifest.

The first executable version is deliberately serial. The complete minimal
graph contract and its deferred features are defined in
[task-graph.md](task-graph.md).

### OpenCode runtime adapter

One admitted task attempt maps to one fresh OpenCode session. The adapter
executes a kernel-issued attempt specification and returns observations; it
does not schedule graph work, grant authority, publish artifacts, or declare
success. OpenCode parent/child sessions are correlation metadata, never graph
edges or workflow state. See [opencode-runtime.md](opencode-runtime.md).

### File store and llm-wiki

Files are durable workflow truth. Repository knowledge is versioned in the
checkout; mutable run artifacts live outside it. llm-wiki indexes and retrieves
relevant file-backed knowledge for context compilation. A retrieval result
without a source artifact path is unusable.

### Verifier

The verifier receives the contract, changed outputs, and evidence independently
of the worker's reasoning. It returns pass, finding, or block. A finding
creates a focused repair task; repeated same-cause failure becomes a typed
block rather than an unbounded loop.

Worker and verifier attempts use different runtime identities and sessions. A
verifier verdict is an independently produced judgment proposal. The kernel
accepts it only when identity separation, required evidence, and the reviewed
output snapshot validate. Any later output change invalidates the verdict.
