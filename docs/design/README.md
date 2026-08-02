# Product design

These documents define the product's purpose, observable behaviour, authority,
workflows, and durable protocol. They do not prescribe an implementation
sequence or delivery roadmap.

Read in this order:

1. [product.md](product.md) — outcome, authority, and non-goals.
2. [architecture.md](architecture.md) — the deterministic kernel and its seams.
3. [opencode-runtime.md](opencode-runtime.md) — real OpenCode execution and
   operator controls.
4. [task-graph.md](task-graph.md) — the minimal dynamic graph contract.
5. [workflows.md](workflows.md) — workflow selection and policy presets.
6. [file-protocol.md](file-protocol.md) — durable, replayable handoffs.
7. [examples.md](examples.md) — end-to-end and hostile acceptance traces.

The normative machine-readable artifact contract is
[`schemas/protocol-v1.schema.json`](schemas/protocol-v1.schema.json). The
schema and examples specify the first executable vertical slice, not a generic
workflow platform.

Historical implementation roadmaps are retained under
[`docs/archive/`](../archive/) and are not product-design authority.
