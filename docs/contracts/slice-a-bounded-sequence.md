# Slice A bounded-sequence route contract

`bin/route.js` accepts the existing single-task intake form and, when a
manifest declares `tasks`, an explicit ordered bounded task sequence. Each
declared candidate owns a safe single-segment id, objective, scope, allowed
paths, forbidden paths, non-goals, and dependencies. Dependencies name only
earlier candidates in that declared order.

For a declared sequence, `/route` records every candidate and its dependencies
in host-owned `graph.json`. The first candidate is the only selected task: it
is `pending` and receives one immutable `packet.md`. All later candidates are
recorded as `blocked`; they receive neither a packet nor a worker launch.
Re-routing the unchanged manifest retains the same graph revision and packet.

When a declared sequence is blocked on an unanswered human gate, the
revision-one graph records all candidates as `blocked` without a selected task
or packet. Legacy gate-blocked manifests that omit `tasks` retain an empty task
list.

This contract records a bounded sequence; it does not promote later tasks,
record task completion, accept claims, verify implementation, dispatch a
worker, schedule dependencies, retry, or add a lifecycle control plane.
