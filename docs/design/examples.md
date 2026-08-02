# Acceptance traces

These traces are normative counterexamples for the first executable product
slice. Identifiers are shortened for readability; durable files use the v1
schema and exact digests.

## Local change with one repair

1. A human requests a bounded local correction. Intake records an unrelated
   pre-existing dirty file as protected and proposes `local-change@1`.
2. The kernel admits the request and graph revision 1 containing implementation
   task `t1`. The packet grants repository read, declared local writes, and
   selected test commands; external mutation and OpenCode Task delegation are
   denied.
3. The OpenCode adapter creates fresh worker session `s1`. The worker's staged
   result and observed diff match, the protected file is unchanged, and the
   kernel publishes output snapshot `S1`.
4. Graph revision 2 adds verifier `t2`, requiring `t1` and targeting `S1`.
   Fresh verifier session `s2` publishes finding `F1`. The kernel admits the
   review but refuses completion.
5. Graph revision 3 adds worker-role repair task `t3`, whose packet identifies
   the containing review, `F1`, and `S1`. Fresh session `s3` produces `S2`; the
   original result and review remain immutable.
6. Graph revision 4 adds verifier `t4`. Its distinct session reviews `S2` and
   proposes pass. The kernel confirms `S2` is still current, atomically updates
   the harness-owned result ref to the verified tree by compare-and-swap, and commits a
   receipt. The receipt identifies every graph revision, packet, OpenCode
   session, result, review, promotion, effective policy, limitation, and exact
   result ref. The operator reports a Verified Result and makes no claim that
   the user's branch, pull request, deployment, or working tree was updated.

This trace proves real dispatch, independent verification, finding-bound
repair, protected user changes, immutable history, and current-snapshot
acceptance.

## Hostile and interrupted outcomes

The following observations must not become successful receipts:

| Observation | Required outcome |
| --- | --- |
| Worker says “done” and the session becomes idle without a result artifact | Reject publication with `missing_terminal_artifact`. |
| Worker writes an undeclared path or requests `git push` | Deny model-session shell access, refuse the command-runner request, reject any undeclared diff, and record `policy_violation`. |
| Global OpenCode plugin, MCP tool, instruction, or permission survives preflight undeclared | Reject dispatch with `runtime_configuration_conflict`. |
| Worker and verifier runtime identities are equal | Reject the review with `verifier_not_independent`. |
| Output changes after a passing review | Mark the review stale and refuse receipt creation. |
| A packet requests `network` without exact External Read Targets | Reject packet admission; do not dispatch or ask the human. |
| `webfetch` requests an undeclared URL | Deny the request and record `policy_violation`. |
| Result evidence cites an External Read without a successful matching runtime observation | Reject result publication for missing provenance. |
| Cancellation is requested but the session cannot be confirmed stopped | Record `cancel_unconfirmed`; do not dispatch a successor into the same workspace. |
| The process stops after staging but before kernel publication | On resume, keep staging non-authoritative and either revalidate it as the same event or create a successor attempt. |
| The knowledge submodule or selected skill is unavailable | Record `dependency_unavailable`; do not claim retrieval or silently install it. |

## Inspect-only contrast

For the same repository, an `inspect@1` run may use research and design
workflows but receives no write capability and creates no
implementation node. When current external documentation is required, a
Research packet may additionally declare exact External Read Targets and the
`network` capability. The adapter permits `webfetch` only for those requested
URLs and preserves the exact content shown to the worker in the runtime
observation. Result evidence names the target id, and the separate verifier
reviews the frozen observation rather than refetching a possibly changed page.

An admitted pass is required before the receipt cites the observed facts and
limitations. No promotion or Git result ref is created. Calling that result an
Applied Result, using an undeclared URL, using search, browser, MCP, shell, or
credentials for network access, citing uncaptured external content, or skipping
the existing independent verification requirement is a protocol violation,
not a preset override.
