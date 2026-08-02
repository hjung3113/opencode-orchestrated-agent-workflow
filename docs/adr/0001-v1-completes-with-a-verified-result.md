# V1 completes with a Verified Result

For a local-change run, v1 completes when the independently verified result is
preserved under harness control and an authoritative receipt is published. It
does not require that result to be applied to a user's branch, pull request,
deployment, or working tree. This keeps completion atomic and preserves user
work while avoiding the substantially broader authority, conflict, recovery,
and external-effect semantics required for automatic application. Product
interfaces must call this a **Verified Result**, never imply that it has been
applied, and expose its exact location. Application is a separately authorized
operation outside v1, not a promised future workflow.
