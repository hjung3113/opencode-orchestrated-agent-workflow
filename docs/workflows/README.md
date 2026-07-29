# Workflow handoffs

Every workflow role receives inspectable input and writes a declared output.
Files, rather than agent chat, are the handoff protocol.

| Role | Inputs | Output claim or artifact | Authority / stop condition | Status |
| --- | --- | --- | --- | --- |
| Intake | Human request | Intake manifest, then `request.md` | Stops at material ambiguity through a human gate. | A0 current |
| Routing | Manifest, prior run artifacts, accepted decisions | `graph.json`, decisions, gates, one packet | Owns run-level state; prepares but never dispatches. | A0 current |
| Discovery / research | Bounded research question and request context | `result.md`, `evidence-claim.json` | Establishes facts; does not choose product direction. | Slice A planned |
| Design | Research and active decisions | `result.md` with alternatives and proposed decisions | Material choices return to a human gate; accepted durable choices become ADRs. | Slice A planned |
| Specification | Accepted decisions and design | `result.md` with observable criteria and observation method | Stops when a criterion cannot be observed. | Slice A planned |
| Ticketing | Approved specification | Small task candidates and dependencies | `/route` alone selects the next packet. | Slice A planned |
| Implementation | Immutable `packet.md` | `result.md` and `evidence-claim.json` | May not change run-level state or expand scope. | Slice B planned |
| Independent verification | Specification, allowed paths, changed files, evidence claim | `verification.json` | Does not receive private implementer reasoning; failure routes a repair task. | Slice B planned |
| Maintenance | Curated candidate | New intake candidate | Never silently fixes product behavior. | Phase 3 planned |

## Handoff sequence

```text
request → intake → route/gate → research → design → specification → ticketing
                                                        │
                                                        ▼
                                              immutable packet → implementation
                                                                        │
                                                                        ▼
                                                            independent verification
                                                               ├─ finding → repair task
                                                               └─ pass → receipt
```

The arrows after routing are future Phase-1 work. They document intended file
relationships; they do not enable automatic execution.
