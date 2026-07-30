# Task packet contract

`/route` owns one immutable `tasks/<task-id>/packet.md`, bound to its graph
revision. A packet is a manual handoff, not a worker launch or acceptance.

The current Slice A packet declares: objective; declared scope; inputs and source artifacts;
allowed paths; forbidden paths; non-goals; expected outputs; acceptance
criteria; evidence required; preconditions and dependent tasks; graph binding;
and manual worker handoff. Declared task packets render their own observable
acceptance criteria, evidence required, and labelled declared relations. Future role or skill metadata is planned only until
an accepted contract and implementation add it.
