# Architecture

## External interface

The product has one deep interface:

~~~text
human request -> verified Receipt | focused Material Decision Request | Typed Block
~~~

The caller supplies intent. All phase routing, graph construction, agent
selection, context assembly, and artifact management remain inside the
orchestrator.

## Runtime loop

~~~text
request
  -> Kernel-owned pre-intake Run State and bootstrap planner envelope
  -> bounded model proposal
  -> deterministic kernel <-> file store <-> llm-wiki retrieval
  -> admitted graph revision and task packet
  -> OpenCode runtime adapter
  -> runtime observation + staged worker artifacts
  -> deterministic admission
  -> independent verifier proposal
  -> replan | Receipt | focused Material Decision Request | Typed Block
~~~

## Deterministic kernel module

The Kernel is the single holder of Publication Authority for Run State
mutation. Its deep interface is:

~~~text
advance(canonical snapshot, validated event)
  -> committed(next Run State, records, runtime commands)
   | rejected(reason)
   | material decision required(question)
   | blocked(reason)
~~~

Events include a model proposal, a runtime observation, a recorded human
decision, and a cancellation request. Every event carries an idempotency key
and the expected Run State version. A repeated event has no additional effect;
a stale Run State version is rejected without mutation. The same snapshot, policy
version, and event produce the same decision.

Models may propose request contracts, graph revisions with packets, and review
verdicts. They cannot exercise Decision, Execution, or Publication Authority:
they cannot publish an accepted graph, grant a capability, mutate Run State,
accept a decision, mark their own output verified, or overwrite a Terminal
Artifact. Syntactic normalization is allowed during admission;
semantic repair requires a new proposal.

The Kernel deterministically enforces schema and reference validity, Run State
transitions, graph readiness, budgets, actor separation, capability
intersection, artifact publication, and output-snapshot consistency. Whether
a design is good or evidence is persuasive remains a bounded planner or
verifier judgment recorded with its evidence.

For local-change runs, preserving the Verified Result has a second
deterministic seam:

~~~text
promote(verified snapshot, expected Result Ref)
  -> atomically updated Result Ref | target drift block
~~~

Promotion writes the verified tree to a harness-owned Git Result Ref after a
compare-and-swap check against that ref's recorded value. Git ref update is the
single atomic preservation point; the promoted tree digest must equal the
verified snapshot. The user's existing branch and dirty working tree remain
untouched. Promotion creates a Verified Result, never an Applied Result;
automatic Application to a user-designated target is not part of v1.

### Intake and context compiler

Intake converts the human message into a request contract without inventing
intent. The context compiler selects only the accepted decisions, evidence,
open questions, relevant repository facts, and failure history needed by the
next task.

### Workflow registry and skill adapters

A Workflow Definition specifies the kind of work, required inputs and outputs, and
verification expectation. Skill adapters name the concrete skills used for
that Workflow Definition; each selected skill is recorded with its id, version,
repository-visible source, and content digest. They are explicit Packet inputs,
not implicit developer-tool state.

### Graph compiler and executor

The compiler creates small tasks with dependencies and declared read/write
paths. The executor dispatches compatible tasks, serializes overlapping writes,
collects their Terminal Artifacts, and requests the next routing pass. The
graph is rebuilt from evidence; it is not a caller-authored static manifest.

The first executable version is deliberately serial. The complete minimal
graph contract and its deferred features are defined in
[task-graph.md](task-graph.md).

### OpenCode runtime adapter

One admitted Task Attempt maps to one fresh OpenCode session. The pre-intake
planner Attempt also maps to one fresh session, but uses the Kernel-owned
bootstrap envelope rather than a Task Packet. The adapter executes a
kernel-issued attempt specification and returns observations; it
does not schedule graph work, grant Execution Authority, exercise Publication
Authority, or declare success. For an admitted External Read Target, the same runtime observation
also preserves the requested URL and exact content exposed to the agent.
OpenCode parent/child sessions are correlation metadata, never graph edges or
workflow truth. See [opencode-runtime.md](opencode-runtime.md).

### File store and llm-wiki

Files are durable workflow truth. Repository knowledge is versioned in the
checkout; mutable run artifacts live outside it. llm-wiki indexes and retrieves
relevant file-backed knowledge for context compilation. A retrieval result
without a source artifact path is unusable.

### Verifier

The Verifier receives the contract, changed outputs, and Evidence independently
of the worker's reasoning. Its Review proposes a Verdict of pass, finding, or
block. A Finding creates a focused Repair Task; repeated same-cause failure
becomes a Typed Block rather than an unbounded loop.

Worker and Verifier Attempts use different runtime identities and sessions. A
Verifier's Verdict is an independently produced judgment proposal. The Kernel
accepts it only when identity separation, required Evidence, and the reviewed
Output Snapshot validate. Any later output change invalidates the Verdict.
