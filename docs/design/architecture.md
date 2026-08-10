# Architecture

## External interface

The product has one deep interface:

~~~text
human request -> verified Receipt | focused Material Decision Request | Typed Block
~~~

The caller supplies intent. All phase routing, graph construction, agent
selection, context assembly, and artifact management remain inside the
orchestrator.

### OpenCode-native operator adapter

The supported OpenCode distribution exposes that same interface through
repository-owned command templates, one primary `orchestrator` agent, and one
typed operator tool. Commands cover a new human request plus status, resume,
and cancel by run id. They are prompt-level UX with `subtask: false`, not Kernel
adapters. The primary agent may call only the typed operator tool; that tool is
the adapter over the same Kernel interface used by the public CLI.

OpenCode primitives have one job each:

| Primitive | Product use |
| --- | --- |
| Command | Put exact human input or run id into the primary agent's prompt. |
| Primary agent | Explain the terminal outcome and call the typed operator tool; no routing or execution authority. |
| Workflow agent configuration | Supply a versioned base prompt and permission ceiling for one admitted planner, worker, or verifier Attempt. |
| Skill | Supply original workflow or task instructions selected by the admitted Workflow Definition. |
| Custom tools | The primary-only operator tool invokes `run`, `status`, `resume`, or `cancel`; a separate worker-only `request_route` tool submits one Packet-bound replan proposal. Both use the same Kernel module. |
| Task/subtask | Denied for execution Attempts; graph dispatch creates fresh sessions instead. |
| Plugin hook | Not part of the baseline while the existing server-event adapter observes the required facts; add only for a capability the probe proves otherwise unavailable. |

Planner, worker, and verifier remain the only authority roles. Intake,
Research, Design, Specification, Ticketing, Implementation, Repair, and
Maintenance use workflow-specific agent configurations within one of those
roles; they do not create new authority roles. The adapter derives each
Packet-narrowed runtime profile from the versioned base configuration rather
than exposing those agents for direct user selection.

The canonical Matt Pocock skills remain unchanged at their original source.
The product owns a small source manifest and skill adapters, not forks of the
skill bodies. Each manifest entry pins the source repository, revision, path,
and digest; an adapter binds that original skill's inputs and outputs to a
Workflow Definition and narrows it to the Packet's capabilities. A verified
local cache may satisfy that exact identity, but an arbitrary developer-home
installation may not. Missing, changed, or incompatible source yields
`dependency_unavailable` rather than a copied or silently substituted skill.
Target-repository skills remain separate declared Packet inputs.

The OpenCode adapter bundle is loaded through one explicit product launcher or
installation path and may not require copying files into the target repository.
A clean target must either load the exact supported bundle or fail with a typed
setup error; it must not silently fall back to similarly named global commands,
agents, tools, or skills.

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
verification expectation. It also owns the compatible composition of canonical
skills and their adapters. A deterministic route registry first computes the
eligible Workflow Definitions from artifact kinds, trigger references, Preset,
role, and capabilities. A planner may rank or propose only inside that set; a
Kernel-admitted route records the matched rule ids. OpenCode commands, agents,
callers, and literal keywords cannot bypass that step.

Each selected skill is recorded with its id, version, original source,
revision, path, content digest, and adapter; Packet array order records the
ordered composition. The adapter may compile a multi-step recipe, constrain
invocation, and normalize artifacts but may not rewrite the skill body or widen
the Packet. These are explicit Packet inputs, not implicit developer-tool
state.

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
