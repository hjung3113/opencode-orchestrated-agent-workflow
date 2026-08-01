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
  -> intake / meta-prompt
  -> context compiler <-> file store <-> llm-wiki retrieval
  -> workflow and skill selector
  -> graph compiler and executor
  -> agent adapter
  -> result + evidence
  -> independent verifier
  -> replan | receipt | focused decision request
~~~

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
