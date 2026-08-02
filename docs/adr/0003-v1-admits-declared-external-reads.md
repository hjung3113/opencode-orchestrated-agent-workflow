# V1 admits declared external reads

V1 permits an `inspect@1` Research task to use credential-free `webfetch` only
for exact External Read Targets declared in its admitted packet, and preserves
the content shown to the agent in the immutable runtime observation. This
enables cited current-document research without granting general network
access: source-root prefixes, search, browsing, authenticated reads, external
mutation, and transport-level containment remain outside v1. Exact targets
were chosen over broader source roots because they map to OpenCode's observable
requested-URL permission seam without adding a network-policy subsystem.
Query-bearing URLs are also excluded because OpenCode treats `?` as a
permission wildcard rather than a literal exact-target character.
