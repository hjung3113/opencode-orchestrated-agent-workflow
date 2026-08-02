# OpenCode runtime

This document defines the product contract between the deterministic kernel
and OpenCode. It binds the design to real OpenCode execution without making
OpenCode conversation state authoritative workflow state.

## Runtime seam

The baseline adapter uses a harness-owned OpenCode headless server and its
session and event interfaces. A transport change may replace the adapter only
if it preserves this interface:

~~~text
execute(attempt specification, cancellation signal) -> runtime observation
~~~

An attempt specification contains:

- run and attempt ids, plus a task id for scheduled work;
- planner, worker, or verifier role and a packet reference;
- target working directory and output-staging directory;
- selected OpenCode agent and optional model constraint;
- effective capability envelope;
- deadline and idempotency key.

A runtime observation records:

- OpenCode version and resolved-configuration digest;
- server, session, and message ids;
- actual agent and model;
- permission requests and relevant runtime events;
- the adapter-observed workspace diff and kernel-computed output snapshot;
- usage when available;
- `idle`, `runtime_error`, `runtime_unreachable`, `cancelled`,
  `cancel_unconfirmed`, or `deadline_exceeded` as the runtime exit reason.

Runtime observations are evidence, not task verdicts. An idle session or zero
exit code never substitutes for valid terminal artifacts and independent
verification.

## Attempt and session binding

Each planner attempt, worker attempt (including a repair-workflow attempt), and
verifier attempt receives a fresh OpenCode session.
A retry is a successor attempt with a new session; a repair is a new task
with worker role and workflow `repair`, linked to a finding. The baseline never
continues or forks a worker's chat to perform verification.

Every binding records the session id and an `agent_identity` derived from the
resolved role-specific agent configuration, excluding the session id. Review
admission requires both the verifier session and `agent_identity` to differ
from those of the worker that produced the target snapshot. The verifier packet
contains no worker conversation history.

OpenCode's Task tool is denied for execution attempts. Model-created
subagents would create work outside the admitted graph. OpenCode child-session
relationships may be recorded for diagnosis but have no scheduling,
provenance, or authority meaning.

## Effective configuration preflight

OpenCode configuration can be assembled from sources outside the target
repository. Before dispatch the adapter resolves the effective configuration
and records its digest and relevant identities. It rejects dispatch when:

- undeclared instructions, plugins, MCP tools, agents, or skills remain active;
- a required repository instruction or selected skill cannot be loaded;
- the effective permissions are broader than the admitted capability envelope;
- the installed OpenCode version cannot provide the required session, event,
  abort, or configuration observations.

The adapter uses a harness-owned runtime profile and never rewrites user or
repository OpenCode configuration in place. A missing pinned dependency, such
as an uninitialized knowledge submodule, produces `dependency_unavailable` or
an explicitly authorized setup action; retrieval is never claimed silently.

For `inspect@1` Research, preflight additionally requires an OpenCode version
that can restrict `webfetch` by requested URL and expose the corresponding tool
request and agent-visible output through its message or event interfaces. If
those observations cannot be correlated to the attempt, dispatch fails with
`unsupported_capability_enforcement`.

## Capabilities and side effects

The kernel grants capabilities; the adapter translates them into the most
restrictive OpenCode tools and permission rules that permit the task. The
baseline capability classes are:

| Capability | Meaning |
| --- | --- |
| `repository_read` | Read the recorded target snapshot. |
| `local_write` | Modify only declared local resources. |
| `command_execute` | Request an exact command from the kernel-owned command runner. |
| `local_commit` | Create a local commit when explicitly included in the run policy. |
| `network` | Credential-free `webfetch` of exact External Read Targets in an `inspect@1` Research packet. |
| `external_mutation` | Push, mutate issues or PRs, deploy, migrate, or perform another durable external effect. |

OpenCode permissions are only one enforcement layer. The v1 adapter denies
general shell execution inside model sessions. An agent may request an exact,
packet-declared command; a kernel-owned runner executes only admitted argv in
the isolated task workspace with credentials removed and outbound network
denied. If the host cannot enforce those conditions, dispatch fails with
`unsupported_capability_enforcement`. Repository scripts are not trusted merely
because their command name was allowlisted.

Local-change attempts run in an isolated task workspace and the kernel
computes a canonical snapshot from the base identity plus ordered path, mode,
and content-digest entries. It validates the complete observed diff against
declared write resources before publication. This is task isolation and
acceptance enforcement, not hardened hostile-code containment.

An OpenCode permission prompt is normalized as a runtime event. It becomes a
human question only when the existing material-decision rule requires one.
Unsupported enforcement produces `unsupported_capability_enforcement` rather
than broad permission or a prompt-driven bypass.

### Declared external reads

The Kernel admits `network` only for a worker-role `inspect@1` Research packet
with a non-empty list of exact External Read Targets. That packet has no local
write, command execution, commit, or external-mutation capability and declares
no commands. The adapter denies `webfetch` by default, allows only the admitted
canonical requested URLs, and keeps `websearch`, browser, MCP, plugin, and shell
network paths unavailable.

An External Read Target is an absolute HTTP(S) URL without user information,
query, fragment, wildcard, headers, cookies, request body, or credentials.
Query-bearing URLs are excluded because OpenCode permission patterns interpret
`?` as a wildcard and therefore cannot grant them as exact targets. Target ids
and canonical URLs are unique within a packet. The model may request each
target through `webfetch`; an undeclared requested URL is a `policy_violation`,
not a permission prompt or Material Decision request.

For every attempted declared read, the adapter records the target id, requested
URL, OpenCode message id, status, and either the typed error or the exact bounded
text exposed to the model with its digest. The Kernel recomputes that digest
before publication. Result evidence can cite only a successful read in its own
runtime observation, and the verifier reviews the preserved content without a
live refetch.

This contract controls and records the URL requested through OpenCode. It does
not claim DNS, TCP, or redirect-chain containment, or that the captured page
remains current. V1 does not support URL discovery, search, path-prefix or host
wildcards, authenticated content, browser execution, or external mutation.

## Terminal and failure semantics

When a session becomes idle or fails, the adapter stops execution and returns
its observation. The kernel then validates staged artifacts, observed changes,
provenance, budget, and capability compliance. It records a typed failure for:

- missing or malformed terminal artifacts;
- an undeclared write or external effect attempt;
- denied or unsupported capability enforcement;
- missing or mismatched External Read provenance;
- runtime error, loss, deadline, or unconfirmed cancellation;
- a reported output snapshot that differs from the observed workspace.

Worker prose such as “done” has no terminal meaning.

## Verified promotion

After an independent pass over the current isolated output snapshot, the
kernel writes the verified tree to a harness-owned Git result ref using an
atomic compare-and-swap update against the recorded ref value. Target-ref drift
produces `target_snapshot_changed`; the kernel does not update the user's
current branch or working tree. The delivered tree digest must equal the
verified snapshot digest. A successful promotion records the ref, its old and
new object ids, and the verified/delivered tree digest and is required for a
`local-change@1` receipt. This is a Verified Result, not an Applied Result;
operator output must expose the result ref and must not imply branch, pull
request, deployment, or working-tree application. Non-Git targets support
`inspect@1` only in v1.

Before the ref update, the kernel prepares the immutable promotion record. It
then performs the ref compare-and-swap and commits the transition in
`run.json`. Resume reconciles the three observable cases idempotently: the ref
still has the expected old object id, it already has the recorded delivered
object id, or it has an unrelated value. Those cases respectively retry the
same compare-and-swap, commit the prepared promotion, or emit a target-drift
block. No multi-file working-tree apply is part of promotion.

## Operator interface

The compact operator interface is:

~~~text
run(human request) -> run id
inspect(run id) -> durable state and active runtime binding
cancel(run id) -> reconciled cancellation result
resume(run id) -> next admitted action, resumable checkpoint, or terminal state
~~~

`inspect` derives product state from validated run artifacts and augments it
with current runtime observations. `cancel` records intent before aborting an
active session and does not report cancellation until reconciliation. `resume`
replays files and may reconnect to a bound session only to observe or cancel
it; conversation history alone cannot resume a run.

Arbitrary operator retry and fork are deferred. The kernel may create one
policy-bounded successor attempt or repair without mutating its predecessor.

## Baseline limits

The first vertical slice uses one active attempt, at most four execution
attempts across worker attempts (including repair-workflow attempts) and
verifier attempts, at most five planner
attempts, at most four graph revisions, no automatic runtime retry, and at most
one repair for a finding fingerprint. Every attempt has a configured deadline.
Budget exhaustion produces a resumable typed block. Token and monetary usage
are recorded when available but are not enforced until the runtime exposes a
stable observable contract.
